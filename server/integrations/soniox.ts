import WebSocket from 'ws';
import { createHash } from 'node:crypto';
import type { ServiceStatus, VoiceServerMessage } from '../../shared/contracts.ts';
import type { SpeechLocale } from './speech.ts';
import { IntegrationError, throwIfAborted } from './errors.ts';

export interface SonioxSessionInput {
  locale: SpeechLocale;
  vocabulary?: string[];
  onEvent: (event: VoiceServerMessage) => void;
  /** Cumulative billable stream seconds, not a delta. No recording is persisted. */
  onUsage?: (seconds: number) => void;
  signal?: AbortSignal;
}
export interface SonioxSession { sendAudio(audio: Buffer): void; finish(): void; cancel(): void }
export interface UpstreamSocket {
  readyState: number;
  bufferedAmount?: number;
  on(event: string, listener: (...args: any[]) => void): unknown;
  send(data: string | Buffer, callback?: (error?: Error) => void): void;
  close(code?: number, reason?: string): void;
  terminate?(): void;
}
export interface SonioxOptions {
  env?: NodeJS.ProcessEnv;
  createWebSocket?: (url: string, options: { headers: Record<string, string>; handshakeTimeout: number; maxPayload: number }) => UpstreamSocket;
  connectTimeoutMs?: number;
  finishTimeoutMs?: number;
  idleTimeoutMs?: number;
  now?: () => number;
}
const ENDPOINT = 'wss://stt-rt.soniox.com/transcribe-websocket';
const BYTES_PER_SECOND = 32_000;
const fingerprint = (key: string) => createHash('sha256').update(key).digest('hex');
export function estimateSonioxSttCost(seconds: number, env: NodeJS.ProcessEnv = process.env): number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new IntegrationError('INVALID_AUDIO', '录音时长无效。');
  const configuredPrice = Number(env.SONIOX_STT_CNY_PER_HOUR);
  const price = env.SONIOX_STT_CNY_PER_HOUR && Number.isFinite(configuredPrice) && configuredPrice >= 0 ? configuredPrice : 10;
  return Math.ceil(Math.max(1, seconds) * price / 3600 * 1e6) / 1e6;
}

export function createSonioxProvider(options: SonioxOptions = {}) {
  const env = () => options.env ?? process.env;
  const now = options.now ?? Date.now;
  let verifiedKey = '';
  let failure = '';
  function status(): ServiceStatus {
    const key = env().SONIOX_API_KEY?.trim();
    return !key ? { provider: 'soniox', configured: false, available: false, status: 'unconfigured', detail: '未配置 Soniox API 密钥；实时聆听暂不可用，仍可点击学习。' }
      : { provider: 'soniox', configured: true, available: verifiedKey === fingerprint(key) && !failure, status: failure ? 'error' : verifiedKey === fingerprint(key) ? 'verified' : 'unverified', detail: failure || 'Soniox stt-rt-v5 已配置；支持中英混说和较保守的语义断句，实际儿童识别效果仍需验证。' };
  }
  async function createSession(input: SonioxSessionInput): Promise<SonioxSession> {
    if (input.signal?.aborted) input.onUsage?.(0);
    throwIfAborted(input.signal);
    if (!['zh-CN', 'en-US'].includes(input.locale)) throw new IntegrationError('INVALID_LOCALE', '语音仅支持普通话与美式英语。');
    if (input.vocabulary && (!Array.isArray(input.vocabulary) || input.vocabulary.length > 100 || input.vocabulary.some(term => typeof term !== 'string' || !term.trim() || term.length > 80 || /[\u0000-\u001f]/.test(term)))) {
      throw new IntegrationError('INVALID_VOCABULARY', '语音提示词应为不超过 100 个简短词条。');
    }
    const key = env().SONIOX_API_KEY?.trim();
    if (!key) throw new IntegrationError('SPEECH_UNCONFIGURED', '请先在本机配置 Soniox 密钥，或点击图片继续。');
    const createSocket = options.createWebSocket ?? ((url, socketOptions) => new WebSocket(url, socketOptions));
    let socket: UpstreamSocket;
    try { socket = createSocket(ENDPOINT, { headers: { Authorization: `Bearer ${key}` }, handshakeTimeout: options.connectTimeoutMs ?? 10_000, maxPayload: 262_144 }); }
    catch { throw new IntegrationError('SPEECH_NETWORK', '无法连接 Soniox，可以重试或点击继续。'); }
    let opened = false, closed = false, finishing = false, finished = false, emittedClosed = false, failed = false, readyResolved = false;
    let startTime = now(), audioBytes = 0, finalText = '', partialText = '', lastEndpointText = '';
    let connectionTimer: NodeJS.Timeout | undefined, finishTimer: NodeJS.Timeout | undefined, idleTimer: NodeJS.Timeout | undefined, keepAlive: NodeJS.Timeout | undefined;
    let resolveReady: (session: SonioxSession) => void, rejectReady: (error: Error) => void;
    const ready = new Promise<SonioxSession>((resolveSession, reject) => { resolveReady = resolveSession; rejectReady = reject; });
    const emit = (event: VoiceServerMessage) => { try { input.onEvent(event); } catch { /* UI consumers cannot expose upstream credentials through an uncaught event error. */ } };
    const reportUsage = () => { if (opened && input.onUsage) input.onUsage(Math.max(audioBytes / BYTES_PER_SECOND, Math.max(0, now() - startTime) / 1000)); };
    function cleanTimers() {
      for (const timer of [connectionTimer, finishTimer, idleTimer, keepAlive]) if (timer) clearTimeout(timer);
      input.signal?.removeEventListener('abort', abortListening);
    }
    function notifyClosed() { if (!emittedClosed) { emittedClosed = true; emit({ type: 'closed' }); } }
    function endSocket() {
      if (closed) return;
      closed = true; cleanTimers(); reportUsage();
      try { socket.close(1000); } catch { /* Closed transport. */ }
      socket.terminate?.(); notifyClosed();
    }
    function fail(code: string, message: string) {
      if (closed || failed) return;
      failed = true; failure = message; emit({ type: 'error', code, message });
      if (!readyResolved) rejectReady!(new IntegrationError(code, message));
      endSocket();
    }
    function send(data: string | Buffer) {
      if (socket.readyState !== 1 || closed) throw new IntegrationError('SPEECH_DISCONNECTED', '语音连接已结束，请重新点击麦克风。');
      try { socket.send(data, error => { if (error) fail('SPEECH_NETWORK', '语音发送失败，可以重试或点击继续。'); }); }
      catch { fail('SPEECH_NETWORK', '语音发送失败，可以重试或点击继续。'); }
    }
    function refreshIdle() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => fail('SPEECH_TIMEOUT', '语音服务等待超时，可以重新点击麦克风。'), options.idleTimeoutMs ?? 20_000);
      idleTimer.unref();
    }
    function endpoint() {
      const text = finalText.trim();
      if (text !== lastEndpointText || !text) { lastEndpointText = text; emit({ type: 'endpoint', text }); }
    }
    const session: SonioxSession = {
      sendAudio(audio) {
        if (finishing || closed) throw new IntegrationError('SPEECH_DISCONNECTED', '这一轮聆听已结束。');
        if (!Buffer.isBuffer(audio) || !audio.length || audio.length % 2 !== 0 || audio.length > 65_536) throw new IntegrationError('INVALID_AUDIO', '请发送 16kHz、16bit 单声道 PCM 小音频块。');
        if ((socket.bufferedAmount ?? 0) > 262_144) { fail('SPEECH_BACKPRESSURE', '网络发送过慢，已停止聆听，请重试。'); return; }
        send(audio); audioBytes += audio.length; reportUsage();
      },
      finish() {
        if (closed || finishing) return;
        finishing = true;
        if (audioBytes) {
          const silence = Buffer.alloc(6400); // Official recommendation: ~200ms silence before manual finalize.
          send(silence); audioBytes += silence.length; reportUsage();
          send(JSON.stringify({ type: 'finalize' }));
        }
        // Empty TEXT frame ends the stream; an empty binary audio frame does not.
        send('');
        finishTimer = setTimeout(() => fail('SPEECH_TIMEOUT', '语音结果等待超时，可以重试；这次不算答错。'), options.finishTimeoutMs ?? 8_000);
        finishTimer.unref();
      },
      cancel() {
        if (closed) return;
        if (!readyResolved) rejectReady!(new IntegrationError('CANCELLED', '聆听已取消。'));
        if (!opened) input.onUsage?.(0);
        endSocket();
      },
    };
    const abortListening = () => session.cancel();
    connectionTimer = setTimeout(() => fail('SPEECH_TIMEOUT', 'Soniox 连接超时，可以重试或点击继续。'), options.connectTimeoutMs ?? 10_000);
    socket.on('open', () => {
      if (closed) return;
      opened = true; startTime = now(); clearTimeout(connectionTimer);
      send(JSON.stringify({ model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: 16_000, num_channels: 1,
        language_hints: input.locale === 'en-US' ? ['en', 'zh'] : ['zh', 'en'], language_hints_strict: false,
        enable_endpoint_detection: true, endpoint_latency_adjustment_level: 0, endpoint_sensitivity: -0.3, max_endpoint_delay_ms: 3000,
        enable_language_identification: true, enable_speaker_diarization: false,
        context: { general: [{ key: 'domain', value: 'A child learning English vocabulary with Chinese instructions' }], terms: input.vocabulary ?? [] } }));
      if (failed) return;
      keepAlive = setInterval(() => { if (!closed && !finishing) send(JSON.stringify({ type: 'keepalive' })); }, 5000); keepAlive.unref();
      refreshIdle(); readyResolved = true; emit({ type: 'ready' }); resolveReady!(session);
    });
    socket.on('message', (data: unknown) => {
      if (closed) return;
      let response: any;
      try {
        const raw = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
        if (raw.length > 262_144) throw Error('large');
        response = JSON.parse(raw);
        if (!response || typeof response !== 'object' || Array.isArray(response)) throw Error('invalid response');
      } catch { fail('SPEECH_INVALID_RESPONSE', '语音服务返回格式异常，可以重新聆听。'); return; }
      if (response.error_code || response.error_type) {
        const code = Number(response.error_code);
        fail(code === 401 || code === 403 ? 'SPEECH_AUTH' : code === 402 || code === 429 ? 'SPEECH_RATE_LIMIT' : 'SPEECH_PROVIDER',
          code === 401 || code === 403 ? 'Soniox 认证或权限失败，请家长检查本机配置。' : code === 402 || code === 429 ? 'Soniox 额度或频率受限，请家长检查后重试。' : 'Soniox 暂时未完成识别，可以重试或点击继续。');
        return;
      }
      refreshIdle(); reportUsage();
      if (Array.isArray(response.tokens)) {
        let partial = '', hasEndpoint = false, changed = false;
        for (const token of response.tokens) {
          if (typeof token?.text !== 'string' || typeof token.is_final !== 'boolean' || token.translation_status === 'translation') continue;
          if (['<end>', '<fin>'].includes(token.text)) { if (token.is_final) hasEndpoint = true; continue; }
          if (/^<[^>]+>$/.test(token.text)) continue;
          if (token.is_final) { finalText += token.text; changed = true; } else partial += token.text;
        }
        if (response.tokens.length) partialText = partial;
        if (finalText.length + partialText.length > 10_000) { fail('SPEECH_OUTPUT_LIMIT', '这一轮话语较长，请分成短一点的句子。'); return; }
        if (changed || response.tokens.length) {
          verifiedKey = fingerprint(key); failure = '';
          emit({ type: 'transcript', text: (finalText + partialText).trim(), final: !partialText });
        }
        if (hasEndpoint) endpoint();
      }
      if (response.finished === true) {
        finished = true; verifiedKey = fingerprint(key); failure = ''; endpoint(); endSocket();
      }
    });
    socket.on('error', () => fail('SPEECH_NETWORK', '语音连接中断，可以重试或点击继续。'));
    socket.on('unexpected-response', (_request: unknown, response: any) => { response?.resume?.(); fail('SPEECH_NETWORK', '语音服务连接未建立，请家长检查服务配置。'); });
    socket.on('close', () => {
      if (!closed && !finished) fail('SPEECH_DISCONNECTED', '语音连接提前结束，没有把这次记作答错。');
      else { cleanTimers(); if (!closed) reportUsage(); notifyClosed(); }
    });
    input.signal?.addEventListener('abort', abortListening, { once: true });
    // The signal can have changed while an injected or native socket was being constructed.
    if (input.signal?.aborted) abortListening();
    return ready;
  }
  return { status, createSession, estimateSttCost: (seconds: number) => estimateSonioxSttCost(seconds, env()) };
}

const defaultProvider = createSonioxProvider();
export const sonioxStatus = defaultProvider.status;
export function createSonioxSession(input: SonioxSessionInput, options?: SonioxOptions): Promise<SonioxSession> {
  return (options ? createSonioxProvider(options) : defaultProvider).createSession(input);
}
