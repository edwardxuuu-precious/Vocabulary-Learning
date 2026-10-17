import type { IntegrationStatus } from '../../shared/contracts.ts';
import { probeCodex } from './codex.ts';
import { speechStatus, sttStatus, ttsStatus } from './speech-router.ts';

export { beginCodexLogin, generateIllustration } from './codex.ts';
export { enrichVocabulary } from './vocabulary.ts';
export { estimateSttCost, estimateTtsCost, getCachedSpeech, synthesizeSpeech, streamSpeech, transcribeSpeech, validateTtsInput, validateWav, createSonioxSession, createLiveSttSession, speechStatus, sttStatus, ttsStatus } from './speech-router.ts';
export type { TtsInput, TtsStreamResult, LiveSttSessionInput, LiveSttSession } from './speech-router.ts';
export { IntegrationError } from './errors.ts';

export async function probeIntegrations(): Promise<IntegrationStatus> {
  return { speech: speechStatus(), stt: sttStatus(), tts: ttsStatus(), codex: await probeCodex() };
}
