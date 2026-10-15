import type { ChatContext, ChatReply } from '../shared/contracts.ts';
import { AppError } from './store.ts';

export function validateChatRequest(body: Record<string, unknown>): { message: string; conversationId?: string; context: ChatContext } {
  if (typeof body.message !== 'string' || !body.message.trim() || body.message.trim().length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body.message)) throw new AppError('一次说一句就好，最多 500 个字。');
  if (body.conversationId !== undefined && (typeof body.conversationId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(body.conversationId))) throw new AppError('聊天编号无效，请重新开始。');
  const c = body.context as Record<string, unknown> | undefined;
  if (!c || !['interest','home','play','reward','parent'].includes(String(c.screen))) throw new AppError('聊天场景无效。');
  if (c.step !== undefined && !['learn','listen','sound','recall','spell'].includes(String(c.step))) throw new AppError('学习步骤无效。');
  if (c.wordId !== undefined && (typeof c.wordId !== 'string' || c.wordId.length > 100)) throw new AppError('单词编号无效。');
  return { message: body.message.trim(), conversationId: body.conversationId as string | undefined, context: { screen: c.screen as ChatContext['screen'], ...(typeof c.wordId === 'string' ? {wordId:c.wordId} : {}), ...(c.step ? {step:c.step as ChatContext['step']} : {}) } };
}

/** A second application boundary: a model reply can only propose these actions. */
export function validateChatReply(reply: ChatReply, message: string): ChatReply {
  const invalid = () => { throw new AppError('小栗这次没有想好，我们再试一句吧。', 'CODEX_REPLY_INVALID', 502); };
  if (!reply || typeof reply.text !== 'string' || !reply.text.trim() || reply.text.length > 500 || !['curious','cheerful','gentle','excited','clear'].includes(reply.tone) || !reply.action || Object.keys(reply).some(key => !['text','tone','action'].includes(key))) return invalid();
  if (reply.action.type === 'propose_interest') {
    if (reply.action.interest !== message || message.length > 40 || Object.keys(reply.action).some(key => !['type','interest'].includes(key))) return invalid();
  } else if (!['none','start_learning','repeat_audio','next_step','pause','exit','prepare_images'].includes(reply.action.type) || Object.keys(reply.action).some(key => key !== 'type')) return invalid();
  return { text: reply.text.trim(), tone: reply.tone, action: reply.action };
}
