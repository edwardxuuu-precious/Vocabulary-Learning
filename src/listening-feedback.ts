import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpeechResponse } from '../shared/contracts';
import { api } from './api';
import { playBrowserAudio } from './browser-speech';
import { ListeningAcknowledgement, listeningPhrase, type ListeningFeedbackCallbacks } from './listening-acknowledgement';

export function useListeningFeedback(enabled: boolean) {
  const [speaking, setSpeaking] = useState(false);
  const enabledRef = useRef(enabled), mounted = useRef(true);
  enabledRef.current = enabled;
  const controllerRef = useRef<ListeningAcknowledgement | null>(null);
  if (!controllerRef.current) controllerRef.current = new ListeningAcknowledgement({
    enabled: () => enabledRef.current,
    prepare: async signal => {
      const result = await api<SpeechResponse>('/api/speech/tts', { method: 'POST', body: JSON.stringify(listeningPhrase), signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) });
      return result.mode === 'api' && result.audioUrl ? result.audioUrl : null;
    },
    play: (url, context) => playBrowserAudio(url, context, 8000, { volume: .7, onPlayingOnly: true }),
    update: value => { if (mounted.current) setSpeaking(value); },
  });
  const controller = controllerRef.current;
  const begin = useCallback(() => controller.begin(), [controller]);
  const end = useCallback(() => controller.end(), [controller]);
  const callbacks = useRef<ListeningFeedbackCallbacks>({ onBegin: () => controller.begin(), onQuiet: () => controller.quiet(), onSpeech: () => controller.speech(), onRearm: () => controller.rearm(), onEnd: () => controller.end() });
  useEffect(() => { mounted.current = true; controller.activate(); return () => { mounted.current = false; controller.dispose(); }; }, [controller]);
  useEffect(() => { if (enabled) void controller.prepare(); else controller.end(); }, [enabled, controller]);
  return { speaking, begin, end, callbacks: callbacks.current };
}
