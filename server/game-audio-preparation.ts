import type { GameCue, GameMaterial, Word } from '../shared/contracts.ts';
import { materialCues } from '../shared/game-materials.ts';
import type * as providers from './integrations/index.ts';
import { AppError, type Store } from './store.ts';

type Speech = Pick<typeof providers, 'getCachedSpeech' | 'synthesizeSpeech' | 'ttsStatus' | 'estimateTtsCost'>;
export function gameMaterialAudioCues(word: Word, kind: string, material: GameMaterial): GameCue[] {
  const cues = materialCues(material);
  if (kind === 'cloze' || kind === 'sentence-repair') cues.push({ text: material.sentence!.map((v, i) => i === material.blank ? word.term : v).join(' '), locale: 'en-US' });
  return [...new Map(cues.map(cue => [cue.locale + ':' + cue.text, cue])).values()];
}

/** Explicit parent preparation only. The child path calls cache readiness, never this writer. */
export async function prepareGameAudio({word, kind, material, integration, store, dataDir, signal, check = () => {}}: {
  word: Word; kind: string; material: GameMaterial; integration: Speech; store: Store; dataDir: string; signal: AbortSignal; check?: () => void;
}) {
  for (const cue of gameMaterialAudioCues(word, kind, material)) {
    check();
    if (signal.aborted) throw new AppError('音频准备已停止。', 'CANCELLED', 409);
    const input = { ...cue, tone: 'clear' as const, dataDir, signal };
    if (await integration.getCachedSpeech(input)) continue;
    const status = integration.ttsStatus();
    if (!status.configured || status.provider !== 'elevenlabs') throw new AppError('请先配置 ElevenLabs；只使用已包含的免费额度，不会换服务。', 'GAME_MATERIAL_SERVICE', 503);
    let charge: string | undefined;
    const audio = await integration.synthesizeSpeech({ ...input, freeOnly: true, beforeRequest: () => {
      check(); if (signal.aborted) throw new AppError('音频准备已停止。', 'CANCELLED', 409);
      if (charge) throw new AppError('发音请求不能重复记账。', 'GAME_MATERIAL_OWNER', 500);
      charge = store.reserve('tts', integration.estimateTtsCost(cue.text), cue.text.length);
    } });
    if (audio.mode !== 'api' || !audio.filePath || !Number.isFinite(audio.costCny) || audio.costCny < 0) throw new AppError('没有获得真实缓存发音。', 'GAME_MATERIAL_AUDIO_PENDING', 409);
    if (charge) store.settle(charge, audio.costCny, cue.text.length);
    check();
    if (!await integration.getCachedSpeech(input)) throw new AppError('发音缓存尚未保存，已停止。', 'GAME_MATERIAL_AUDIO_PENDING', 409);
  }
}
