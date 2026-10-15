import { useCallback, useEffect, useRef, useState } from 'react';
import type { RecognitionResponse, VoiceServerMessage } from '../shared/contracts';
import { errorMessage } from './api';
import { MicrophoneReadyBuffer } from './microphone-buffer';
import { ListeningPauseObserver, type ListeningFeedbackCallbacks } from './listening-acknowledgement';

/** Keeps fractional sample positions across frames, then writes actual little-endian PCM. */
class Pcm16Resampler {
  private carry = new Float32Array(0);
  private position = 0;
  constructor(private inputRate: number) {}
  process(input: Float32Array): ArrayBuffer {
    const samples = new Float32Array(this.carry.length + input.length); samples.set(this.carry); samples.set(input, this.carry.length);
    const ratio = this.inputRate / 16000; const values: number[] = [];
    while (this.position + ratio <= samples.length) {
      const from = Math.floor(this.position), to = Math.max(from + 1, Math.floor(this.position + ratio));
      let sum = 0; for (let i = from; i < to; i += 1) sum += samples[i];
      values.push(Math.max(-1, Math.min(1, sum / (to - from)))); this.position += ratio;
    }
    const used = Math.floor(this.position); this.carry = samples.slice(used); this.position -= used;
    const pcm = new ArrayBuffer(values.length * 2); const view = new DataView(pcm);
    values.forEach((value, index) => view.setInt16(index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true));
    return pcm;
  }
}

export function useLiveRecorder(beforeStart: () => void) {
  const [recording, setRecording] = useState(false), [processing, setProcessing] = useState(false);
  const [message, setMessage] = useState(''), [transcript, setTranscript] = useState(''), [level, setLevel] = useState(0);
  const socket = useRef<WebSocket | null>(null), cleanAudio = useRef<(() => void) | null>(null);
  const generation = useRef(0), mounted = useRef(true), active = useRef(false), captureAllowed = useRef(false);
  const buffer = useRef<MicrophoneReadyBuffer | null>(null), finishCapture = useRef<(() => void) | null>(null);
  const pauseObserver = useRef<ListeningPauseObserver | null>(null);
  const hardTimer = useRef<ReturnType<typeof setTimeout> | null>(null), finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null), setupTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endAudio = useCallback(() => {
    captureAllowed.current = false; const clean = cleanAudio.current; cleanAudio.current = null;
    pauseObserver.current?.end(); pauseObserver.current = null;
    try { clean?.(); } catch { /* The cancelled generation already prevents any further upload. */ }
    if (hardTimer.current) clearTimeout(hardTimer.current); hardTimer.current = null;
    if (mounted.current) { setRecording(false); setLevel(0); }
  }, []);
  const cancel = useCallback(() => {
    generation.current += 1; active.current = false; endAudio(); buffer.current?.cancel(); buffer.current = null; finishCapture.current = null;
    if (finishTimer.current) clearTimeout(finishTimer.current); finishTimer.current = null;
    if (setupTimer.current) clearTimeout(setupTimer.current); setupTimer.current = null;
    const ws = socket.current; socket.current = null;
    try { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'cancel' })); } catch { /* A disconnected socket is already cancelled. */ }
    if (ws && ws.readyState < WebSocket.CLOSING) ws.close();
    if (mounted.current) setProcessing(false);
  }, [endAudio]);
  const stop = useCallback(() => { finishCapture.current?.(); }, []);
  const start = useCallback(async (locale: 'zh-CN' | 'en-US', onResult: (result: RecognitionResponse) => void, vocabulary: string[] = [], feedback?: ListeningFeedbackCallbacks) => {
    if (active.current) return;
    cancel(); beforeStart(); const request = generation.current; active.current = true;
    if (feedback) { feedback.onBegin?.(); pauseObserver.current = new ListeningPauseObserver(feedback); }
    setMessage(''); setTranscript(''); setProcessing(true);
    let delivered = false, finishing = false, readySeen = false, captureStarted = false;
    const end = (result?: RecognitionResponse) => {
      if (request !== generation.current) return;
      if (result) delivered = true;
      cancel();
      if (result && mounted.current) { if (result.status !== 'recognized') setMessage(result.message || '我刚才没听清，愿意再说一次吗？'); onResult(result); }
    };
    let ws: WebSocket;
    try { ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/voice/stream`); }
    catch { end({ status: 'unavailable', transcript: '', message: '声音连接没有打开，可以再试一次。' }); return; }
    socket.current = ws;
    const setupComplete = () => {
      if (readySeen && (captureStarted || finishing) && setupTimer.current) { clearTimeout(setupTimer.current); setupTimer.current = null; }
    };
    const pending = new MicrophoneReadyBuffer({
      audio: pcm => {
        if (request !== generation.current || ws.readyState !== WebSocket.OPEN) throw new Error('声音连接断开了，可以再试一次。');
        if (ws.bufferedAmount > 160000) throw new Error('网络有点慢，我们停下来再试一次。');
        ws.send(pcm);
      },
      finish: () => {
        if (request !== generation.current) return;
        if (ws.readyState !== WebSocket.OPEN) throw new Error('声音连接断开了，可以再试一次。');
        ws.send(JSON.stringify({ type: 'finish' }));
        if (finishTimer.current) clearTimeout(finishTimer.current);
        finishTimer.current = setTimeout(() => end({ status: 'unavailable', transcript: '', message: '这次声音没有传完整，可以再说一次。' }), 15000);
      },
    });
    buffer.current = pending;
    const requestFinish = () => {
      if (request !== generation.current || finishing) return;
      finishing = true; endAudio(); setProcessing(true);
      try {
        const result = pending.finish();
        if (result === 'empty') end({ status: 'unclear', transcript: '', message: '这次还没有录到声音，可以再说一次。' });
        else setupComplete();
      } catch (failure) { end({ status: 'unavailable', transcript: '', message: errorMessage(failure) }); }
    };
    finishCapture.current = requestFinish;
    const beginAudio = async () => {
      let stream: MediaStream | null = null, context: AudioContext | null = null;
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('这个浏览器暂时不能打开麦克风，请大人帮一下。');
        // Start capture on the user's click, without waiting for the provider handshake.
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
        if (request !== generation.current || finishing) { stream.getTracks().forEach(track => track.stop()); return; }
        context = new AudioContext(); await context.resume();
        if (request !== generation.current || finishing) { stream.getTracks().forEach(track => track.stop()); void context.close(); return; }
        const source = context.createMediaStreamSource(stream), processor = context.createScriptProcessor(4096, 1, 1), silent = context.createGain(); silent.gain.value = 0;
        const resampler = new Pcm16Resampler(context.sampleRate);
        cleanAudio.current = () => {
          for (const node of [processor, source, silent]) { try { node.disconnect(); } catch {} }
          stream?.getTracks().forEach(track => track.stop()); if (context?.state !== 'closed') void context?.close();
        };
        processor.onaudioprocess = event => {
          if (request !== generation.current || !captureAllowed.current || finishing) return;
          const samples = event.inputBuffer.getChannelData(0), rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length); setLevel(rms);
          try { pending.append(resampler.process(samples)); pauseObserver.current?.frame(rms, samples.length * 1000 / context!.sampleRate); }
          catch (failure) { end({ status: 'unavailable', transcript: '', message: errorMessage(failure) }); }
        };
        captureAllowed.current = true; captureStarted = true;
        source.connect(processor); processor.connect(silent); silent.connect(context.destination);
        setProcessing(false); setRecording(true); setupComplete();
      } catch (failure) {
        stream?.getTracks().forEach(track => track.stop()); if (context?.state !== 'closed') void context?.close();
        if (request === generation.current) end({ status: 'unavailable', transcript: '', message: failure instanceof DOMException && failure.name === 'NotAllowedError' ? '浏览器或系统没有允许麦克风，请大人按下方方法开启。' : failure instanceof DOMException && failure.name === 'NotFoundError' ? '没有找到麦克风，请大人连接或选择录音设备。' : failure instanceof DOMException && failure.name === 'NotReadableError' ? '麦克风现在没有准备好，请大人检查设备后再试。' : errorMessage(failure) });
      }
    };
    ws.onopen = () => { if (request === generation.current) ws.send(JSON.stringify({ type: 'start', locale, vocabulary })); };
    ws.onmessage = event => {
      if (request !== generation.current) return;
      try {
        const message = JSON.parse(String(event.data)) as VoiceServerMessage;
        if (message.type === 'ready') {
          if (!readySeen) { readySeen = true; pending.markReady(); setupComplete(); }
        } else if (message.type === 'transcript') setTranscript(message.text);
        else if (message.type === 'endpoint') { finishing = true; setTranscript(message.text); end({ status: message.text.trim() ? 'recognized' : 'unclear', transcript: message.text, message: message.text.trim() ? undefined : '我刚才没听清，愿意再说一次吗？' }); }
        else if (message.type === 'error') end({ status: 'unavailable', transcript: '', message: message.message });
        else if (message.type === 'closed' && !delivered) end({ status: 'unavailable', transcript: '', message: '这次声音连接结束了，可以再试一次。' });
      } catch (failure) { end({ status: 'unavailable', transcript: '', message: errorMessage(failure) }); }
    };
    ws.onerror = () => end({ status: 'unavailable', transcript: '', message: '声音连接没有接通，可以请大人检查设置。' });
    ws.onclose = () => { if (request === generation.current && !delivered) end({ status: 'unavailable', transcript: '', message: '声音连接断开了，可以再试一次。' }); };
    setupTimer.current = setTimeout(() => end({ status: 'unavailable', transcript: '', message: '麦克风或声音连接等待太久，请再试一次。' }), 20000);
    hardTimer.current = setTimeout(requestFinish, 44500);
    void beginAudio();
  }, [beforeStart, cancel, endAudio]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancel(); }; }, [cancel]);
  return { recording, processing, message, transcript, level, start, stop, cancel, dismissMessage: () => setMessage('') };
}
