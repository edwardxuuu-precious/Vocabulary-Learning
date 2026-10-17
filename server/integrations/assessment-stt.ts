import { IntegrationError } from './errors.ts';

/** Batch Scribe has its own estimate: $0.22/hour, FX 8 and margin, rounded to CNY 3/hour.
 * A consumption estimate only. Never authorizes payment, an upgrade or an overage. */
export const estimateAssessmentStt = (seconds: number) => Math.ceil(Math.max(1, seconds) * 3 / 3600 * 1e6) / 1e6;
export interface AssessmentSttInput { audio: Buffer; language: 'en' | 'zh'; seconds: number; signal: AbortSignal; beforeRequest: (estimate: number) => void }
export function createAssessmentStt(options: { env?: NodeJS.ProcessEnv; fetch?: typeof fetch } = {}) {
  const request = options.fetch ?? fetch;
  return async (input: AssessmentSttInput): Promise<string> => {
    const key = (options.env ?? process.env).ELEVENLABS_API_KEY?.trim();
    const fail = () => new IntegrationError('ASSESSMENT_FREE_QUOTA', '无法确认批量转写的免费额度，已保留原音待处理。请家长检查 ElevenLabs user_read 与转写权限。');
    if (!key) throw fail();
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(45000)]);
    try {
      const quotaResponse = await request('https://api.elevenlabs.io/v1/user/subscription', { redirect: 'error', signal, headers: { 'xi-api-key': key } });
      if (!quotaResponse.ok) { await quotaResponse.body?.cancel(); throw fail(); }
      const quota = await quotaResponse.json();
      // Only a confirmed free account with overages disabled may send audio. The provider enforces
      // the remaining included allowance atomically; 402/429 stays pending, never falls back to paid.
      if (quota?.tier !== 'free' || !['free', 'active', 'trialing'].includes(quota.status) || quota.max_credit_limit_extension !== 0 || quota.can_extend_character_limit === true || quota.allowed_to_extend_character_limit === true || !Number.isFinite(quota.character_count) || !Number.isFinite(quota.character_limit) || quota.character_count < 0 || quota.character_limit <= quota.character_count) throw fail();
      const form = new FormData();
      form.set('file', new Blob([new Uint8Array(input.audio)], { type: 'audio/wav' }), 'answer.wav');
      form.set('model_id', 'scribe_v2'); form.set('language_code', input.language);
      form.set('diarize', 'false'); form.set('tag_audio_events', 'false'); form.set('no_verbatim', 'false');
      input.beforeRequest(estimateAssessmentStt(input.seconds));
      const response = await request('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', redirect: 'error', signal, headers: { 'xi-api-key': key }, body: form });
      if (!response.ok) { await response.body?.cancel(); throw new IntegrationError('ASSESSMENT_STT_FAILED', response.status === 401 || response.status === 403 ? 'ElevenLabs 转写认证失败，原音已保留。' : response.status === 402 || response.status === 429 ? 'ElevenLabs 免费额度或频率受限，原音已保留。' : 'ElevenLabs 转写未完成，原音已保留。'); }
      if (Number(response.headers.get('content-length')) > 200000) { await response.body?.cancel(); throw new IntegrationError('ASSESSMENT_STT_FAILED', '转写响应超过限制。'); }
      const reader = response.body?.getReader(); if (!reader) throw fail();
      let size = 0; const chunks: Uint8Array[] = [];
      try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 200000) { await reader.cancel(); throw fail(); } chunks.push(chunk.value); } } finally { reader.releaseLock(); }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (typeof result.text !== 'string' || result.text.length > 2000) throw new IntegrationError('ASSESSMENT_STT_FAILED', '转写内容无效，原音已保留。');
      return result.text;
    } catch (error) {
      if (error instanceof IntegrationError || (error as { code?: string }).code?.startsWith('BUDGET')) throw error;
      throw new IntegrationError('ASSESSMENT_STT_FAILED', input.signal.aborted ? '批改已中断，原音已保留。' : '转写网络或服务异常，原音已保留。');
    }
  };
}
