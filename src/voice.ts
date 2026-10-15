import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errorMessage } from './api';
import type { RecognitionResponse, SpeechResponse, VoiceTone } from '../shared/contracts';
import { SpeechPlaybackController, type SpeechSegment, type SpeechState } from './speech-controller';
import { playBrowserAudio, playBrowserLocal } from './browser-speech';
import { playBrowserStream } from './browser-stream-speech';

export function useVoice(enabled: boolean, beforeSpeak?: { current: () => void }) {
  const [state, setState] = useState<SpeechState>({ speaking: false, localMode: false, currentText: '', message: '' });
  const mounted = useRef(true), enabledRef = useRef(enabled), beforeSpeakRef = useRef(beforeSpeak);
  enabledRef.current = enabled; beforeSpeakRef.current = beforeSpeak;
  const controllerRef = useRef<SpeechPlaybackController | null>(null);
  if (!controllerRef.current) controllerRef.current = new SpeechPlaybackController({
    isEnabled: () => enabledRef.current,
    beforeSpeak: () => beforeSpeakRef.current?.current(),
    playStream: playBrowserStream,
    requestAudio: async (segment, signal) => api<SpeechResponse>('/api/speech/tts', { method: 'POST', body: JSON.stringify({ ...segment, tone: segment.tone ?? 'clear' }), signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) }),
    playAudio: playBrowserAudio,
    playLocal: playBrowserLocal,
    update: patch => { if (mounted.current) setState(previous => ({ ...previous, ...patch })); },
  });
  const controller = controllerRef.current;
  const stop = useCallback(() => controller.stop(), [controller]);
  const speak = useCallback((text: string, locale: 'zh-CN' | 'en-US' = 'zh-CN', tone: VoiceTone = 'clear') => controller.speak({ text, locale, tone }), [controller]);
  const speakSequence = useCallback((segments: SpeechSegment[]) => controller.speakSequence(segments), [controller]);
  const speakText = useCallback((text: string, tone: VoiceTone) => {
    const sentences = text.match(/[^。！？!?\n]+[。！？!?]?/g)?.map(part => part.trim()).filter(Boolean) ?? [text];
    return controller.speakSequence(sentences.map(sentence => ({ text: sentence, locale: /^[a-z\s.,!?'’-]+$/i.test(sentence) ? 'en-US' as const : 'zh-CN' as const, tone })));
  }, [controller]);
  const getPlaybackId = useCallback(() => controller.getPlaybackId(), [controller]);
  const stopIfPlayback = useCallback((id: number) => controller.stopIfPlayback(id), [controller]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.stop(); }; }, [controller]);
  useEffect(() => { if (!enabled) controller.stop(); }, [enabled, controller]);
  return { ...state, speak, speakText, speakSequence, stop, getPlaybackId, stopIfPlayback };
}

/** Resample the actual captured device rate into mono, signed 16-bit, 16 kHz PCM. */
function toWav(samples: Float32Array, inputRate: number): ArrayBuffer {
  const length = Math.floor(samples.length * 16000 / inputRate);
  const bytes = new ArrayBuffer(44 + length * 2);
  const view = new DataView(bytes);
  const write = (at: number, text: string) => [...text].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
  write(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, length * 2, true);
  const ratio = inputRate / 16000;
  for (let i = 0; i < length; i += 1) {
    const from = Math.floor(i * ratio), to = Math.max(from + 1, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to && j < samples.length; j += 1) sum += samples[j];
    const sample = Math.max(-1, Math.min(1, sum / (to - from)));
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return bytes;
}

export function useRecorder(beforeStart: () => void) {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState('');
  const [level, setLevel] = useState(0);
  const clean = useRef<(() => void) | null>(null);
  const finish = useRef<((submit: boolean) => void) | null>(null);
  const callback = useRef<(result: RecognitionResponse) => void>(() => {});
  const mounted = useRef(true);
  const captureGeneration = useRef(0);
  const recognitionRequest = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; captureGeneration.current += 1; recognitionRequest.current?.abort(); finish.current?.(false); clean.current?.(); }; }, []);

  const start = useCallback(async (locale: 'zh-CN' | 'en-US', onResult: (result: RecognitionResponse) => void) => {
    if (processing || recording) return;
    const capture = ++captureGeneration.current;
    setProcessing(true);
    beforeStart(); setMessage(''); callback.current = onResult;
    let stream: MediaStream | null = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('浏览器暂时不能录音，请用点击继续。');
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      if (!mounted.current || capture !== captureGeneration.current) { stream.getTracks().forEach(t => t.stop()); return; }
      const context = new AudioContext();
      await context.resume();
      if (!mounted.current || capture !== captureGeneration.current) { stream.getTracks().forEach(t => t.stop()); void context.close(); return; }
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4096, 1, 1);
      const silent = context.createGain(); silent.gain.value = 0;
      const chunks: Float32Array[] = [];
      let count = 0, heard = false, silentFrames = 0, done = false;
      const maxSeconds = locale === 'zh-CN' ? 12 : 8;
      clean.current = () => { processor.disconnect(); source.disconnect(); silent.disconnect(); stream?.getTracks().forEach(t => t.stop()); void context.close(); };
      finish.current = (submit: boolean) => {
        if (done) return; done = true;
        clean.current?.(); clean.current = null; finish.current = null;
        if (!mounted.current || capture !== captureGeneration.current) return;
        setRecording(false);
        if (!submit) return;
        if (!heard || count < context.sampleRate * 0.25) { setMessage('没有听清，点麦克风再试，或用图片继续。'); return; }
        const samples = new Float32Array(count); let offset = 0;
        chunks.forEach(chunk => { samples.set(chunk, offset); offset += chunk.length; });
        const audio = toWav(samples, context.sampleRate);
        setProcessing(true);
        const request = new AbortController(); recognitionRequest.current = request;
        void api<RecognitionResponse>(`/api/speech/stt?locale=${locale}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: audio, signal: request.signal })
          .then(result => { if (mounted.current && capture === captureGeneration.current) { if (result.status !== 'recognized') setMessage(result.message || '这次没有听清。你可以点图继续。'); callback.current(result); } })
          .catch(error => { if (mounted.current && capture === captureGeneration.current) { setMessage(errorMessage(error)); callback.current({ status: 'unavailable', transcript: '', message: errorMessage(error) }); } })
          .finally(() => { if (recognitionRequest.current === request) recognitionRequest.current = null; if (mounted.current && capture === captureGeneration.current) setProcessing(false); });
      };
      processor.onaudioprocess = event => {
        if (done) return;
        const sample = new Float32Array(event.inputBuffer.getChannelData(0));
        chunks.push(sample); count += sample.length;
        const rms = Math.sqrt(sample.reduce((sum, value) => sum + value * value, 0) / sample.length);
        setLevel(rms);
        if (rms > 0.015) { heard = true; silentFrames = 0; } else if (heard) silentFrames += sample.length;
        if (silentFrames > context.sampleRate * 1.45 || count > context.sampleRate * maxSeconds) finish.current?.(true);
      };
      source.connect(processor); processor.connect(silent); silent.connect(context.destination);
      setProcessing(false); setRecording(true);
    } catch (error) {
      stream?.getTracks().forEach(t => t.stop());
      if (mounted.current && capture === captureGeneration.current) {
        setMessage(error instanceof DOMException && error.name === 'NotAllowedError' ? '麦克风还没打开。请让家长开启权限，也可以点图继续。' : errorMessage(error));
        setProcessing(false); setRecording(false);
      }
    }
  }, [beforeStart, processing, recording]);
  return { recording, processing, message, level, start, stop: () => finish.current?.(true), dismissMessage: () => setMessage(''), cancel: () => { captureGeneration.current += 1; recognitionRequest.current?.abort(); recognitionRequest.current = null; finish.current?.(false); setRecording(false); setProcessing(false); setLevel(0); } };
}
