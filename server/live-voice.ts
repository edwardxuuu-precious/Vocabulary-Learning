import type http from 'node:http';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { ServiceStatus, VoiceServerMessage } from '../shared/contracts.ts';

export interface LiveSession { sendAudio(audio: Buffer): void; finish(): void; cancel(): void }
export interface LiveSessionInput {
  locale: 'zh-CN' | 'en-US'; vocabulary?: string[];
  signal?: AbortSignal;
  onEvent(event: VoiceServerMessage): void; onUsage(seconds: number): void;
}
export interface LiveVoiceOptions {
  status(): Promise<ServiceStatus>;
  open(input: LiveSessionInput): Promise<LiveSession> | LiveSession;
  vocabulary(): string[];
  reserve(seconds: number): string;
  settle(id: string, seconds: number): void;
  maxSeconds?: number;
}

export function localRequestAllowed(req: http.IncomingMessage, requireOrigin = false): boolean {
  const host = req.headers.host ?? '';
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return false;
  const origin = req.headers.origin;
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  if (!origin) return !requireOrigin;
  return new Set([`http://${host}`, 'http://localhost:5173', 'http://127.0.0.1:5173', ...(process.env.DEV_WEB_ORIGIN ? [process.env.DEV_WEB_ORIGIN] : [])]).has(origin);
}

/** Local-only, bounded PCM relay. Provider credentials never cross this connection. */
export function attachLiveVoice(server: http.Server, options: LiveVoiceOptions) {
  const sockets = new Set<WebSocket>();
  const cleanups = new Set<() => void>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 65_536, perMessageDeflate: false });
  const requestedSeconds = options.maxSeconds ?? 45;
  const maxSeconds = Number.isFinite(requestedSeconds) ? Math.max(0.05, Math.min(45, requestedSeconds)) : 45;
  let active: WebSocket | undefined;
  let closing = false;
  server.on('upgrade', (req, socket, head) => {
    if (closing) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return; }
    if (req.url?.split('?')[0] !== '/api/voice/stream') { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return; }
    if (!localRequestAllowed(req, true)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  wss.on('connection', ws => {
    sockets.add(ws);
    let session: LiveSession | undefined;
    let started = false, ready = false, providerReady = false, finishing = false, ended = false, opening = false;
    let bytes = 0, providerSeconds = 0, charge: string | undefined, readyAt: number | undefined;
    let usageKnown = false, billingFinalized = false;
    const controller = new AbortController();
    let deadline: NodeJS.Timeout | undefined, finishDeadline: NodeJS.Timeout | undefined;
    const send = (event: VoiceServerMessage) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event)); };
    const settle = () => {
      if (!charge) return;
      const id = charge; charge = undefined;
      // A cancelled unresolved handshake is unknown until the provider explicitly reports zero.
      // Retain its original reservation instead of falsely claiming it cost nothing.
      if (opening && !session && !providerReady && !usageKnown) { billingFinalized = true; return; }
      const wallSeconds = readyAt === undefined ? 0 : Math.max(0, Date.now() - readyAt) / 1000;
      options.settle(id, Math.min(maxSeconds + 0.5, Math.max(providerSeconds, bytes / 32_000, wallSeconds)));
      billingFinalized = true;
    };
    const end = (error?: { code: string; message: string }) => {
      if (ended) return;
      ended = true; clearTimeout(startDeadline); clearTimeout(deadline); clearTimeout(finishDeadline);
      // This must reach the provider even while await open() has not returned a session handle.
      controller.abort();
      try { session?.cancel(); } catch { /* The local connection must still close. */ }
      try { settle(); } catch { billingFinalized = true; /* Persisted reservation remains conservative if settlement fails. */ }
      if (active === ws) active = undefined;
      if (error) send({ type: 'error', ...error });
      send({ type: 'closed' });
      if (ws.readyState === WebSocket.OPEN) ws.close(1000);
    };
    let startDeadline = setTimeout(() => end({ code: 'STT_START_TIMEOUT', message: '连接等待超时，请再点一次麦克风。' }), 8_000);
    const cleanup = () => end(); cleanups.add(cleanup);
    ws.on('error', () => end());
    ws.on('close', () => { end(); sockets.delete(ws); cleanups.delete(cleanup); });
    const event = (value: VoiceServerMessage) => {
      if (ended) return;
      if (value.type === 'ready') {
        providerReady = true; readyAt ??= Date.now();
        if (!session) return;
        ready = true; clearTimeout(startDeadline);
      }
      if ((value.type === 'transcript' || value.type === 'endpoint') && value.text.length > 2_000) { end({ code: 'STT_TEXT_LIMIT', message: '这一句话有点长，我们分开说吧。' }); return; }
      if (value.type === 'error') { end(value); return; }
      send(value);
      if (value.type === 'endpoint' || value.type === 'closed') end();
    };
    const start = async (body: Record<string, unknown>) => {
      if (started) { end({ code: 'STT_INVALID_START', message: '语音已经开始，请完成这一句话。' }); return; }
      started = true; clearTimeout(startDeadline);
      startDeadline = setTimeout(() => end({ code: 'STT_START_TIMEOUT', message: '小耳朵准备得有点久，请再试一次。' }), 8_000);
      if (!['zh-CN', 'en-US'].includes(String(body.locale))) { end({ code: 'INVALID_LOCALE', message: '语音仅支持中文和英文。' }); return; }
      if (active && active !== ws) { end({ code: 'STT_BUSY', message: '另一个麦克风正在使用，请先结束它。' }); return; }
      active = ws;
      try {
        const status = await options.status();
        if (ended) return;
        if (!status.configured || status.provider === 'azure') { end({ code: 'STT_CONFIG', message: status.provider === 'azure' ? '当前输入服务使用录音识别，请切换到录音模式。' : '小栗的小耳朵还没设置好，请大人检查语音输入设置。' }); return; }
        charge = options.reserve(maxSeconds + 0.5);
        // One absolute wall-clock deadline includes connecting, recording and waiting for final text.
        deadline = setTimeout(() => end({ code: 'STT_TIME_LIMIT', message: '我们先停一下，一次说一句就好。' }), maxSeconds * 1_000);
        opening = true;
        const opened = await options.open({ locale: body.locale as 'zh-CN' | 'en-US', signal: controller.signal, vocabulary: options.vocabulary().slice(0, 100), onEvent: event, onUsage: seconds => { if (!billingFinalized && Number.isFinite(seconds) && seconds >= 0) { usageKnown = true; providerSeconds = Math.max(providerSeconds, seconds); } } });
        if (ended) { opened.cancel(); return; }
        opening = false; session = opened;
        if (providerReady) { ready = true; clearTimeout(startDeadline); send({ type: 'ready' }); }
      } catch (error) {
        const code = String((error as { code?: string })?.code ?? 'STT_UNAVAILABLE');
        const budget = code.startsWith('BUDGET'), limited = /^(SPEECH|STT)_(RATE_LIMIT|QUOTA|CREDITS|PAYMENT)/.test(code);
        end({ code: budget || limited ? code : 'STT_UNAVAILABLE', message: budget ? '本月语音预算已用完，请大人查看设置。' : limited ? '语音服务的额度或频率受限，可以稍后再试，或点图片继续。' : '语音连接没有准备好，可以再试一次或请大人帮忙。' });
      }
    };
    ws.on('message', (raw: RawData, binary: boolean) => {
      if (ended) return;
      if (binary) {
        if (!ready || !session || finishing) { end({ code: 'STT_NOT_READY', message: '小耳朵还在准备，请重新开始。' }); return; }
        const audio = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
        if (!audio.length || audio.length % 2 || bytes + audio.length > maxSeconds * 32_000) { end({ code: 'STT_AUDIO_LIMIT', message: '这一句话有点长，我们分开说吧。' }); return; }
        bytes += audio.length;
        try { session.sendAudio(audio); } catch { end({ code: 'STT_NETWORK', message: '刚才的声音断开了，请再试一次。' }); }
        return;
      }
      if (raw.toString().length > 4_096) { end({ code: 'INVALID_MESSAGE', message: '语音请求无效。' }); return; }
      let body: Record<string, unknown>;
      try { body = JSON.parse(raw.toString()); if (!body || Array.isArray(body)) throw new Error(); } catch { end({ code: 'INVALID_MESSAGE', message: '语音请求无效。' }); return; }
      if (body.type === 'start') void start(body);
      else if (body.type === 'cancel') end();
      else if (body.type === 'finish' && session && ready && !finishing) {
        finishing = true;
        finishDeadline = setTimeout(() => end({ code: 'STT_FINISH_TIMEOUT', message: '这次没有听完整，请再说一次。' }), 10_000);
        try { session.finish(); } catch { end({ code: 'STT_NETWORK', message: '刚才的声音断开了，请再试一次。' }); }
      } else end({ code: 'INVALID_MESSAGE', message: '语音请求无效，请重新开始。' });
    });
  });
  return { busy: () => !!active, close: () => { closing = true; for (const cleanup of cleanups) cleanup(); cleanups.clear(); for (const ws of sockets) ws.terminate(); sockets.clear(); active = undefined; wss.close(); } };
}
