import WebSocket from 'ws';
import { createHash } from 'node:crypto';
import type { ServiceStatus, VoiceServerMessage } from '../../shared/contracts.ts';
import type { SpeechLocale } from './speech.ts';
import type { UpstreamSocket } from './soniox.ts';
import { IntegrationError, throwIfAborted } from './errors.ts';

export interface LiveSttSessionInput {
  locale: SpeechLocale;
  vocabulary?: string[];
  signal?: AbortSignal;
  onEvent: (event: VoiceServerMessage) => void;
  /** Cumulative conservative stream seconds, reported synchronously before closed. */
  onUsage?: (seconds: number) => void;
}
export interface LiveSttSession { sendAudio(audio: Buffer): void; finish(): void; cancel(): void }
export interface ScribeOptions {
  env?: NodeJS.ProcessEnv;
  createWebSocket?: (url: string, options: { headers: Record<string, string>; handshakeTimeout: number; maxPayload: number }) => UpstreamSocket;
  connectTimeoutMs?: number;
  finishTimeoutMs?: number;
  idleTimeoutMs?: number;
  endpointGraceMs?: number;
  finishGraceMs?: number;
  now?: () => number;
}
const BYTES_PER_SECOND = 32_000;
// Cloud commits finalize segments; only the local PCM guard decides the child's whole turn.
const VAD_SILENCE_SECONDS = 1;
const CHILD_PAUSE_SECONDS = 3.25;
const STALLED_PARTIAL_SILENCE_SECONDS = 4;
const STALLED_PARTIAL_MS = 1500;
const KEY_HASH = (key: string) => createHash('sha256').update(key).digest('hex');

/** $0.39/hour * conservative budget FX 8 * 1.25 contingency = 3.9, rounded to CNY 4/hour.
 * This is a local consumption estimate, not permission to purchase credits or enable overages.
 */
export function estimateElevenLabsSttCost(seconds: number, env: NodeJS.ProcessEnv = process.env): number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new IntegrationError('INVALID_AUDIO', '录音时长无效。');
  const setting = Number(env.ELEVENLABS_STT_CNY_PER_HOUR);
  const price = env.ELEVENLABS_STT_CNY_PER_HOUR && Number.isFinite(setting) && setting >= 0 ? setting : 4;
  return Math.ceil(Math.max(1, seconds) * price / 3600 * 1e6) / 1e6;
}

function appendText(stable: string, next: string): string {
  if (!stable) return next;
  if (!next) return stable;
  const needsSpace = /[A-Za-z0-9.!?]$/.test(stable) && /^[A-Za-z0-9]/.test(next);
  return stable + (needsSpace ? ' ' : '') + next;
}

export function createElevenLabsSttProvider(options: ScribeOptions = {}) {
  const env = () => options.env ?? process.env;
  const now = options.now ?? Date.now;
  let verifiedKey = '', failure = '', failureKey = '';
  function status(): ServiceStatus {
    const key = env().ELEVENLABS_API_KEY?.trim();
    if (!key) return { provider: 'elevenlabs', configured: false, available: false, status: 'unconfigured', detail: '未配置 ElevenLabs API key，实时聆听暂不可用；可以继续点击学习。' };
    const fingerprint = KEY_HASH(key), verified = verifiedKey === fingerprint, currentFailure = failureKey === fingerprint ? failure : '';
    return { provider: 'elevenlabs', configured: true, available: verified && !currentFailure, status: currentFailure ? 'error' : verified ? 'verified' : 'unverified',
      detail: currentFailure || 'ElevenLabs Scribe v2 Realtime 已配置；只使用账号可用额度，额度不足时停止并提示，不会自动充值或切换服务商。实际儿童识别效果仍需验证。' };
  }
  async function createSession(input: LiveSttSessionInput): Promise<LiveSttSession> {
    if (input.signal?.aborted) input.onUsage?.(0);
    throwIfAborted(input.signal);
    if (!['zh-CN', 'en-US'].includes(input.locale)) throw new IntegrationError('INVALID_LOCALE', '语音仅支持普通话与美式英语。');
    if (input.vocabulary && (!Array.isArray(input.vocabulary) || input.vocabulary.length > 100 || input.vocabulary.some(term => typeof term !== 'string' || !term.trim() || term.length > 80 || /[\u0000-\u001f]/.test(term)))) {
      throw new IntegrationError('INVALID_VOCABULARY', '语音提示词应为不超过 100 个简短词条。');
    }
    const key = env().ELEVENLABS_API_KEY?.trim();
    if (!key) throw new IntegrationError('SPEECH_UNCONFIGURED', '请家长先配置 ElevenLabs API key，也可以点击图片继续。');
    const url = new URL('wss://api.elevenlabs.io/v1/speech-to-text/realtime');
    for (const [name, value] of Object.entries({ model_id: 'scribe_v2_realtime', audio_format: 'pcm_16000', commit_strategy: 'vad',
      language_code: input.locale === 'zh-CN' ? 'zh' : 'en', secondary_languages: input.locale === 'zh-CN' ? 'en' : 'zh',
      vad_silence_threshold_secs: String(VAD_SILENCE_SECONDS), vad_threshold: '0.4', min_speech_duration_ms: '100', min_silence_duration_ms: '100', keepalive_interval_ms: '1000', include_timestamps: 'false', no_verbatim: 'false' })) url.searchParams.set(name, value);
    // keyterms adds a 20% premium and transcript_edit adds 30%: neither is enabled implicitly.
    // A vocabulary list remains accepted for interface compatibility, without spending on those features.
    const createSocket = options.createWebSocket ?? ((address, config) => new WebSocket(address, config));
    let socket: UpstreamSocket;
    try { socket = createSocket(url.href, { headers: { 'xi-api-key': key }, handshakeTimeout: options.connectTimeoutMs ?? 10_000, maxPayload: 262_144 }); }
    catch { throw new IntegrationError('SPEECH_NETWORK', '无法连接 ElevenLabs，可以重新聆听或点击继续。'); }
    let opened = false, readyResolved = false, closed = false, finishing = false, recovering = false, recoveryUsed = false, errorSent = false;
    let stable = '', partial = '', audioBytes = 0, startTime = now();
    let partialChangedAt = now();
    let lastVoiceByte = -Infinity, textAnchorByte = 0, voiceVersion = 0, voiceAtCommit = 0, commitSafe = false, voicedSamples = 0;
    let speechEpoch = 0, partialEpoch = 0;
    let connectionTimer: NodeJS.Timeout | undefined, finishTimer: NodeJS.Timeout | undefined, idleTimer: NodeJS.Timeout | undefined, endpointTimer: NodeJS.Timeout | undefined;
    let resolveReady!: (session: LiveSttSession) => void, rejectReady!: (error: Error) => void;
    const ready = new Promise<LiveSttSession>((resolveSession, reject) => { resolveReady = resolveSession; rejectReady = reject; });
    const emit = (event: VoiceServerMessage) => { try { input.onEvent(event); } catch { /* Relay owns its consumer errors. */ } };
    const usage = () => { if (opened) input.onUsage?.(Math.max(audioBytes / BYTES_PER_SECOND, Math.max(0, now() - startTime) / 1000)); };
    function clearEndpoint() { if (endpointTimer) clearTimeout(endpointTimer); endpointTimer = undefined; }
    function clearTimers() {
      for (const timer of [connectionTimer, finishTimer, idleTimer]) if (timer) clearTimeout(timer);
      clearEndpoint(); input.signal?.removeEventListener('abort', abort);
    }
    function close() {
      if (closed) return;
      closed = true; clearTimers(); usage();
      try { socket.close(1000); } catch { /* Already closed. */ }
      socket.terminate?.(); emit({ type: 'closed' });
    }
    function fail(code: string, message: string) {
      if (closed || errorSent) return;
      errorSent = true; failure = message; failureKey = KEY_HASH(key!);
      if (!readyResolved) rejectReady(new IntegrationError(code, message));
      emit({ type: 'error', code, message }); close();
    }
    function endpoint() {
      if (closed) return;
      usage(); emit({ type: 'endpoint', text: stable }); close();
    }
    const quietSeconds = () => (audioBytes - (Number.isFinite(lastVoiceByte) ? lastVoiceByte : textAnchorByte)) / BYTES_PER_SECOND;
    const automaticReady = () => !!stable && !partial && commitSafe && voiceAtCommit === voiceVersion && !voicedSamples && quietSeconds() >= CHILD_PAUSE_SECONDS;
    function scheduleEndpoint(delay: number, automatic = false) {
      clearEndpoint();
      endpointTimer = setTimeout(() => { endpointTimer = undefined; if (!partial && (!automatic || automaticReady())) endpoint(); }, delay); endpointTimer.unref();
    }
    function considerAutomaticEndpoint() {
      if (closed || finishing || recovering || endpointTimer || !automaticReady()) return;
      // Continuous PCM has already protected the whole pause. Never add another cloud-commit grace window.
      scheduleEndpoint(options.endpointGraceMs ?? 0, true);
    }
    function flushPending() {
      // Scribe starts processing after ~2s of audio. Pad only very short answers, then explicitly commit.
      const padding = Math.max(6400, 2 * BYTES_PER_SECOND - audioBytes);
      send(Buffer.alloc(padding), true);
      if (closed) return;
      finishTimer = setTimeout(() => fail('SPEECH_TIMEOUT', '语音结果等待超时，可以重试；这次不算答错。'), options.finishTimeoutMs ?? 8_000); finishTimer.unref();
    }
    function recoverStalledPartial() {
      if (closed || finishing || recovering || recoveryUsed || !stable || !partial) return;
      const quietBytes = audioBytes - Math.max(0, lastVoiceByte);
      if (quietBytes < STALLED_PARTIAL_SILENCE_SECONDS * BYTES_PER_SECOND || now() - partialChangedAt < STALLED_PARTIAL_MS) return;
      // A repeated keepalive is not a final answer. Ask the provider to settle its pending segment once.
      recoveryUsed = recovering = true; clearEndpoint(); flushPending();
    }
    function observeSpeech(audio: Buffer) {
      // An advisory PCM energy guard catches resumed speech before the cloud partial arrives.
      // It never produces words or finalizes a turn. Zero/quiet PCM must not reset a timer.
      for (let offset = 0; offset < audio.length; offset += 640) {
        const end = Math.min(audio.length, offset + 640), samples = (end - offset) / 2;
        let energy = 0, peak = 0;
        for (let at = offset; at < end; at += 2) { const sample = audio.readInt16LE(at); energy += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
        if (Math.sqrt(energy / samples) >= 180 && peak >= 500) {
          voicedSamples += samples;
          // Even the first possible resumed frame cancels a pending close; a tiny noise burst
          // does not advance voiceVersion or restart the full child's pause protection.
          if (!finishing && !recovering) clearEndpoint();
          if (voicedSamples >= 640) {
            // Bind a cloud segment to the PCM utterance it described. An old partial/final
            // arriving after the child resumes from a long pause cannot certify that new speech.
            if ((audioBytes + end - lastVoiceByte) / BYTES_PER_SECOND >= VAD_SILENCE_SECONDS) speechEpoch++;
            lastVoiceByte = audioBytes + end; voiceVersion++; clearEndpoint();
            if (recovering) { recovering = false; if (finishTimer) clearTimeout(finishTimer); finishTimer = undefined; }
          }
        } else voicedSamples = 0;
      }
    }
    function refreshIdle() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => fail('SPEECH_TIMEOUT', 'ElevenLabs 等待语音超时，可以重新点击麦克风。'), options.idleTimeoutMs ?? 20_000); idleTimer.unref();
    }
    function send(audio: Buffer, commit = false) {
      if (socket.readyState !== 1 || closed) throw new IntegrationError('SPEECH_DISCONNECTED', '聆听连接已结束，请重新点击麦克风。');
      try {
        socket.send(JSON.stringify({ message_type: 'input_audio_chunk', audio_base_64: audio.toString('base64'), sample_rate: 16_000, commit }), error => { if (error) fail('SPEECH_NETWORK', '语音发送失败，可以重新聆听或点击继续。'); });
        audioBytes += audio.length; usage();
      } catch { fail('SPEECH_NETWORK', '语音发送失败，可以重新聆听或点击继续。'); }
    }
    const session: LiveSttSession = {
      sendAudio(audio) {
        if (!readyResolved || closed || finishing) throw new IntegrationError('SPEECH_DISCONNECTED', '这一轮聆听已结束或尚未准备好。');
        if (!Buffer.isBuffer(audio) || !audio.length || audio.length % 2 || audio.length > 65_536) throw new IntegrationError('INVALID_AUDIO', '请发送 16kHz、16bit 单声道 PCM 小音频块。');
        if ((socket.bufferedAmount ?? 0) > 262_144) { fail('SPEECH_BACKPRESSURE', '网络发送过慢，已停止聆听，可以重试。'); return; }
        observeSpeech(audio);
        send(audio);
        recoverStalledPartial();
        considerAutomaticEndpoint();
      },
      finish() {
        if (closed || finishing) return;
        finishing = true;
        if (recovering) return; // Reuse the already-sent commit and its bounded drain; never send commit spam.
        clearEndpoint();
        if (!audioBytes) { endpoint(); return; }
        if (stable && !partial && commitSafe && voiceAtCommit === voiceVersion && quietSeconds() >= 3) { endpoint(); return; }
        flushPending();
      },
      cancel() {
        if (closed) return;
        if (!readyResolved) rejectReady(new IntegrationError('CANCELLED', '聆听已取消。'));
        if (!opened) input.onUsage?.(0);
        close();
      },
    };
    const abort = () => session.cancel();
    connectionTimer = setTimeout(() => fail('SPEECH_TIMEOUT', 'ElevenLabs 连接超时，可以重试或点击继续。'), options.connectTimeoutMs ?? 10_000);
    socket.on('open', () => { if (!closed) { opened = true; startTime = now(); } });
    socket.on('message', (data: unknown) => {
      if (closed) return;
      let response: any;
      try {
        const raw = typeof data === 'string' ? data : Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
        if (raw.length > 262_144) throw Error('large');
        response = JSON.parse(raw);
        if (!response || typeof response !== 'object' || typeof response.message_type !== 'string') throw Error('invalid');
      } catch { fail('SPEECH_INVALID_RESPONSE', 'ElevenLabs 返回格式异常，可以重新聆听。'); return; }
      refreshIdle(); usage();
      const type = response.message_type;
      if (type === 'session_started') {
        if (readyResolved) return;
        if (response.config?.model_id && response.config.model_id !== 'scribe_v2_realtime' || response.config?.sample_rate && response.config.sample_rate !== 16_000) {
          fail('SPEECH_CONFIG', 'ElevenLabs 实时识别模型或采样率不匹配，请家长检查配置。'); return;
        }
        clearTimeout(connectionTimer); readyResolved = true; resolveReady(session); emit({ type: 'ready' }); return;
      }
      if (type === 'partial_transcript' || type === 'committed_transcript') {
        if (!readyResolved || typeof response.text !== 'string') { fail('SPEECH_INVALID_RESPONSE', 'ElevenLabs 识别消息格式异常，可以重新聆听。'); return; }
        const text = response.text.trim();
        if (stable.length + text.length > 10_000) { fail('SPEECH_OUTPUT_LIMIT', '这一轮话语较长，请分成短一些的句子。'); return; }
        if (type === 'partial_transcript') {
          if (text !== partial) { partialChangedAt = now(); if (text) { partialEpoch = speechEpoch; clearEndpoint(); if (!Number.isFinite(lastVoiceByte)) textAnchorByte = audioBytes; } }
          partial = text;
          // Empty keepalives describe an empty current segment, while stable earlier segments stay visible.
          emit({ type: 'transcript', text: appendText(stable, partial), final: !partial });
          if (closed) return;
          if (!text && stable && voiceAtCommit === voiceVersion && !endpointTimer) {
            if (recovering) scheduleEndpoint(options.finishGraceMs ?? 1250);
            else considerAutomaticEndpoint();
          }
          recoverStalledPartial();
        } else {
          const segmentStillCurrent = !partial || partialEpoch === speechEpoch;
          stable = appendText(stable, text); partial = ''; partialChangedAt = now(); voiceAtCommit = voiceVersion;
          // A delayed commit may belong to a previous segment while new PCM speech is already in flight.
          commitSafe = segmentStillCurrent && (!Number.isFinite(lastVoiceByte) || quietSeconds() >= VAD_SILENCE_SECONDS);
          if (!Number.isFinite(lastVoiceByte)) textAnchorByte = audioBytes;
          verifiedKey = KEY_HASH(key); failure = ''; failureKey = '';
          emit({ type: 'transcript', text: stable, final: true });
          if (closed) return;
          if (finishing || recovering) scheduleEndpoint(options.finishGraceMs ?? 1250);
          else if (text && commitSafe) considerAutomaticEndpoint();
        }
        return;
      }
      if (type === 'warning' || type === 'committed_transcript_with_timestamps' || type === 'committed_transcript_entities' || type === 'edited_transcript') return;
      if (type === 'auth_error') { fail('SPEECH_AUTH', 'ElevenLabs 认证或识别权限失败，请家长检查配置。'); return; }
      if (['quota_exceeded', 'rate_limited', 'resource_exhausted'].includes(type)) { fail('SPEECH_RATE_LIMIT', 'ElevenLabs 可用额度不足或频率受限，已停止聆听；不会自动充值，可以点击继续。'); return; }
      if (type === 'insufficient_audio_activity') { fail('SPEECH_UNCLEAR', '这次没有听清，可以再说一次或点击继续；不算答错。'); return; }
      if (['error', 'input_error', 'invalid_request', 'chunk_size_exceeded', 'transcriber_error', 'session_time_limit_exceeded', 'commit_throttled', 'unaccepted_terms', 'queue_overflow'].includes(type) || response.error) {
        fail('SPEECH_PROVIDER', 'ElevenLabs 未完成识别，可以重试或点击继续；没有自动切换其他服务商。');
      }
    });
    socket.on('error', () => fail('SPEECH_NETWORK', '语音连接中断，可以重新聆听或点击继续。'));
    socket.on('unexpected-response', (_request: unknown, response: any) => {
      response?.resume?.(); const code = Number(response?.statusCode);
      if (code === 401 || code === 403) fail('SPEECH_AUTH', 'ElevenLabs 认证或识别权限失败，请家长检查配置。');
      else if (code === 402 || code === 429) fail('SPEECH_RATE_LIMIT', 'ElevenLabs 可用额度不足或频率受限，已停止聆听；不会自动充值，可以点击继续。');
      else fail('SPEECH_NETWORK', 'ElevenLabs 实时连接未建立，请检查服务配置与可用额度。');
    });
    socket.on('close', () => { if (!closed) fail('SPEECH_DISCONNECTED', '语音连接提前结束，没有把这次记作答错。'); });
    input.signal?.addEventListener('abort', abort, { once: true });
    if (input.signal?.aborted) abort();
    return ready;
  }
  return { status, createSession, estimateSttCost: (seconds: number) => estimateElevenLabsSttCost(seconds, env()) };
}

const defaultProvider = createElevenLabsSttProvider();
export const elevenLabsSttStatus = defaultProvider.status;
export function createElevenLabsSttSession(input: LiveSttSessionInput, options?: ScribeOptions): Promise<LiveSttSession> {
  return (options ? createElevenLabsSttProvider(options) : defaultProvider).createSession(input);
}
