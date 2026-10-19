import { modeFetch } from './test-mode-context';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatContext, ChatReply, ChatStreamEvent, VoiceTone } from '../shared/contracts';
import { api, errorMessage, post } from './api';
import { ConversationPreparationController } from './conversation-preparation';

const tones: VoiceTone[] = ['curious', 'cheerful', 'gentle', 'excited', 'clear'];
const actions = new Set(['none', 'start_learning', 'repeat_audio', 'next_step', 'pause', 'exit', 'prepare_images', 'propose_interest']);
const conversationKey = 'little-word-playroom:conversation-id:v1';
const validConversationId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
function readConversationId(): string | undefined {
  try { const id = window.sessionStorage.getItem(conversationKey); if (validConversationId(id)) return id; window.sessionStorage.removeItem(conversationKey); } catch { /* Storage can be disabled; in-memory conversation still works. */ }
  return undefined;
}
function rememberConversationId(id?: string) {
  try { if (id) window.sessionStorage.setItem(conversationKey, id); else window.sessionStorage.removeItem(conversationKey); } catch { /* Never persist text, audio or credentials as a fallback. */ }
}
const failedConversation = (code: string, message: string) => Object.assign(new Error(message), { code });
function checkedReply(value: ChatReply): ChatReply {
  if (!value || typeof value.text !== 'string' || !value.text.trim() || !tones.includes(value.tone) || !value.action || !actions.has(value.action.type)) throw new Error('小栗这次没有说清楚，请再试一次。');
  if (value.action.type === 'propose_interest' && (typeof value.action.interest !== 'string' || !value.action.interest.trim() || value.action.interest.length > 40)) throw new Error('这次兴趣提案还不完整，请再告诉小栗一次。');
  return value;
}

export function useConversation() {
  const [stage, setStage] = useState<'idle' | 'thinking' | 'responding'>('idle');
  const [error, setError] = useState('');
  const [reply, setReply] = useState<ChatReply | null>(null);
  const [needsReset, setNeedsReset] = useState(false);
  const [storedConversationId] = useState(readConversationId);
  const active = useRef(false);
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const conversationId = useRef<string | undefined>(storedConversationId);
  const cancellation = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  const preparationRef = useRef<ConversationPreparationController | null>(null);
  if (!preparationRef.current) preparationRef.current = new ConversationPreparationController({
    createId: () => crypto.randomUUID(),
    prepare: (request, signal) => api('/api/chat/prepare', { method: 'POST', body: JSON.stringify(request), signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) }),
    cancel: preparationId => api('/api/chat/prepare/cancel', { method: 'POST', body: JSON.stringify({ preparationId }), signal: AbortSignal.timeout(10000) }),
  });
  const preparation = preparationRef.current;
  const prepare = useCallback(() => { if (!active.current && !needsReset) void preparation.prepare(conversationId.current); }, [preparation, needsReset]);
  const cancelPreparation = useCallback(() => { void preparation.cancel(); }, [preparation]);
  const cancel = useCallback(() => {
    void preparation.cancel();
    generation.current += 1;
    const hadActive = active.current;
    abort.current?.abort(); abort.current = null; active.current = false;
    if (mounted.current) setStage('idle');
    if (hadActive) cancellation.current = cancellation.current.catch(() => {}).then(() => post('/api/chat/cancel', {})).catch(() => {});
    return cancellation.current;
  }, [preparation]);
  const reset = useCallback(async () => {
    conversationId.current = undefined; rememberConversationId();
    await cancel();
    setReply(null); setError(''); setNeedsReset(false);
    cancellation.current = post('/api/chat/reset', {}).catch(() => {});
    await cancellation.current;
  }, [cancel]);
  const turn = useCallback(async (message: string, context: ChatContext): Promise<ChatReply | null> => {
    if (active.current || needsReset || !message.trim()) return null;
    preparation.claim();
    const request = ++generation.current;
    active.current = true; setStage('thinking'); setError('');
    const controller = new AbortController(); abort.current = controller;
    try {
      await cancellation.current;
      if (request !== generation.current) return null;
      const response = await modeFetch('/api/chat/turn', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify({ message: message.trim(), conversationId: conversationId.current, context }), signal: controller.signal });
      if (!response.ok) { let text = `对话没有连接成功（${response.status}）`, code = ''; try { const detail = await response.json(); text = detail.error || text; code = detail.code || ''; } catch {} throw failedConversation(code, text); }
      if (!response.body) throw new Error('浏览器没有收到对话内容。');
      const reader = response.body.getReader(); const decoder = new TextDecoder();
      let buffer = '', result: ChatReply | null = null, doneEvent = false;
      const process = (frame: string) => {
        const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data || request !== generation.current) return;
        const event = JSON.parse(data) as ChatStreamEvent;
        if (event.type === 'status' && (event.stage === 'thinking' || event.stage === 'responding')) setStage(event.stage);
        else if (event.type === 'reply') { if (!validConversationId(event.conversationId)) throw failedConversation('INVALID_CONVERSATION', '对话编号无效，请重新聊。'); result = checkedReply(event.reply); conversationId.current = event.conversationId; rememberConversationId(event.conversationId); setReply(result); }
        else if (event.type === 'error') throw failedConversation(event.code, event.message || '小栗的对话暂时中断了。');
        else if (event.type === 'done') doneEvent = true;
      };
      try {
        while (request === generation.current) {
          const { done, value } = await reader.read();
          buffer = (buffer + decoder.decode(value, { stream: !done })).replace(/\r\n/g, '\n');
          let boundary: number;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) { const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); process(frame); }
          if (doneEvent) { await reader.cancel(); break; }
          if (done) { if (buffer.trim()) process(buffer); break; }
          if (buffer.length > 100_000) throw new Error('对话内容过长，请重新开始。');
        }
      } finally { reader.releaseLock(); }
      if (request !== generation.current) return null;
      if (!result || !doneEvent) throw new Error('对话这次没说完，可以再试一次。');
      return result;
    } catch (failure) {
      if (request === generation.current && !controller.signal.aborted && mounted.current) {
        const code = typeof failure === 'object' && failure !== null && 'code' in failure ? String(failure.code) : '';
        if (['INVALID_CONVERSATION', 'CODEX_DIALOGUE_ACCOUNT_CHANGED', 'CONVERSATION_NOT_FOUND', 'CONVERSATION_EXPIRED'].includes(code)) {
          conversationId.current = undefined; rememberConversationId(); setNeedsReset(true);
          setError('之前的对话暂时接不上了。点“重新聊”，再和小栗打个招呼吧。');
        } else setError(errorMessage(failure));
      }
      return null;
    } finally {
      if (request === generation.current) { active.current = false; abort.current = null; if (mounted.current) setStage('idle'); }
    }
  }, [needsReset, preparation]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; void cancel(); }; }, [cancel]);
  return { stage, busy: stage !== 'idle', error, reply, needsReset, turn, cancel, reset, prepare, cancelPreparation };
}
