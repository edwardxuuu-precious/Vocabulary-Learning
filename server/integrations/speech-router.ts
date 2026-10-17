import type { ServiceStatus } from '../../shared/contracts.ts';
import { createElevenLabsProvider, type TtsInput } from './elevenlabs.ts';
import { createSonioxSession, estimateSonioxSttCost, sonioxStatus } from './soniox.ts';
import { createElevenLabsSttSession, elevenLabsSttStatus, estimateElevenLabsSttCost, type LiveSttSession, type LiveSttSessionInput } from './elevenlabs-stt.ts';
import * as azure from './speech.ts';
import { IntegrationError, throwIfAborted } from './errors.ts';

const elevenlabs = createElevenLabsProvider();
const azureInput = azure.createSpeechProvider(), azureOutput = azure.createSpeechProvider();
function selection(direction: 'input' | 'output'): string {
  const variable = direction === 'input' ? process.env.SPEECH_INPUT_PROVIDER : process.env.SPEECH_OUTPUT_PROVIDER;
  const provider = variable?.trim().toLowerCase() || 'elevenlabs';
  if (!(direction === 'input' ? ['elevenlabs', 'soniox', 'azure'] : ['elevenlabs', 'azure']).includes(provider)) throw new IntegrationError('SPEECH_CONFIG', '语音服务商配置无效，请家长检查本机设置。');
  return provider;
}
export function sttStatus(): ServiceStatus {
  try { const selected = selection('input'); if (selected === 'elevenlabs') return elevenLabsSttStatus(); const status = azureInput.status(); return selected === 'soniox' ? sonioxStatus() : { ...status, provider: 'azure', status: status.available ? 'verified' : status.status }; }
  catch { return { configured: false, available: false, status: 'error', detail: '语音输入服务商配置无效。' }; }
}
export function ttsStatus(): ServiceStatus {
  try { const status = azureOutput.status(); return selection('output') === 'elevenlabs' ? elevenlabs.status() : { ...status, provider: 'azure', status: status.available ? 'verified' : status.status }; }
  catch { return { configured: false, available: false, status: 'error', detail: '语音输出服务商配置无效。' }; }
}
/** Legacy aggregate remains output-oriented so a missing microphone provider never blocks TTS. */
export function speechStatus(): ServiceStatus { const input = sttStatus(), output = ttsStatus(); return { ...output, detail: `朗读：${output.detail} 聆听：${input.detail}` }; }
export const validateTtsInput = azure.validateTtsInput;
export const validateWav = azure.validateWav;
export type { TtsInput, TtsStreamResult } from './elevenlabs.ts';
export function estimateTtsCost(text: string): number { return selection('output') === 'elevenlabs' ? elevenlabs.estimateTtsCost(text) : azure.estimateTtsCost(text); }
export function estimateSttCost(seconds: number): number { const provider = selection('input'); return provider === 'elevenlabs' ? estimateElevenLabsSttCost(seconds) : provider === 'soniox' ? estimateSonioxSttCost(seconds) : azure.estimateSttCost(seconds); }
export function getCachedSpeech(input: TtsInput): Promise<string | undefined> { return selection('output') === 'elevenlabs' ? elevenlabs.getCachedSpeech(input) : azure.getCachedSpeech(input); }
export function synthesizeSpeech(input: TtsInput): Promise<azure.TtsResult> {
  throwIfAborted(input.signal);
  if (input.freeOnly && selection('output') !== 'elevenlabs') return Promise.reject(new IntegrationError('SPEECH_FREE_QUOTA_UNAVAILABLE', '中文讲解仅使用已确认免费额度的 ElevenLabs 音色，请家长检查本机设置。'));
  return selection('output') === 'elevenlabs' ? elevenlabs.synthesizeSpeech(input) : azureOutput.synthesizeSpeech(input);
}
export function streamSpeech(input:TtsInput) {
  throwIfAborted(input.signal);
  if(selection('output')!=='elevenlabs')return Promise.reject(new IntegrationError('SPEECH_STREAM_UNSUPPORTED','当前朗读服务不支持此音频流接口，可以使用本机朗读。'));
  return elevenlabs.streamSpeech(input);
}
export async function transcribeSpeech(input: azure.SttInput): Promise<azure.SttResult> {
  if (selection('input') === 'azure') return azureInput.transcribeSpeech(input);
  return { transcript: '', status: 'unavailable', costCny: 0, message: `${selection('input') === 'elevenlabs' ? 'ElevenLabs Scribe' : 'Soniox'} 使用实时聆听连接，请重新点击麦克风开始；没有把这段 WAV 上传到其他服务商。` };
}
export type { LiveSttSessionInput, LiveSttSession } from './elevenlabs-stt.ts';
export function createLiveSttSession(input: LiveSttSessionInput): Promise<LiveSttSession> {
  const provider = selection('input');
  if (provider === 'elevenlabs') return createElevenLabsSttSession(input);
  if (provider === 'soniox') return createSonioxSession(input);
  return Promise.reject(new IntegrationError('SPEECH_STREAM_UNSUPPORTED', 'Azure 备选使用录音识别接口，请切换录音模式。'));
}
export { createSonioxSession };
