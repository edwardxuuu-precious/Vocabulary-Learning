import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ServiceStatus } from '../../shared/contracts.ts';
import { IntegrationError } from './errors.ts';

export type SpeechLocale = 'zh-CN' | 'en-US';
export interface TtsInput { text: string; locale: SpeechLocale; rate?: number; dataDir: string }
export interface TtsResult { filePath?: string; mode: 'api' | 'local'; cached: boolean; costCny: number; message?: string }
export interface SttInput { audio: Buffer; locale: SpeechLocale }
export interface SttResult { transcript: string; status: 'recognized' | 'unclear' | 'unavailable'; costCny: number; message?: string }

interface SpeechOptions { env?: NodeJS.ProcessEnv; fetch?: typeof fetch; timeoutMs?: number }
const VOICES: Record<SpeechLocale, string> = { 'zh-CN': 'zh-CN-XiaoxiaoNeural', 'en-US': 'en-US-JennyNeural' };
const FORMAT = 'audio-16khz-32kbitrate-mono-mp3';
const MAX_TEXT = 500;
const MAX_AUDIO_SECONDS = 15;

function validLocale(locale: string): asserts locale is SpeechLocale {
  if (!Object.hasOwn(VOICES, locale)) throw new IntegrationError('INVALID_LOCALE', '语音仅支持普通话与美式英语。');
}
function finitePrice(value: string | undefined, fallback: number): number {
  const number = Number(value);
  return value && Number.isFinite(number) && number >= 0 ? number : fallback;
}
function roundCost(value: number): number { return Math.ceil(value * 1_000_000) / 1_000_000; }

/** Conservative local estimates, configurable for the user's actual Azure plan. Not a live price quote. */
export function estimateTtsCost(text: string, env: NodeJS.ProcessEnv = process.env): number {
  return roundCost([...text].length * finitePrice(env.AZURE_TTS_CNY_PER_MILLION, 120) / 1_000_000);
}
export function estimateSttCost(seconds: number, env: NodeJS.ProcessEnv = process.env): number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new IntegrationError('INVALID_AUDIO', '录音时长无效。');
  return roundCost(Math.max(1, seconds) * finitePrice(env.AZURE_STT_CNY_PER_HOUR, 10) / 3600);
}

function configuration(env: NodeJS.ProcessEnv) {
  const key = env.AZURE_SPEECH_KEY?.trim();
  const region = env.AZURE_SPEECH_REGION?.trim();
  if (!key || !region) return null;
  if (!/^[a-z][a-z0-9-]{1,40}$/.test(region)) throw new IntegrationError('SPEECH_CONFIG', 'Azure Speech 区域格式无效，请检查本机配置。');
  return { key, region };
}
function xml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
}
export function validateTtsInput({ text, locale, rate }: Pick<TtsInput, 'text' | 'locale' | 'rate'>): { text: string; rate: number; voice: string } {
  validLocale(locale);
  if (typeof text !== 'string' || !text.trim() || [...text].length > MAX_TEXT || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    throw new IntegrationError('INVALID_TEXT', '朗读内容应为 1–500 个有效字符。');
  }
  const normalizedRate = rate ?? 0.85;
  if (!Number.isFinite(normalizedRate) || normalizedRate < 0.5 || normalizedRate > 1.5) {
    throw new IntegrationError('INVALID_RATE', '语速必须介于 0.5 与 1.5 之间。');
  }
  return { text: text.trim(), rate: normalizedRate, voice: VOICES[locale] };
}

/** Parse RIFF chunks instead of trusting a fixed browser WAV header. Audio never reaches disk. */
export function validateWav(audio: Buffer): { seconds: number; dataBytes: number } {
  if (!Buffer.isBuffer(audio) || audio.length < 44 || audio.length > 16_000 * 2 * MAX_AUDIO_SECONDS + 4096 ||
      audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
    throw new IntegrationError('INVALID_AUDIO', '请使用不超过 15 秒的 16kHz、16bit 单声道 WAV 录音。');
  }
  const riffEnd = audio.readUInt32LE(4) + 8;
  if (riffEnd !== audio.length) throw new IntegrationError('INVALID_AUDIO', 'WAV 文件长度不完整。');
  let formatValid = false;
  let dataBytes = 0;
  let chunks = 0;
  for (let offset = 12; offset + 8 <= riffEnd;) {
    if (++chunks > 64) throw new IntegrationError('INVALID_AUDIO', 'WAV 音频结构无效。');
    const id = audio.toString('ascii', offset, offset + 4);
    const size = audio.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > riffEnd) throw new IntegrationError('INVALID_AUDIO', 'WAV 音频数据不完整。');
    if (id === 'fmt ') {
      if (size < 16) throw new IntegrationError('INVALID_AUDIO', 'WAV 音频格式不完整。');
      formatValid = audio.readUInt16LE(start) === 1 && audio.readUInt16LE(start + 2) === 1 &&
        audio.readUInt32LE(start + 4) === 16_000 && audio.readUInt32LE(start + 8) === 32_000 &&
        audio.readUInt16LE(start + 12) === 2 && audio.readUInt16LE(start + 14) === 16;
    }
    if (id === 'data') dataBytes += size;
    offset = end + size % 2;
  }
  const seconds = dataBytes / 32_000;
  if (!formatValid || dataBytes % 2 !== 0 || seconds <= 0 || seconds > MAX_AUDIO_SECONDS) {
    throw new IntegrationError('INVALID_AUDIO', '请使用不超过 15 秒的 16kHz、16bit 单声道 WAV 录音。');
  }
  return { seconds, dataBytes };
}

function isMp3(audio: Buffer): boolean {
  return audio.length > 32 && (audio.toString('ascii', 0, 3) === 'ID3' || (audio[0] === 0xff && (audio[1] & 0xe0) === 0xe0));
}

function speechCachePath(input: TtsInput): string {
  const normalized = validateTtsInput(input);
  const cacheKey = createHash('sha256').update(JSON.stringify(['azure-v1', input.locale, normalized.voice, normalized.rate, normalized.text, FORMAT])).digest('hex');
  return join(input.dataDir, 'speech', `${cacheKey}.mp3`);
}
export async function getCachedSpeech(input: TtsInput): Promise<string | undefined> {
  const filePath = speechCachePath(input);
  try { if (isMp3(await readFile(filePath))) return filePath; } catch { /* Cache can be absent. */ }
  return undefined;
}

export function createSpeechProvider(options: SpeechOptions = {}) {
  const env = () => options.env ?? process.env;
  const request = options.fetch ?? globalThis.fetch;
  const active = new Map<string, Promise<TtsResult>>();
  const verified = new Set<'tts' | 'stt'>();
  let lastFailure = '';

  async function call(url: string, init: RequestInit): Promise<Response> {
    try {
      const response = await request(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs ?? 20_000), redirect: 'error' });
      if (!response.ok) {
        const message = response.status === 401 || response.status === 403 ? 'Azure Speech 认证失败，请检查本机密钥与区域。'
          : response.status === 429 ? '语音服务额度或频率受限，请稍后重试。' : `语音服务暂时失败（HTTP ${response.status}）。`;
        lastFailure = message;
        // Do not echo provider bodies: they may contain account or authorization details.
        await response.body?.cancel().catch(() => {});
        throw new IntegrationError(response.status === 429 ? 'SPEECH_RATE_LIMIT' : 'SPEECH_PROVIDER', message);
      }
      return response;
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
      lastFailure = timeout ? '语音服务超时，可以重试或继续点击学习。' : '无法连接语音服务，可以重试或继续点击学习。';
      throw new IntegrationError(timeout ? 'SPEECH_TIMEOUT' : 'SPEECH_NETWORK', lastFailure);
    }
  }

  function status(): ServiceStatus {
    try {
      if (!configuration(env())) return { configured: false, available: false, status: 'unconfigured', detail: '未配置 Azure Speech 密钥和区域；可使用浏览器朗读与点击学习，录音不会上传。' };
      return { configured: true, available: verified.size > 0 && !lastFailure, status: lastFailure ? 'error' : verified.size === 2 ? 'verified' : 'unverified',
        detail: lastFailure || `Azure Speech 已配置；中文/英文 TTS ${verified.has('tts') ? '已验证' : '待实际验证'}，语音识别 ${verified.has('stt') ? '已验证' : '待实际验证'}。` };
    } catch (error) {
      return { configured: false, available: false, status: 'error', detail: error instanceof IntegrationError ? error.message : '语音配置无效。' };
    }
  }

  async function synthesizeSpeech(input: TtsInput): Promise<TtsResult> {
    const normalized = validateTtsInput(input);
    const filePath = speechCachePath(input);
    if (await getCachedSpeech(input)) return { filePath, mode: 'api', cached: true, costCny: 0 };
    const config = configuration(env());
    if (!config) return { mode: 'local', cached: false, costCny: 0, message: '尚未配置 Azure Speech，使用浏览器本机朗读；音色和离线可用性取决于系统。' };
    const activeKey = filePath;
    const pending = active.get(activeKey);
    if (pending) return { ...await pending, cached: true, costCny: 0 };
    const operation = (async (): Promise<TtsResult> => {
      const percent = `${Math.round((normalized.rate - 1) * 100)}%`;
      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${input.locale}"><voice name="${normalized.voice}"><prosody rate="${percent}">${xml(normalized.text)}</prosody></voice></speak>`;
      const response = await call(`https://${config.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
        method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': config.key, 'Content-Type': 'application/ssml+xml', 'X-Microsoft-OutputFormat': FORMAT, 'User-Agent': 'LittleWordPlayroom/0.1' }, body: ssml,
      });
      let audio: Buffer;
      try { audio = Buffer.from(await response.arrayBuffer()); }
      catch { lastFailure = '语音音频下载失败，可以重试或继续点击学习。'; throw new IntegrationError('SPEECH_NETWORK', lastFailure); }
      if (audio.length > 2_000_000 || !isMp3(audio)) {
        lastFailure = '语音服务返回了无效音频，请稍后重试。';
        throw new IntegrationError('SPEECH_INVALID_RESPONSE', lastFailure);
      }
      await mkdir(join(input.dataDir, 'speech'), { recursive: true });
      const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
      await writeFile(temporaryPath, audio);
      await rename(temporaryPath, filePath);
      verified.add('tts'); lastFailure = '';
      return { filePath, mode: 'api', cached: false, costCny: estimateTtsCost(normalized.text, env()) };
    })();
    active.set(activeKey, operation);
    try { return await operation; } finally { active.delete(activeKey); }
  }

  async function transcribeSpeech({ audio, locale }: SttInput): Promise<SttResult> {
    validLocale(locale);
    const { seconds } = validateWav(audio);
    const config = configuration(env());
    if (!config) return { transcript: '', status: 'unavailable', costCny: 0, message: 'Azure 语音识别尚未配置，可以点击图片继续；没有上传录音。' };
    const response = await call(`https://${config.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${locale}&format=simple`, {
      method: 'POST', headers: { 'Ocp-Apim-Subscription-Key': config.key, 'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000', Accept: 'application/json' }, body: new Uint8Array(audio),
    });
    let result: { RecognitionStatus?: string; DisplayText?: string };
    try { result = await response.json(); } catch { lastFailure = '语音识别返回格式无效，可以重试或点击继续。'; throw new IntegrationError('SPEECH_INVALID_RESPONSE', lastFailure); }
    if (!result || typeof result.RecognitionStatus !== 'string') {
      lastFailure = '语音识别返回格式无效，可以重试或点击继续。'; throw new IntegrationError('SPEECH_INVALID_RESPONSE', lastFailure);
    }
    const costCny = estimateSttCost(seconds, env());
    if (result.RecognitionStatus === 'Success' && typeof result.DisplayText === 'string' && result.DisplayText.trim()) {
      verified.add('stt'); lastFailure = '';
      return { transcript: result.DisplayText.trim().slice(0, 1000), status: 'recognized', costCny };
    }
    if (['NoMatch', 'InitialSilenceTimeout', 'BabbleTimeout', 'EndOfDictation', 'Success'].includes(result.RecognitionStatus)) {
      verified.add('stt'); lastFailure = '';
      return { transcript: '', status: 'unclear', costCny, message: '这次没有听清，可以再说一次或点击继续；不算答错。' };
    }
    lastFailure = '语音识别未完成，可以重试或点击继续；不算答错。';
    throw new IntegrationError('SPEECH_RECOGNITION_FAILED', lastFailure);
  }
  return { status, synthesizeSpeech, transcribeSpeech };
}

const defaultProvider = createSpeechProvider();
export const synthesizeSpeech = defaultProvider.synthesizeSpeech;
export const transcribeSpeech = defaultProvider.transcribeSpeech;
export const speechStatus = defaultProvider.status;
