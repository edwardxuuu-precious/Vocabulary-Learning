import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ServiceStatus, VoiceTone } from '../../shared/contracts.ts';
import { validateTtsInput, type TtsInput as AzureTtsInput, type TtsResult } from './speech.ts';
import { IntegrationError, throwIfAborted } from './errors.ts';

export type TtsInput = AzureTtsInput & { tone?: VoiceTone; signal?: AbortSignal; beforeRequest?: () => void };
export interface TtsStreamResult {
  contentType: 'audio/mpeg'; mode: 'api'; cached: boolean;
  stream: AsyncIterable<Uint8Array>; completed: Promise<TtsResult>; cancel(): void;
}
export interface ElevenLabsOptions { env?: NodeJS.ProcessEnv; fetch?: typeof fetch; timeoutMs?: number; maxAudioBytes?: number; maxCacheBytes?: number; maxCacheFiles?: number }
const TONES = { curious: '[curious]', cheerful: '[cheerful]', gentle: '[gently]', excited: '[excited]', clear: '' } as const;
const OUTPUT_FORMAT = 'mp3_44100_128';
const MODEL_DEFAULT = 'eleven_v4_turbo';
function estimate(text: string, env: NodeJS.ProcessEnv, reserveTags = true): number {
  const configured = Number(env.ELEVENLABS_TTS_CNY_PER_MILLION);
  const price = env.ELEVENLABS_TTS_CNY_PER_MILLION && Number.isFinite(configured) && configured >= 0 ? configured : 400;
  return Math.ceil(([...text].length + (reserveTags ? 16 : 0)) * price / 1e6 * 1e6) / 1e6;
}
function mp3(bytes: Buffer): boolean { return bytes.length > 32 && (bytes.toString('ascii', 0, 3) === 'ID3' || bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0); }
function waitForActive(operation: Promise<TtsResult>, signal?: AbortSignal): Promise<TtsResult> {
  if (!signal) return operation;
  return new Promise((resolve, reject) => {
    const abort = () => { signal!.removeEventListener('abort', abort); reject(new IntegrationError('CANCELLED', '朗读已取消。')); };
    signal.addEventListener('abort', abort, { once: true });
    operation.then(value => { signal.removeEventListener('abort', abort); if (signal.aborted) abort(); else resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) abort();
  });
}

export function createElevenLabsProvider(options: ElevenLabsOptions = {}) {
  const env = () => options.env ?? process.env;
  const request = options.fetch ?? globalThis.fetch;
  const active = new Map<string, Promise<TtsResult>>();
  let verifiedFingerprint = '', lastFailure = '', failureFingerprint = '';
  function config(locale: 'zh-CN' | 'en-US') {
    const settings = env();
    const key = settings.ELEVENLABS_API_KEY?.trim();
    const voice = (locale === 'zh-CN' ? settings.ELEVENLABS_VOICE_ID_ZH : settings.ELEVENLABS_VOICE_ID_EN)?.trim() || settings.ELEVENLABS_VOICE_ID?.trim();
    const model = settings.ELEVENLABS_TTS_MODEL?.trim() || MODEL_DEFAULT;
    if ([settings.ELEVENLABS_VOICE_ID, settings.ELEVENLABS_VOICE_ID_ZH, settings.ELEVENLABS_VOICE_ID_EN].some(item => item?.trim() && !/^[A-Za-z0-9_-]{1,100}$/.test(item.trim()))) throw new IntegrationError('SPEECH_CONFIG', 'ElevenLabs voice ID 格式无效，请检查本机配置。');
    if (!/^eleven_v(?:3(?:_conversational)?|4(?:_turbo)?)$/.test(model)) throw new IntegrationError('SPEECH_CONFIG', '请选择 Eleven v3/v4 系列对话模型；此接入使用 Text-to-Dialogue。');
    return { key, voice, model, fingerprint: createHash('sha256').update(JSON.stringify([key, voice, model])).digest('hex') };
  }
  function normalized(input: TtsInput) {
    const valid = validateTtsInput(input);
    if (input.tone && !Object.hasOwn(TONES, input.tone)) throw new IntegrationError('INVALID_TONE', '语音情绪参数无效。');
    const tone = input.locale === 'en-US' ? 'clear' : input.tone ?? 'cheerful';
    const { voice, model } = config(input.locale);
    const tag = TONES[tone];
    // English learning examples retain the exact literal words, casing and punctuation.
    const text = tag ? `${tag} ${valid.text}` : valid.text;
    return { ...valid, voice, model, tone, text };
  }
  function cachePath(input: TtsInput): string | undefined {
    const value = normalized(input);
    if (!value.voice) return undefined;
    const key = createHash('sha256').update(JSON.stringify(['elevenlabs-dialogue-v1', input.locale, value.voice, value.model, value.tone, value.rate, value.text, OUTPUT_FORMAT])).digest('hex');
    return join(input.dataDir, 'speech', 'elevenlabs', `${key}.mp3`);
  }
  async function getCachedSpeech(input: TtsInput): Promise<string | undefined> {
    const filePath = cachePath(input);
    if (!filePath) return undefined;
    try { const info = await stat(filePath); if (info.size <= (options.maxAudioBytes ?? 2_000_000) && mp3(await readFile(filePath))) return filePath; } catch { /* Expected cache miss. */ }
    return undefined;
  }
  function status(): ServiceStatus {
    try {
      const chinese = config('zh-CN'), english = config('en-US');
      if (!chinese.key || !chinese.voice && !english.voice) return { provider: 'elevenlabs', configured: false, available: false, status: 'unconfigured', detail: '未配置 ElevenLabs API key 与 voice ID；可以使用浏览器朗读，实际音色取决于系统。' };
      const fingerprints = [chinese.fingerprint, english.fingerprint], verified = fingerprints.includes(verifiedFingerprint), failure = fingerprints.includes(failureFingerprint) ? lastFailure : '';
      return { provider: 'elevenlabs', configured: true, available: verified && !failure, status: failure ? 'error' : verified ? 'verified' : 'unverified', detail: failure || `ElevenLabs ${chinese.model} 已配置；英文单词按原词清晰朗读并保留本地音频缓存${!chinese.voice ? '；中文 voice ID 尚未配置' : !english.voice ? '；英文 voice ID 尚未配置' : ''}，尚未在本机验证的音色仍需试音。` };
    } catch (error) { return { provider: 'elevenlabs', configured: false, available: false, status: 'error', detail: error instanceof IntegrationError ? error.message : 'ElevenLabs 配置无效。' }; }
  }
  async function trimCache(directory: string, keepPath: string) {
    const files = await readdir(directory, { withFileTypes: true });
    const entries = await Promise.all(files.filter(file => file.isFile() && /^[a-f0-9]{64}\.mp3$/.test(file.name)).map(async file => {
      const path = join(directory, file.name); const info = await stat(path); return { path, bytes: info.size, at: info.mtimeMs };
    }));
    entries.sort((a, b) => a.path === keepPath ? -1 : b.path === keepPath ? 1 : b.at - a.at);
    let bytes = 0;
    for (let index = 0; index < entries.length; index++) {
      bytes += entries[index].bytes;
      if (entries[index].path !== keepPath && (index >= (options.maxCacheFiles ?? 150) || bytes > (options.maxCacheBytes ?? 100_000_000))) await unlink(entries[index].path).catch(() => {});
    }
  }
  async function synthesizeSpeech(input: TtsInput): Promise<TtsResult> {
    throwIfAborted(input.signal);
    const value = normalized(input);
    const cached = await getCachedSpeech(input);
    throwIfAborted(input.signal);
    if (cached) return { filePath: cached, mode: 'api', cached: true, costCny: 0 };
    const settings = config(input.locale);
    if (!settings.key || !settings.voice) return { mode: 'local', cached: false, costCny: 0, message: 'ElevenLabs 尚未配置完整，已使用浏览器朗读；这不是 ElevenLabs 的云端音色。' };
    const filePath = cachePath(input)!;
    const existing = active.get(filePath);
    if (existing) { const result = await waitForActive(existing, input.signal); throwIfAborted(input.signal); return { ...result, cached: true, costCny: 0 }; }
    const operation = (async (): Promise<TtsResult> => {
      const controller = new AbortController();
      const abort = () => controller.abort(input.signal?.reason);
      input.signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error('timeout')), options.timeoutMs ?? 30_000);
      let temporaryPath: string | undefined;
      try {
        throwIfAborted(input.signal);
        input.beforeRequest?.();
        throwIfAborted(input.signal);
        const response = await request(`https://api.elevenlabs.io/v1/text-to-dialogue/stream?output_format=${OUTPUT_FORMAT}`, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { 'xi-api-key': settings.key!, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
          body: JSON.stringify({ model_id: settings.model, language_code: input.locale === 'en-US' ? 'en' : 'zh', inputs: [{ text: value.text, voice_id: settings.voice }], settings: { stability: input.locale === 'en-US' ? 1 : 0.5 }, apply_text_normalization: input.locale === 'en-US' ? 'off' : 'auto', seed: 1234 }),
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          throw new IntegrationError(response.status === 401 || response.status === 403 ? 'SPEECH_AUTH' : response.status === 429 || response.status === 402 ? 'SPEECH_RATE_LIMIT' : 'SPEECH_PROVIDER',
            response.status === 401 || response.status === 403 ? 'ElevenLabs 认证或音色权限失败，请家长检查本机配置。' : response.status === 429 || response.status === 402 ? 'ElevenLabs 额度或频率受限，请稍后重试。' : 'ElevenLabs 未完成合成，请检查模型/音色支持或稍后重试。');
        }
        const maximum = options.maxAudioBytes ?? 2_000_000;
        if (!response.body || Number(response.headers.get('content-length')) > maximum) { await response.body?.cancel(); throw new IntegrationError('SPEECH_OUTPUT_LIMIT', '语音音频超过本地大小限制。'); }
        const reader = response.body.getReader();
        const chunks: Buffer[] = []; let size = 0;
        const cancelReader = () => { void reader.cancel().catch(() => {}); };
        controller.signal.addEventListener('abort', cancelReader, { once: true });
        try {
          while (true) {
            if (controller.signal.aborted) throw new IntegrationError(input.signal?.aborted ? 'CANCELLED' : 'SPEECH_TIMEOUT', input.signal?.aborted ? '朗读已取消。' : 'ElevenLabs 合成超时，可以重试或使用本机朗读。');
            const result = await reader.read();
            if (controller.signal.aborted) throw new IntegrationError(input.signal?.aborted ? 'CANCELLED' : 'SPEECH_TIMEOUT', input.signal?.aborted ? '朗读已取消。' : 'ElevenLabs 合成超时，可以重试或使用本机朗读。');
            if (result.done) break;
            size += result.value.byteLength;
            if (size > maximum) { await reader.cancel(); throw new IntegrationError('SPEECH_OUTPUT_LIMIT', '语音音频超过本地大小限制。'); }
            chunks.push(Buffer.from(result.value));
          }
        } finally { controller.signal.removeEventListener('abort', cancelReader); reader.releaseLock(); }
        const audio = Buffer.concat(chunks, size);
        if (!mp3(audio)) throw new IntegrationError('SPEECH_INVALID_RESPONSE', 'ElevenLabs 返回了无效音频，可以重试或使用本机朗读。');
        await mkdir(join(input.dataDir, 'speech', 'elevenlabs'), { recursive: true });
        temporaryPath = `${filePath}.${randomUUID()}.tmp`;
        await writeFile(temporaryPath, audio); throwIfAborted(input.signal); await rename(temporaryPath, filePath); temporaryPath = undefined;
        // Pruning is maintenance; a pruning failure must not turn a valid paid response into a false retry.
        await trimCache(join(input.dataDir, 'speech', 'elevenlabs'), filePath).catch(() => {});
        throwIfAborted(input.signal);
        verifiedFingerprint = settings.fingerprint; lastFailure = ''; failureFingerprint = '';
        return { filePath, mode: 'api', cached: false, costCny: estimate(value.text, env(), false), ...(input.rate !== undefined ? { message: '此对话模型由音色和文本控制节奏；独立 rate 未发送给供应商。' } : {}) };
      } catch (error) {
        if (error instanceof Error && String((error as Error & { code?:string }).code ?? '').startsWith('BUDGET')) throw error;
        const safe = error instanceof IntegrationError ? error : new IntegrationError(input.signal?.aborted ? 'CANCELLED' : controller.signal.aborted ? 'SPEECH_TIMEOUT' : 'SPEECH_NETWORK', input.signal?.aborted ? '朗读已取消。' : controller.signal.aborted ? 'ElevenLabs 合成超时，可以重试或使用本机朗读。' : '无法连接 ElevenLabs，可以重试或使用本机朗读。');
        if (safe.code !== 'CANCELLED') { lastFailure = safe.message; failureFingerprint = settings.fingerprint; }
        throw safe;
      } finally { clearTimeout(timer); input.signal?.removeEventListener('abort', abort); if (temporaryPath) await unlink(temporaryPath).catch(() => {}); }
    })();
    active.set(filePath, operation);
    try { return await operation; } finally { active.delete(filePath); }
  }
  async function cachedStream(input:TtsInput,filePath:string):Promise<TtsStreamResult> {
    throwIfAborted(input.signal);
    const file=createReadStream(filePath,{highWaterMark:16_384});
    const cancel=()=>{file.destroy();};
    input.signal?.addEventListener('abort',cancel,{once:true});
    const stream=(async function*(){
      try{for await(const bytes of file){throwIfAborted(input.signal);yield bytes as Buffer;}}
      finally{input.signal?.removeEventListener('abort',cancel);file.destroy();}
    })();
    return {contentType:'audio/mpeg',mode:'api',cached:true,stream,completed:Promise.resolve({filePath,mode:'api',cached:true,costCny:0}),cancel};
  }
  /** Return after a bounded, validated MP3 prefix. The consumer drives the remaining upstream reads. */
  async function streamSpeech(input:TtsInput):Promise<TtsStreamResult> {
    throwIfAborted(input.signal);const value=normalized(input),cached=await getCachedSpeech(input);throwIfAborted(input.signal);
    if(cached)return cachedStream(input,cached);
    const settings=config(input.locale);
    if(!settings.key||!settings.voice)throw new IntegrationError('SPEECH_STREAM_UNAVAILABLE','云端朗读尚未配置完整，可以使用本机朗读。');
    const filePath=cachePath(input)!,existing=active.get(filePath);
    if(existing){const result=await waitForActive(existing,input.signal);throwIfAborted(input.signal);if(!result.filePath)throw new IntegrationError('SPEECH_STREAM_UNAVAILABLE','缓存朗读没有准备好，可以使用本机朗读。');return cachedStream(input,result.filePath);}
    let resolveCompleted!:(result:TtsResult)=>void,rejectCompleted!:(error:Error)=>void;
    const completed=new Promise<TtsResult>((resolveResult,reject)=>{resolveCompleted=resolveResult;rejectCompleted=reject;});completed.catch(()=>{});
    active.set(filePath,completed);
    const controller=new AbortController();
    let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,temporaryPath:string|undefined,consuming=false,settled=false,requestSent=false,manuallyCancelled=false;
    const maximum=options.maxAudioBytes??2_000_000;
    const failure=(error:unknown):Error=>{
      if(error instanceof IntegrationError)return error;
      if(error instanceof Error&&String((error as Error&{code?:string}).code??'').startsWith('BUDGET'))return error;
      return new IntegrationError(input.signal?.aborted||manuallyCancelled?'CANCELLED':controller.signal.aborted?'SPEECH_TIMEOUT':'SPEECH_NETWORK',input.signal?.aborted||manuallyCancelled?'朗读已取消。':controller.signal.aborted?'ElevenLabs 合成超时，可以重试或使用本机朗读。':'无法连接 ElevenLabs，可以重试或使用本机朗读。');
    };
    const cleanup=async()=>{clearTimeout(timer);input.signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',cancelReader);if(temporaryPath){await unlink(temporaryPath).catch(()=>{});temporaryPath=undefined;}if(active.get(filePath)===completed)active.delete(filePath);};
    const rejectOperation=async(error:Error)=>{if(settled)return;settled=true;controller.abort();if(requestSent&&!(error instanceof IntegrationError&&error.code==='CANCELLED')){lastFailure=error.message;failureFingerprint=settings.fingerprint;}await cleanup();rejectCompleted(error);};
    const abort=()=>{controller.abort(input.signal?.reason);if(!consuming)void rejectOperation(new IntegrationError('CANCELLED','朗读已取消。'));};
    const cancelReader=()=>{void reader?.cancel().catch(()=>{});};
    const timer=setTimeout(()=>{controller.abort(new Error('timeout'));if(!consuming)void rejectOperation(new IntegrationError('SPEECH_TIMEOUT','ElevenLabs 合成超时，可以重试或使用本机朗读。'));},options.timeoutMs??30_000);
    input.signal?.addEventListener('abort',abort,{once:true});controller.signal.addEventListener('abort',cancelReader,{once:true});
    const check=()=>{if(controller.signal.aborted)throw new IntegrationError(input.signal?.aborted||manuallyCancelled?'CANCELLED':'SPEECH_TIMEOUT',input.signal?.aborted||manuallyCancelled?'朗读已取消。':'ElevenLabs 合成超时，可以重试或使用本机朗读。');};
    let response:Response;
    const chunks:Buffer[]=[];let size=0;
    const add=(bytes:Uint8Array)=>{size+=bytes.byteLength;if(size>maximum)throw new IntegrationError('SPEECH_OUTPUT_LIMIT','语音音频超过本地大小限制。');const chunk=Buffer.from(bytes);chunks.push(chunk);return chunk;};
    try{
      throwIfAborted(input.signal);input.beforeRequest?.();throwIfAborted(input.signal);requestSent=true;
      response=await request(`https://api.elevenlabs.io/v1/text-to-dialogue/stream?output_format=${OUTPUT_FORMAT}`,{
        method:'POST',redirect:'error',signal:controller.signal,headers:{'xi-api-key':settings.key,'Content-Type':'application/json',Accept:'audio/mpeg'},
        body:JSON.stringify({model_id:settings.model,language_code:input.locale==='en-US'?'en':'zh',inputs:[{text:value.text,voice_id:settings.voice}],settings:{stability:input.locale==='en-US'?1:0.5},apply_text_normalization:input.locale==='en-US'?'off':'auto',seed:1234}),
      });check();
      if(!response.ok){await response.body?.cancel().catch(()=>{});throw new IntegrationError(response.status===401||response.status===403?'SPEECH_AUTH':response.status===429||response.status===402?'SPEECH_RATE_LIMIT':'SPEECH_PROVIDER',response.status===401||response.status===403?'ElevenLabs 认证或音色权限失败，请家长检查本机配置。':response.status===429||response.status===402?'ElevenLabs 额度或频率受限，请稍后重试。':'ElevenLabs 未完成合成，可以稍后重试。');}
      if(response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase()!=='audio/mpeg'){await response.body?.cancel().catch(()=>{});throw new IntegrationError('SPEECH_INVALID_RESPONSE','语音服务没有返回 MP3 音频。');}
      if(!response.body||Number(response.headers.get('content-length'))>maximum){await response.body?.cancel().catch(()=>{});throw new IntegrationError('SPEECH_OUTPUT_LIMIT','语音音频超过本地大小限制。');}
      reader=response.body.getReader();
      // Validate only the first 32 bytes before exposing a response, without waiting for full synthesis.
      while(size<32){check();const result=await reader.read();check();if(result.done)break;add(result.value);}
      const first=Buffer.concat(chunks,size);
      if(first.length<32||!(first.toString('ascii',0,3)==='ID3'||first[0]===0xff&&(first[1]&0xe0)===0xe0))throw new IntegrationError('SPEECH_INVALID_RESPONSE','语音服务返回了无效 MP3 首段。');
    }catch(error){const safe=failure(error);await rejectOperation(safe);await reader?.cancel().catch(()=>{});reader?.releaseLock();throw safe;}
    const stream=(async function*(){
      consuming=true;let successful=false;
      try{
        check();for(const chunk of [...chunks]){check();yield chunk;}
        while(true){check();const result=await reader!.read();check();if(result.done)break;yield add(result.value);}
        const audio=Buffer.concat(chunks,size),expected=Number(response.headers.get('content-length'));
        if(!mp3(audio)||(expected>0&&expected!==size))throw new IntegrationError('SPEECH_INVALID_RESPONSE','ElevenLabs 返回了不完整音频，可以使用本机朗读。');
        await mkdir(join(input.dataDir,'speech','elevenlabs'),{recursive:true});check();temporaryPath=`${filePath}.${randomUUID()}.tmp`;
        await writeFile(temporaryPath,audio);check();await rename(temporaryPath,filePath);temporaryPath=undefined;check();
        verifiedFingerprint=settings.fingerprint;lastFailure='';failureFingerprint='';
        const result:TtsResult={filePath,mode:'api',cached:false,costCny:estimate(value.text,env(),false)};
        successful=true;settled=true;await cleanup();resolveCompleted(result);
        // Cache pruning runs after the paid result is committed, never before the first audio.
        void trimCache(join(input.dataDir,'speech','elevenlabs'),filePath).catch(()=>{});
      }catch(error){const safe=failure(error);await rejectOperation(safe);throw safe;}
      finally{if(!successful){controller.abort();await rejectOperation(new IntegrationError('CANCELLED','朗读已取消。'));}await reader?.cancel().catch(()=>{});reader?.releaseLock();}
    })();
    const cancel=()=>{manuallyCancelled=true;controller.abort();if(!consuming)void rejectOperation(new IntegrationError('CANCELLED','朗读已取消。'));};
    return {contentType:'audio/mpeg',mode:'api',cached:false,stream,completed,cancel};
  }
  return { synthesizeSpeech, streamSpeech, getCachedSpeech, estimateTtsCost: (text: string) => estimate(text, env()), status };
}
