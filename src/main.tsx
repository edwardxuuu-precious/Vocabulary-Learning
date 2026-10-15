import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppState, ChatAction, ChatReply, IllustrationJob, ImportRow, LearningAttempt, LearningSession, LearningStep, RecognitionResponse, ServiceStatus, Skill, Word } from '../shared/contracts';
import { api, errorMessage, patch, post } from './api';
import { useRecorder, useVoice } from './voice';
import { useLiveRecorder } from './live-recorder';
import { useConversation } from './conversation';
import { useListeningFeedback } from './listening-feedback';
import { confirmedInterestIntent, microphoneAction } from './speech-controller';
import { MicrophoneHelp } from './microphone-help';
import { LearningOverview } from './learning-overview';
import { dailyLearningPlan, newWordSteps, sessionLearningSummary } from '../shared/learning';
import { learningHintKey, restoreLearningPosition, sessionStepIsLast, sessionTaskProgress } from './learning-session';
import { CHAT_ENABLED, SPEECH_INPUT_ENABLED } from '../shared/features';
import './style.css';
import './parent.css';
import './responsive.css';
import './learning.css';

type IconName = 'play' | 'sound' | 'mic' | 'arrow' | 'pause' | 'close' | 'check' | 'settings' | 'refresh' | 'download' | 'upload' | 'spark' | 'home';
function Icon({ name, size = 22 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    play: <path d="m9 5 11 7-11 7Z" fill="currentColor" stroke="none" />,
    sound: <><path d="m11 4-6 5H2v6h3l6 5Z" /><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" /></>,
    mic: <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8" /></>,
    arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
    pause: <><path d="M8 5v14M16 5v14" strokeWidth="4" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    check: <path d="m5 12 4 4L20 5" />,
    settings: <><path d="m9 3-1 3-3 1-2 4 2 2v3l4 3 3-1 3 1 4-3v-3l2-2-2-4-3-1-1-3Z" /><circle cx="12" cy="11" r="3" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5 8a8 8 0 0 1 14-2l1 6M4 12l1 6a8 8 0 0 0 14-2" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
    upload: <><path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5" /></>,
    spark: <><path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5Z" /></>,
    home: <><path d="m3 11 9-8 9 8M6 9v12h12V9M10 21v-7h4v7" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const statusLabels: Record<Word['assetStatus'], string> = { draft: '待准备', generating: '正在画', review: '待家长确认', approved: '可学习', error: '生成未完成' };
const inputProviderName = (status?: ServiceStatus) => status?.provider === 'azure' ? 'Azure' : status?.provider === 'soniox' ? 'Soniox' : 'ElevenLabs Scribe';
const inputProviderSetup = (status?: ServiceStatus) => status?.provider === 'azure'
  ? '已显式选择 Azure，请在本机 .env 配置 AZURE_SPEECH_KEY 和 AZURE_SPEECH_REGION 后重启。'
  : status?.provider === 'soniox'
    ? '本机当前选择 Soniox，请在 .env 配置对应的输入服务密钥；切换到 ElevenLabs 后，输入和朗读共用 ELEVENLABS_API_KEY。'
    : 'Scribe 负责把声音转成文字，与 TTS 朗读共用本机 .env 中的 ELEVENLABS_API_KEY。输入不需要 Voice ID。密钥只留在本机服务端，不在浏览器填写。';
const shuffle = <T,>(items: T[]) => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; }
  return result;
};
const normalize = (text: string) => text.toLowerCase().replace(/[^a-z]/g, '');
type Screen = 'home' | 'interest' | 'play' | 'reward' | 'parent';
type Step = LearningStep;

function Mascot({ small = false }: { small?: boolean }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (!imageFailed) return <img className={small ? 'mascot small' : 'mascot'} src="/assets/brand/xiaoli-3d-v1.png" alt="" aria-hidden="true" onError={() => setImageFailed(true)} />;
  return <svg className={small ? 'mascot small' : 'mascot'} viewBox="0 0 300 300" aria-hidden="true">
    <ellipse cx="154" cy="269" rx="92" ry="13" fill="#dfddcd" />
    <path d="M86 120 65 48Q65 32 83 42l65 44m20 1 51-49q20-12 19 12l-13 77" fill="#e99257" stroke="#324b3e" strokeWidth="4" />
    <path d="m83 63 13 45 34-16m58 1 32-31-7 47" fill="#f8cf9f" />
    <path d="M83 174Q47 202 59 234l40-6m101-50q62 0 56 41l-40 17" fill="#e99257" stroke="#324b3e" strokeWidth="4" />
    <path d="M95 163q-7 34-3 84l-10 18q-4 10 18 9l29-2 7-26h31l4 25 34 3q20-1 13-12l-13-17 4-85" fill="#8da98a" stroke="#324b3e" strokeWidth="4" />
    <path d="m112 185 40 9 41-9-5 50-38 9-38-9Z" fill="#fff3d8" stroke="#324b3e" strokeWidth="3" />
    <path d="M72 115q4-50 80-49 82 1 86 57-1 63-83 68-86-2-83-76Z" fill="#e99257" stroke="#324b3e" strokeWidth="4" />
    <path d="M78 128q14-26 42 2 31 18 65-2 30-26 46 1-12 55-77 56-66-2-76-57Z" fill="#fff2d9" />
    <path d="M111 119q9-12 17 0m52 0q9-12 17 0" fill="none" stroke="#324b3e" strokeWidth="5" strokeLinecap="round" />
    <path d="m144 135 19 0q-9 17-19 0" fill="#324b3e" /><path d="M154 148q7 9 16-1" fill="none" stroke="#324b3e" strokeWidth="3" strokeLinecap="round" />
    <ellipse cx="104" cy="139" rx="11" ry="6" fill="#e67e62" opacity=".55" /><ellipse cx="205" cy="139" rx="11" ry="6" fill="#e67e62" opacity=".55" />
    <path d="m150 198 0 40m-29-28 21 5m20 0 18-5" stroke="#c6b994" strokeWidth="3" strokeLinecap="round" />
    <path d="m34 90 4-12 4 12 12 4-12 4-4 12-4-12-12-4Zm214 63 3-8 3 8 8 3-8 3-3 8-3-8-8-3Z" fill="#eab956" />
  </svg>;
}

function VoiceWave({ active, level = 0, listening = false }: { active: boolean; level?: number; listening?: boolean }) {
  return <span className={`voice-wave ${active ? 'active' : ''} ${listening ? 'listening' : ''}`} aria-hidden="true">{[0.45, 0.75, 1, 0.6, 0.9, 0.55, 0.8].map((height, index) => <i key={index} style={{ '--bar-height': height, '--bar-index': index, '--input-level': listening ? Math.max(.16, level * 9) : 1 } as React.CSSProperties} />)}</span>;
}

function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [screen, setScreen] = useState<Screen>('home');
  const [fatal, setFatal] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [gate, setGate] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [pause, setPause] = useState(false);
  const [legacyStep, setStep] = useState<Step>('learn');
  const [hinted, setHinted] = useState(false);
  const [feedback, setFeedback] = useState<'correct' | 'try' | null>(null);
  const [practiceOnly, setPracticeOnly] = useState(false);
  const [selected, setSelected] = useState('');
  const [spoken, setSpoken] = useState('');
  const [spelling, setSpelling] = useState<number[]>([]);
  const [proposedInterests, setProposedInterests] = useState<string[] | null>(null);
  const [interestTranscript, setInterestTranscript] = useState('');
  const [interestReturn, setInterestReturn] = useState<'home' | 'play' | 'parent'>('play');
  const [chatPhase, setChatPhase] = useState<'ask' | 'confirm' | 'ready'>('ask');
  const [adultHelp, setAdultHelp] = useState(false);
  const [adultText, setAdultText] = useState('');
  const [interestSource, setInterestSource] = useState<'speech' | 'adult'>('speech');
  const [chatMessage, setChatMessage] = useState('');
  const [dialogueReply, setDialogueReply] = useState<ChatReply | null>(null);
  const [dialogueMode, setDialogueMode] = useState<'live' | 'demo'>('demo');
  const [micPurpose, setMicPurpose] = useState<'command' | 'interest' | 'answer' | 'confirm'>('command');
  const cancelRecording = useRef<() => void>(() => {});
  const voice = useVoice(state?.settings.voiceEnabled ?? true, cancelRecording);
  const legacyRecorder = useRecorder(voice.stop);
  const liveRecorder = useLiveRecorder(voice.stop);
  const recorder = state?.integrations.stt?.provider === 'azure' ? legacyRecorder : liveRecorder;
  const liveTranscript = 'transcript' in recorder ? recorder.transcript : '';
  const sttConfigured = SPEECH_INPUT_ENABLED && ((state?.integrations.stt ?? state?.integrations.speech)?.configured ?? false);
  const dialogueConfigured = CHAT_ENABLED && (state?.integrations.dialogue?.configured ?? false);
  const listeningFeedback = useListeningFeedback(Boolean(CHAT_ENABLED && SPEECH_INPUT_ENABLED && screen === 'interest' && chatPhase === 'ask' && state?.settings.voiceEnabled && sttConfigured && (state.integrations.tts ?? state.integrations.speech)?.configured));
  const conversation = useConversation();
  const dialogueGeneration = useRef(0);
  const dialogueActive = useRef(false);
  const narrationGeneration = useRef(0);
  cancelRecording.current = () => { recorder.cancel(); conversation.cancelPreparation(); };
  const initialLoad = useRef(true);
  const load = useCallback(async () => {
    const next = await api<AppState>('/api/state'); setState(next); setFatal('');
    if (initialLoad.current) { initialLoad.current = false; setScreen('home'); }
    return next;
  }, []);
  useEffect(() => { void load().catch(error => setFatal(errorMessage(error))); }, [load]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) void load().catch(() => {}); };
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [load]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 7000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { if (voice.message) setNotice(voice.message); }, [voice.message]);
  useEffect(() => { if (screen === 'interest' && /麦克风/.test(recorder.message)) setAdultHelp(true); }, [screen, recorder.message]);
  useEffect(() => { if (recorder.message && !recorder.recording && !recorder.processing) conversation.cancelPreparation(); }, [recorder.message, recorder.recording, recorder.processing, conversation.cancelPreparation]);
  const learningPlan = state ? dailyLearningPlan(state) : null;
  const readyWords = learningPlan?.available ?? [];
  const learningSummary = state ? sessionLearningSummary(state) : null;
  const session = state?.activeSession;
  const currentId = session?.wordIds.find(id => !session.completedWordIds.includes(id));
  const word = state?.words.find(item => item.id === currentId);
  const serverPosition = state ? restoreLearningPosition(state) : null;
  const step: Step = session?.tasks ? serverPosition?.step ?? 'learn' : legacyStep;
  const currentTask = session?.tasks?.find(task => task.wordId === currentId);
  const taskProgress = session ? sessionTaskProgress(session) : null;
  const currentSteps = currentTask?.steps ?? (word && state ? newWordSteps(word, state.settings.spellingEnabled) : []);
  const lastStepForWord = session && word ? sessionStepIsLast(session, word.id, step, currentSteps) : false;
  const markHinted = () => {
    setHinted(true);
    if (session && word) try { localStorage.setItem(learningHintKey(session.id, word.id, step, word.learningVersion ?? 0), '1'); } catch { /* Server attempts still retain hint evidence after submission. */ }
  };
  const wordIndex = session ? session.completedWordIds.length : 0;
  const options = useMemo(() => word ? shuffle([word, ...shuffle(readyWords.filter(item => item.id !== word.id)).slice(0, 2)]) : [], [word?.id, word?.learningVersion, step]);
  const letters = useMemo(() => word ? shuffle([...word.term.toLowerCase()].map((letter, index) => ({ letter, id: index }))) : [], [word?.id, word?.learningVersion]);
  useEffect(() => { recorder.cancel(); setDialogueReply(null); dialogueGeneration.current += 1; dialogueActive.current = false; void conversation.cancel(); }, [screen, step, word?.id, pause]);

  const interruptDialogue = () => { narrationGeneration.current += 1; dialogueGeneration.current += 1; dialogueActive.current = false; listeningFeedback.end(); voice.stop(); void conversation.cancel(); };
  const go = (next: Screen) => { recorder.cancel(); interruptDialogue(); setDialogueReply(null); setScreen(next === 'interest' && !CHAT_ENABLED ? 'home' : next); setPause(false); };
  const openInterest = (destination: 'home' | 'play' | 'parent') => {
    if (!CHAT_ENABLED) return;
    setInterestReturn(destination);
    setChatPhase('ask'); setProposedInterests(null); setInterestTranscript(''); setChatMessage(''); setAdultHelp(false); setAdultText('');
    setDialogueReply(null); setDialogueMode('demo');
    go('interest');
  };
  const restartConversation = () => void run(async () => {
    recorder.cancel(); interruptDialogue(); await conversation.reset();
    setDialogueReply(null); setProposedInterests(null); setInterestTranscript(''); setChatMessage(''); setChatPhase('ask');
  });
  const run = async (action: () => Promise<void>) => { setBusy(true); try { await action(); } catch (error) { setNotice(errorMessage(error)); } finally { setBusy(false); } };
  const setGameStep = (next: Step) => { recorder.cancel(); interruptDialogue(); setDialogueReply(null); setStep(next); setHinted(false); setFeedback(null); setPracticeOnly(false); setSelected(''); setSpoken(''); setSpelling([]); };
  const restorePosition = (snapshot: AppState) => {
    const active = snapshot.activeSession;
    if (!active) return;
    let saved: unknown;
    try { saved = JSON.parse(localStorage.getItem(`word-play-${active.id}`) || 'null'); } catch { /* A browser hint can never replace the server plan. */ }
    let position = restoreLearningPosition(snapshot, saved);
    if (active.tasks && position) {
      let localHint = false;
      const learningVersion = snapshot.words.find(item => item.id === position!.wordId)?.learningVersion ?? 0;
      try { localHint = localStorage.getItem(learningHintKey(active.id, position.wordId, position.step, learningVersion)) === '1'; } catch {}
      position = restoreLearningPosition(snapshot, { wordId: position.wordId, step: position.step, hinted: localHint, learningVersion });
    }
    if (!position) return;
    setGameStep(position.step); setHinted(position.hinted); setFeedback(position.feedback); setPracticeOnly(position.practiceOnly);
    if (position.step === 'recall' && position.practiceOnly) setSpoken('一起练习过啦');
    if (position.step === 'spell' && position.feedback === 'correct' && !position.practiceOnly) setSpelling([...snapshot.words.find(item => item.id === position!.wordId)!.term].map((_, index) => index));
  };
  useEffect(() => { if (screen === 'play' && state?.activeSession?.tasks) restorePosition(state); }, [screen, session?.id, currentId, word?.learningVersion, serverPosition?.step]);
  const startSession = async () => {
    recorder.cancel(); interruptDialogue();
    const started = await post<LearningSession>('/api/session/start');
    const next = await load();
    if (!started.wordIds.length || !next.activeSession?.wordIds.length) { setNotice(dailyLearningPlan(next).available.length ? '今天暂时没有到期复习或新词，休息一下，下次再来。' : '词书还没准备好。请家长确认图片，并启用一本词书。'); go('home'); return; }
    if (next.activeSession.completedAt) { go('reward'); return; }
    restorePosition(next);
    go('play');
  };
  const begin = () => void run(startSession);
  useEffect(() => {
    if (!CHAT_ENABLED || screen !== 'interest' || (chatPhase === 'ask' && (interestTranscript || dialogueReply || conversation.busy)) || (chatPhase === 'confirm' && dialogueReply)) return;
    const greeting = '嗨，我是小栗！你最近最喜欢什么呀？';
    const question = sttConfigured ? '点一下麦克风，告诉我吧！' : '我的小耳朵还没准备好，可以叫大人帮一下。';
    const message = chatPhase === 'ask' ? greeting + question : chatPhase === 'confirm' ? `你说，${interestTranscript}。我记对了吗？` : interestTranscript ? interestReturn === 'parent' ? '记住你的原话啦。让大人来准备新的图片吧。' : interestReturn === 'home' ? '记住你的原话啦。以后想聊什么，再来告诉我。' : '我记住啦，我们先认识一个英语新朋友。' : '没关系。我们先一起玩，喜欢的东西以后再聊。';
    const narration = narrationGeneration.current;
    let ownedPlayback: number | undefined;
    const timer = setTimeout(() => {
      if (narration !== narrationGeneration.current || dialogueActive.current) return;
      void voice.speak(message); ownedPlayback = voice.getPlaybackId();
    }, 350);
    return () => { clearTimeout(timer); if (ownedPlayback !== undefined) voice.stopIfPlayback(ownedPlayback); };
  }, [screen, chatPhase, interestTranscript, interestReturn, dialogueReply, conversation.busy]);
  useEffect(() => {
    if (screen === 'play' && session && word && !session.tasks) localStorage.setItem(`word-play-${session.id}`, JSON.stringify({ wordId: word.id, step, hinted, learningVersion: word.learningVersion ?? 0 }));
  }, [screen, session?.id, word?.id, step, hinted]);
  useEffect(() => {
    if (screen !== 'play' || pause || !word || (session?.tasks && !serverPosition)) return;
    const timer = setTimeout(() => {
      if (step === 'learn' || step === 'listen') void voice.speak(word.term, 'en-US', 'clear');
    }, 300);
    return () => { clearTimeout(timer); voice.stop(); };
  }, [screen, step, word?.id, pause, Boolean(serverPosition)]);

  const recordAttempt = async (skill: Skill, correct: boolean, source: LearningAttempt['source'] = 'click', practiceOnly = false) => {
    if (!word || !session) return;
    await post('/api/attempts', { id: crypto.randomUUID(), wordId: word.id, learningVersion: word.learningVersion ?? 0, step, skill, correct, hinted, practiceOnly, source, sessionId: session.id });
  };
  const answer = (id: string) => void run(async () => {
    if (feedback === 'correct' || !word) return;
    setSelected(id);
    const correct = id === word.id;
    await recordAttempt('listen', correct, 'click', options.length < 2);
    setFeedback(correct ? 'correct' : 'try');
    setPracticeOnly(options.length < 2);
    if (!correct) markHinted();
  });
  const finishWord = async () => {
    recorder.cancel(); interruptDialogue();
    if (!word) return;
    await patch('/api/session', { completedWordId: word.id });
    const next = await load();
    const finished = next.activeSession && next.activeSession.wordIds.every(id => next.activeSession!.completedWordIds.includes(id));
    if (finished) { await patch('/api/session', { complete: true }); await load(); go('reward'); }
    else setGameStep('learn');
  };
  const completePlannedStep = async () => {
    if (!session?.tasks || !word) return;
    await patch('/api/session', { completedStep: { wordId: word.id, step } });
    const updated = await load();
    const active = updated.activeSession;
    if (active && active.wordIds.every(id => active.completedWordIds.includes(id))) {
      await patch('/api/session', { complete: true }); await load(); go('reward');
    } else restorePosition(updated);
  };
  const next = () => { recorder.cancel(); interruptDialogue(); void run(async () => {
    if (session?.tasks) { if (step === 'learn' || feedback === 'correct') await completePlannedStep(); return; }
    if (step === 'learn') setGameStep('listen');
    else if (step === 'listen') setGameStep('sound');
    else if (step === 'sound') setGameStep('recall');
    else if (step === 'recall' && state?.settings.spellingEnabled && word && /^[a-z]+$/i.test(word.term)) setGameStep('spell');
    else await finishWord();
  }); };
  const practiceRecall = () => { recorder.cancel(); interruptDialogue(); void run(async () => { await recordAttempt('recall', false, 'click', true); setFeedback('correct'); setPracticeOnly(true); setSpoken('一起练习过啦'); }); };
  const skipSpelling = () => void run(async () => {
    await recordAttempt('spell', false, 'click', true); setFeedback('correct'); setPracticeOnly(true);
    if (session?.tasks) await completePlannedStep(); else await finishWord();
  });
  const onRecallResult = (result: RecognitionResponse) => {
    if (!SPEECH_INPUT_ENABLED || result.status !== 'recognized' || !word) return;
    setSpoken(result.transcript);
    if (normalize(result.transcript) === normalize(word.term)) void run(async () => { await recordAttempt('recall', true, 'speech'); setFeedback('correct'); });
    else setFeedback('try');
  };
  const applyDialogueAction = (action: ChatAction) => {
    if (!CHAT_ENABLED) return;
    if (action.type === 'propose_interest') {
      if (screen !== 'interest' || !action.interest.trim() || action.interest.length > 40) return;
      setProposedInterests([action.interest]); setChatPhase('confirm'); return;
    }
    if (action.type === 'start_learning') {
      void run(startSession); return;
    }
    if (action.type === 'repeat_audio') { if (screen === 'play' && word) void voice.speak(word.term, 'en-US', 'clear'); return; }
    if (action.type === 'next_step') { if (screen === 'play' && (step === 'learn' || feedback === 'correct')) next(); else setNotice('先完成这一个小任务，再一起往前走。'); return; }
    if (action.type === 'pause') { recorder.cancel(); voice.stop(); setPause(true); return; }
    if (action.type === 'exit') { go('home'); return; }
    if (action.type === 'prepare_images') setNotice('图片需要家长在“图片与备课”中生成并确认。');
  };
  const sendChildMessage = async (raw: string, source: 'speech' | 'adult') => {
    if (!CHAT_ENABLED) return;
    const original = raw.trim(); if (!original || conversation.busy || dialogueActive.current) return;
    recorder.cancel(); narrationGeneration.current += 1; voice.stop(); const request = ++dialogueGeneration.current;
    setInterestTranscript(original); setInterestSource(source); setDialogueReply(null); setChatMessage('');
    if (screen === 'interest') { setChatPhase('ask'); setProposedInterests(null); }
    if (!dialogueConfigured) {
      setDialogueMode('demo'); setAdultHelp(true);
      setChatMessage('Codex 对话还没接通。这是引导演示，原话还没有交给小栗理解。');
      return;
    }
    dialogueActive.current = true;
    const result = await conversation.turn(original, { screen, wordId: screen === 'play' ? word?.id : undefined, step: screen === 'play' ? step : undefined });
    if (request !== dialogueGeneration.current || !result) { if (request === dialogueGeneration.current) dialogueActive.current = false; return; }
    setDialogueMode('live'); setDialogueReply(result);
    if (result.action.type === 'propose_interest') {
      if (result.action.interest !== original) { dialogueActive.current = false; setChatMessage('这个兴趣提案和你的原话不同，我们再说一次。'); return; }
      applyDialogueAction(result.action);
    }
    const completed = await voice.speakText(result.text, result.tone);
    if (request === dialogueGeneration.current) { dialogueActive.current = false; if ((completed || !state?.settings.voiceEnabled) && result.action.type !== 'propose_interest') applyDialogueAction(result.action); }
  };
  const startMic = (locale: 'zh-CN' | 'en-US', onResult: (result: RecognitionResponse) => void) => {
    if (!SPEECH_INPUT_ENABLED) return;
    setMicPurpose(locale === 'en-US' ? 'answer' : screen === 'interest' ? chatPhase === 'confirm' ? 'confirm' : 'interest' : 'command');
    const action = microphoneAction({ recording: recorder.recording, processing: recorder.processing, configured: sttConfigured });
    if (action === 'finish') { recorder.stop(); return; }
    if (action === 'cancel') { recorder.cancel(); conversation.cancelPreparation(); return; }
    interruptDialogue();
    if (action === 'unavailable') {
      recorder.cancel();
      if (screen === 'interest') { setAdultHelp(true); setChatMessage('我的小耳朵还没准备好，叫大人帮一下吧。'); void voice.speak('我的小耳朵还没准备好，叫大人帮一下吧。也可以先一起玩。'); }
      else { setNotice('语音识别还没配置好，可以先点图片或跟着练。'); }
      return;
    }
    const prepareDialogue = locale === 'zh-CN' && dialogueConfigured && (screen !== 'interest' || chatPhase === 'ask');
    if (prepareDialogue) conversation.prepare();
    const deliver = (result: RecognitionResponse) => {
      // A recognized callback claims preparation synchronously when it invokes turn(); local/failed/guarded results release it instead.
      try { onResult(result); } finally { if (prepareDialogue) conversation.cancelPreparation(); }
    };
    if (state?.integrations.stt?.provider === 'azure') void legacyRecorder.start(locale, deliver);
    else void liveRecorder.start(locale, deliver, word ? [word.term, ...state!.profile.interests] : state?.profile.interests ?? [], screen === 'interest' && chatPhase === 'ask' && locale === 'zh-CN' ? listeningFeedback.callbacks : undefined);
  };
  const proposeInterestDemo = () => {
    recorder.cancel(); interruptDialogue();
    const original = interestTranscript.trim();
    if (!original) return;
    if (original.length > 40) { setChatMessage('这句有点长，用一句短一点的话告诉我吧。'); return; }
    setDialogueMode('demo'); setDialogueReply(null); setProposedInterests([original]); setChatPhase('confirm');
    setChatMessage('引导演示：这里只确认原话，没有调用 Codex 理解。');
  };
  const onInterestResult = (result: RecognitionResponse) => { if (result.status === 'recognized') void sendChildMessage(result.transcript, 'speech'); };
  const confirmInterests = () => {
    if (!proposedInterests || busy) return;
    recorder.cancel(); narrationGeneration.current += 1; voice.stop();
    const confirmed = proposedInterests;
    void run(async () => {
      await post('/api/profile', { interests: confirmed, onboardingCompleted: true }); await load();
      setChatPhase('ready'); setChatMessage('');
    });
  };
  const repeatInterest = () => { recorder.cancel(); interruptDialogue(); setProposedInterests(null); setInterestTranscript(''); setDialogueReply(null); setChatMessage(''); setChatPhase('ask'); };
  const onConfirmationResult = (result: RecognitionResponse) => {
    if (result.status !== 'recognized') return;
    const intent = confirmedInterestIntent('confirm', result.transcript);
    if (intent === 'retry') repeatInterest();
    else if (intent === 'yes') confirmInterests();
    else void voice.speak('可以说，对，或者说，不是。也可以直接点下面的按钮。');
  };
  const onReadyResult = (result: RecognitionResponse) => {
    if (result.status !== 'recognized') return;
    if (confirmedInterestIntent('ready', result.transcript) === 'start') leaveChat();
    else { setChatMessage('说“开始”就出发，也可以点蓝色按钮。'); void voice.speak('说开始就出发，也可以点蓝色按钮。', 'zh-CN', 'cheerful'); }
  };
  const onCommandResult = (result: RecognitionResponse) => { if (result.status === 'recognized') void sendChildMessage(result.transcript, 'speech'); };
  const skipChat = () => void run(async () => {
    recorder.cancel(); interruptDialogue();
    if (interestReturn === 'parent') go('parent');
    else await startSession();
  });
  const leaveChat = () => void run(async () => { recorder.cancel(); voice.stop(); if (interestReturn === 'play') await startSession(); else go(interestReturn); });

  if (!state) return <main className="loading-screen"><Mascot small /><h1>单词游乐园</h1>{fatal ? <><p role="alert">{fatal}</p><button className="button primary" onClick={() => void load().catch(error => setFatal(errorMessage(error)))}>重新连接本地服务</button><p className="muted">请确认本机启动窗口仍在运行。</p></> : <p>小栗正在打开游乐园…</p>}</main>;

  return <div className={`app screen-${screen}`}>
    <header className="topbar">
      <button className="brand" onClick={() => go('home')} aria-label="回到单词游乐园首页"><span className="brand-mark">✦</span><span>单词游乐园<small>小栗陪你学单词</small></span></button>
      <div className="header-right">
        {SPEECH_INPUT_ENABLED && (screen === 'home' || screen === 'play') && <button className={`voice-command-button ${recorder.recording ? 'recording' : ''}`} onClick={() => startMic('zh-CN', onCommandResult)} aria-label="语音指令，可说开始、再听一次、不会、下一题、退出"><Icon name="mic" size={17} /><span>{recorder.recording ? '我在听…' : recorder.processing ? '听听你说的…' : '告诉小栗'}</span></button>}
        {voice.localMode && <span className="local-mode"><span />本机朗读演示</span>}
        {screen === 'play' ? <button className="icon-button" onClick={() => { recorder.cancel(); voice.stop(); setPause(true); }} aria-label="休息一下"><Icon name="pause" /></button> : screen === 'parent' ? <button className="quiet-button" onClick={() => go('home')}><Icon name="home" size={18} />回到孩子首页</button> : <button className="quiet-button parent-entry" onClick={() => { setGate(true); setPin(''); setPinError(''); }}><Icon name="settings" size={17} />家长空间</button>}
      </div>
    </header>
    {SPEECH_INPUT_ENABLED && micPurpose === 'command' && (screen === 'home' || screen === 'play') && (recorder.recording || recorder.processing || recorder.message) && <div className="command-status" role="status"><Icon name="mic" size={16} /><span>{recorder.message || (recorder.recording ? '我在听。可以说：开始、再听一次、不会、下一题、退出。' : '正在听听你说的…')}</span>{!recorder.recording && !recorder.processing && <button onClick={recorder.dismissMessage} aria-label="关闭语音提示"><Icon name="close" size={15} /></button>}</div>}
    {notice && <div className="toast" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="关闭通知"><Icon name="close" size={16} /></button></div>}

    {CHAT_ENABLED && screen !== 'interest' && screen !== 'parent' && (conversation.busy || dialogueReply || conversation.error) && <section className="conversation-panel" aria-live="polite">{conversation.busy ? <p><span className="spinner" />小栗在想想…</p> : conversation.error ? <p>{conversation.error}</p> : <p>{voice.speaking && voice.currentText ? voice.currentText : dialogueReply?.text}</p>}{conversation.needsReset && <button className="text-button" onClick={restartConversation}>重新聊</button>}<button className="text-button" onClick={() => { interruptDialogue(); setDialogueReply(null); }}>关闭 / 停止</button></section>}

    {screen === 'home' && <main className="home-page page-enter">
      <section className="home-hero">
        <div className="hero-copy"><div className="eyebrow"><span className="little-sun">✦</span> 每天一点，记住新单词</div><h1>和小栗，<br /><span className="highlight">一起学单词。</span></h1><p className="hero-description">听一听，认一认，再试着说出来。<br />先复习，再认识新的单词朋友。</p>
          <button className="button primary start-button" disabled={busy || !readyWords.length} onClick={begin}><span className="play-disc"><Icon name="play" size={23} /></span>{session ? session.completedAt ? '看看今日结果' : '继续学词' : '开始学词'}<Icon name="arrow" /></button>
          <div className="today-learning" aria-label="今日学词安排">{session?.tasks ? <><div><strong>{session.tasks.filter(task => task.mode === 'review').length}</strong><span>🔁 复习</span></div><div><strong>{session.tasks.filter(task => task.mode === 'new').length}</strong><span>✦ 新词</span></div><div><strong>{taskProgress!.total}</strong><span>个小任务</span></div></> : session ? <><div><strong>{session.wordIds.length}</strong><span>本轮单词</span></div><div><strong>{session.completedWordIds.length}</strong><span>已完成练习</span></div><div><strong>{session.wordIds.length - session.completedWordIds.length}</strong><span>还要练习</span></div></> : <><div><strong>{learningPlan!.review.length}</strong><span>🔁 先复习</span></div><div><strong>{learningPlan!.fresh.length}</strong><span>✦ 再学新词</span></div><div><strong>{learningPlan!.taskCount}</strong><span>个小任务</span></div></>}</div>
          <div className="session-meta"><span>◷ 约 {session?.estimatedMinutes ?? (session ? state.settings.sessionMinutes : learningPlan!.estimatedMinutes)} 分钟</span><span>{session && !session.tasks ? '沿用原有安排' : `本轮上限 ${session?.taskLimit ?? learningPlan!.taskLimit} 个小任务`}</span><span>随时可以休息</span></div>
          <details className="daily-plan-note"><summary>给家长：今天怎么安排？</summary>{session ? <p>本轮按启动时的计划继续，已完成 {taskProgress?.completed ?? session.completedWordIds.length} / {taskProgress?.total ?? session.wordIds.length} {session.tasks ? '个小任务' : '个词'}。调整设置会在后续新一轮安排时生效。</p> : <><p>按每个小任务约 45 秒估算，{state.settings.sessionMinutes} 分钟最多安排 {learningPlan!.taskLimit} 个任务。旧词只练到期技能，新词完整认识、听辨和跟读{state.settings.spellingEnabled ? '，并练拼写' : ''}。</p>{learningPlan!.reductionReason && <p>{learningPlan!.reductionReason === 'backlog' ? '待复习的旧词较多，今天减少新词，先巩固旧朋友。' : '为控制今天的任务量，减少了新词。'}本次安排 {learningPlan!.newWordLimit} 个新词。</p>}{learningPlan!.deferredReviewCount > 0 && <p>还有 {learningPlan!.deferredReviewCount} 个旧词留待后续安排，不要求今天全部完成。</p>}</>}</details>
          {!readyWords.length && <p className="home-empty">请家长先在「家长空间」启用一本已准备好的词书。</p>}
        </div>
        <div className="hero-art"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><span className="art-star star-one">✦</span><span className="art-star star-two">✧</span><div className="speech-bubble">等你好久啦！<span>一起玩吧 ↗</span></div><Mascot /><div className="floating-card float-apple"><img src="/assets/words/apple.svg" alt="苹果插画" /><span>apple</span></div><div className="floating-card float-cat"><img src="/assets/words/cat.svg" alt="小猫插画" /><span>cat</span></div><div className="art-label">把喜欢的世界，装进英语里 <span>↗</span></div></div>
      </section>
      <section className="home-bottom">
        {CHAT_ENABLED && <button className="interest-summary" onClick={() => openInterest('home')}><span className="section-icon">☺</span><div><span className="mini-label">可选 · 和小栗聊聊</span><h3>{state.profile.interests.length ? state.profile.interests.join(' · ') : '说说你最近喜欢什么'}</h3><p>让单词图片更有趣，随时可以回去学词</p></div><span className="circle-arrow"><Icon name="arrow" size={19} /></span></button>}
        <div className="sticker-summary"><div><span className="mini-label">我的探险贴纸</span><h3>{state.stickers.length ? `已经收藏 ${state.stickers.length} 张快乐` : '第一张贴纸，等你来拿'}</h3><p>每次完成，留下一点小小的快乐</p></div><div className="sticker-preview"><span className="sticker-shape">{state.stickers.length ? '🌟' : '✦'}</span><span className="sticker-shape pale">☁</span></div></div>
      </section>
      <footer className="home-footer"><span>用耳朵发现 · 用声音表达 · 用自己的节奏长大</span><span className="footer-leaf">✽</span><span>为小小探索家准备</span></footer>
    </main>}

    {CHAT_ENABLED && screen === 'interest' && <main className={`chat-page page-enter chat-phase-${chatPhase}`}>
      <section className="chat-room" aria-label="和小栗聊一聊">
        <aside className={`chat-companion ${recorder.recording ? 'is-listening' : ''} ${voice.speaking || listeningFeedback.speaking ? 'is-speaking' : ''}`}>
          <div className="character-name"><span>嗨，我是</span><strong>小栗<span>✦</span></strong></div>
          <div className="chat-portrait"><div className="portrait-orbit" /><Mascot /><span className="portrait-spark spark-a">✦</span><span className="portrait-spark spark-b">✧</span></div>
          <div className="companion-status"><VoiceWave active={voice.speaking || listeningFeedback.speaking || recorder.recording} level={recorder.level} listening={recorder.recording} /><span>{listeningFeedback.speaking ? '嗯，我在听 · 你可以继续说' : voice.speaking ? '小栗在说话' : recorder.recording ? '我在认真听' : recorder.processing ? '听听你说的' : conversation.busy ? '小栗在想想' : '你的英语玩伴'}</span></div>
        </aside>
        <div className="chat-main">
          <div className="chat-step"><span className="chat-step-icon"><Icon name={chatPhase === 'ready' ? 'spark' : 'sound'} size={20} /></span>{chatPhase === 'ask' ? '可选聊天，让学词更有趣' : chatPhase === 'confirm' ? '这是你说的，对吗？' : '准备好就回去学词'}</div>
          <div className="chat-thread" role="log" aria-live="polite" aria-label="聊天内容">
            {chatPhase === 'ask' && !interestTranscript && !dialogueReply && !conversation.busy && <div className="chat-bubble greeting-bubble"><span className="bubble-eyebrow">第一次见面，真开心！</span><h1>你最近最喜欢<br /><span>什么呀？</span></h1><p>什么都可以，<br />我想听你说。</p><button className="bubble-speaker" onClick={() => void voice.speak('嗨，我是小栗！你最近最喜欢什么呀？')} aria-label="再听小栗问一次"><Icon name="sound" size={24} /></button></div>}
            {interestTranscript && <div className="child-said"><span className="child-avatar">☺</span><div><small>{interestSource === 'adult' ? '大人帮我记下的原话' : '我说'}</small><p>“{interestTranscript}”</p></div></div>}
            {chatPhase === 'confirm' && <div className="chat-bubble confirmation-bubble"><h1>{dialogueMode === 'demo' ? '确认这句原话' : '我记对了吗？'}</h1><p>你可以点下面的大勾勾，<br />也可以直接说“对”。</p><button className="bubble-speaker" onClick={() => void voice.speak(`你说，${interestTranscript}。我记对了吗？`)} aria-label="再听一次确认"><Icon name="sound" size={24} /></button></div>}
            {chatPhase === 'ready' && <div className="chat-bubble ready-bubble"><span className="ready-star">✦</span><h1>{interestTranscript ? '记住啦！' : '先一起玩吧！'}</h1><p>{interestReturn === 'parent' ? '让大人来准备新的单词图片。' : interestReturn === 'home' ? '以后想聊什么，再来告诉我。' : <>现在，一起认识<br /><strong>一个英语新朋友。</strong></>}</p></div>}
            {conversation.busy && <div className="dialogue-thinking" role="status"><span className="spinner" />{conversation.stage === 'thinking' ? '小栗在想想…' : '小栗在组织回答…'}<button className="text-button" onClick={interruptDialogue}>停止</button></div>}
            {dialogueReply && chatPhase !== 'ready' && <div className="chat-bubble dialogue-bubble"><span className="bubble-eyebrow">小栗 · 真实对话</span><p>{voice.speaking && voice.currentText ? voice.currentText : dialogueReply.text}</p><button className="bubble-speaker" onClick={() => void voice.speakText(dialogueReply.text, dialogueReply.tone)} aria-label="再听小栗这句话"><Icon name="sound" size={24} /></button></div>}
            {conversation.error && <div className="chat-notice" role="alert">{conversation.error}<button className="text-button" onClick={conversation.needsReset ? restartConversation : () => void sendChildMessage(interestTranscript, interestSource)}>{conversation.needsReset ? '重新聊' : '再试一次'}</button></div>}
            {chatMessage && <div className="chat-notice" role="status">{chatMessage}</div>}
            {!dialogueConfigured && interestTranscript && chatPhase === 'ask' && <button className="button secondary demo-interest" onClick={proposeInterestDemo}>引导演示：只确认这句原话</button>}
          </div>
          <div className="chat-controls">
            <button className="text-button" onClick={() => go(interestReturn === 'parent' ? 'parent' : 'home')}><Icon name="home" size={20} />{interestReturn === 'parent' ? '返回家长空间' : '返回学词首页'}</button>
            {chatPhase === 'ask' && <>
              <div className="mic-action"><button className={`chat-mic ${recorder.recording ? 'recording' : ''}`} disabled={busy} onClick={() => startMic('zh-CN', onInterestResult)} aria-label={recorder.recording ? '说完了，停止录音' : '告诉小栗你喜欢什么'}><Icon name="mic" size={39} /></button><div><strong>{recorder.recording ? '说完啦，再点一下' : recorder.processing ? '点一下，取消等待' : conversation.busy ? '打断一下，重新说' : '点一下，说给我听'}</strong><span>{recorder.recording ? '慢慢说，我在听' : '用你自己的话就好'}</span></div></div>
              {recorder.recording && <VoiceWave active level={recorder.level} listening />}{liveTranscript && (recorder.recording || recorder.processing) && <p className="stream-transcript" aria-live="polite"><small>正在听，尚未提交</small>{liveTranscript}</p>}
              {recorder.message && <p className="chat-record-status" role="status">{recorder.message}</p>}
              <div className="chat-secondary"><details className="adult-support" open={adultHelp} onToggle={event => setAdultHelp(event.currentTarget.open)}><summary><Icon name="settings" size={18} />请大人帮一下{!sttConfigured && <span className="needs-setup" aria-label="语音待设置" />}</summary><div className="adult-support-content">{sttConfigured && <MicrophoneHelp notify={setNotice} />}{!sttConfigured && <p>{inputProviderName(state.integrations.stt)} 输入尚未配置。可以由大人代录原话，发送给已连接的 Codex；这里不会伪造识别。</p>}{!dialogueConfigured && <p>Codex 对话尚未连接。当前只有明确标注的引导演示，可到家长空间连接官方账号。</p>}<form className="adult-interest-form" onSubmit={event => { event.preventDefault(); void sendChildMessage(adultText, 'adult'); }}><label htmlFor="adult-interest">按孩子自己的说法记下来</label><textarea id="adult-interest" value={adultText} onChange={event => setAdultText(event.target.value)} placeholder="孩子刚才说了什么？" maxLength={400} rows={2} /><div><small>{adultText.length} / 400 字，按孩子的原话发送</small><button className="button secondary" disabled={busy || conversation.busy || !adultText.trim()} type="submit">发给小栗<Icon name="arrow" size={18} /></button></div></form></div></details><button className="text-button skip-chat" disabled={busy} onClick={skipChat}>先和小栗玩<Icon name="arrow" size={18} /></button></div>
            </>}
            {chatPhase === 'confirm' && <><div className="chat-confirm-actions"><button className="chat-confirm yes" onClick={confirmInterests} disabled={busy}><Icon name="check" size={30} />对，就是这个</button><button className="chat-confirm retry" onClick={repeatInterest} disabled={busy}><Icon name="refresh" size={24} />再说一次</button></div><button className={`chat-confirm-mic ${recorder.recording ? 'recording' : ''}`} disabled={busy} onClick={() => startMic('zh-CN', onConfirmationResult)}><Icon name="mic" size={22} />{recorder.recording ? '说完啦，点这里' : recorder.processing ? '取消等待，重新说' : '用声音告诉小栗'}</button>{recorder.message && <p className="chat-record-status" role="status">{recorder.message}</p>}</>}
            {chatPhase === 'ready' && <><button className="button primary chat-launch-button" onClick={leaveChat} disabled={busy}><Icon name={interestReturn === 'play' ? 'play' : 'arrow'} size={25} />{interestReturn === 'parent' ? '回到家长备课' : interestReturn === 'home' ? '回到游乐园' : '开始我的小冒险'}<Icon name="arrow" size={24} /></button><button className={`chat-confirm-mic ${recorder.recording ? 'recording' : ''}`} disabled={busy} onClick={() => startMic('zh-CN', onReadyResult)}><Icon name="mic" size={22} />{recorder.recording ? '说完啦，再点一下' : recorder.processing ? '取消等待' : '说“开始”，一起出发'}</button>{recorder.message && <p className="chat-record-status" role="status">{recorder.message}</p>}</>}
          </div>
        </div>
      </section>
      <p className="chat-footer"><span>✦</span> 小小的你，大大的好奇心。</p>
    </main>}

    {screen === 'play' && word && session && (!session.tasks || serverPosition) && <main className="play-page page-enter">
      <div className="play-progress"><span>{currentTask ? currentTask.mode === 'review' ? '🔁 旧朋友，练一练' : '✦ 认识新朋友' : '沿用原有安排'}</span><div>{session.wordIds.map((id, index) => <span key={id} className={`progress-dot ${session.completedWordIds.includes(id) ? 'done' : ''} ${id === currentId ? 'active' : ''}`}>{session.completedWordIds.includes(id) ? <Icon name="check" size={15} /> : index + 1}</span>)}</div><span>{taskProgress ? `${taskProgress.completed} / ${taskProgress.total} 小任务` : `${wordIndex + 1} / ${session.wordIds.length}`}</span></div>
      <div className="task-step-progress" aria-label="这个单词的小任务进度">{currentSteps.map((item, index) => <span key={item} className={`${session.completedSteps?.[word.id]?.includes(item) || (!session.tasks && index < currentSteps.indexOf(step)) ? 'done' : ''} ${item === step ? 'active' : ''}`} aria-current={item === step ? 'step' : undefined}><b>{({ learn: '✦', listen: '♫', sound: '◉', recall: '☺', spell: 'Aa' })[item]}</b><small>{({ learn: '认识', listen: '听音', sound: '找声音', recall: '跟读', spell: '拼字' })[item]}</small></span>)}</div>
      <div className="game-heading"><div className="step-kicker">{currentTask ? currentTask.mode === 'review' ? '复习旧词' : '新词完整学' : '原有学词安排'} · {currentSteps.indexOf(step) + 1} / {currentSteps.length}</div><h1>{({ learn: '你好，新朋友！', listen: '听一听，找一找', sound: '哪个声音是它？', recall: '自己说说，跟着练', spell: '把字母排排队' })[step]}</h1><p>{({ learn: '点小喇叭，听听它的英语。', listen: '听到的单词，藏在哪张图片里？', sound: '点小喇叭听一听，再选一个声音。', recall: '看着图片自己练习，也可以点喇叭跟读。', spell: '看着图片，把英文单词拼出来。' })[step]}</p></div>
      {step === 'learn' && <div className="learn-layout"><div className="word-illustration"><img src={word.imageUrl} alt={word.meaning} /><span className="image-flower">✽</span></div><div className="learn-details"><span className="mini-label">今天的单词朋友</span><h2>{word.term}</h2><p>{word.meaning}</p><button className="button sound-button" onClick={() => void voice.speak(word.term, 'en-US', 'clear')}><Icon name="sound" size={26} />听单词</button><span className="small-note">可以跟着声音说一说，不着急。</span></div></div>}
      {step === 'listen' && <><button className={`listen-main ${voice.speaking ? 'speaking' : ''}`} onClick={() => void voice.speak(word.term, 'en-US', 'clear')} aria-label="再听一次英文单词"><Icon name="sound" size={30} /><span>再听一次</span></button><div className="answer-grid">{options.map(option => <button key={option.id} disabled={busy || feedback === 'correct'} className={`answer-card ${selected === option.id ? feedback === 'correct' ? 'correct' : 'retry' : ''}`} onClick={() => answer(option.id)} aria-label={`选择${option.meaning}`}><img src={option.imageUrl} alt={option.meaning} /><span className="choice-badge">{selected === option.id && feedback === 'correct' ? <Icon name="check" size={22} /> : '○'}</span></button>)}</div></>}
      {step === 'sound' && <div className="sound-layout"><div className="word-illustration compact"><img src={word.imageUrl} alt={word.meaning} /></div><div className="sound-options">{options.map((option, index) => <div key={option.id} className={`sound-option ${selected === option.id ? feedback === 'correct' ? 'correct' : 'retry' : ''}`}><button className="voice-choice" onClick={() => void voice.speak(option.term, 'en-US', 'clear')} aria-label={`播放声音${index + 1}`}><Icon name="sound" size={28} /><span>声音 {index + 1}</span><span className="sound-wave">▂ ▅ ▃ ▆ ▂</span></button><button className="choose-sound" disabled={busy || feedback === 'correct'} onClick={() => answer(option.id)} aria-label={`选择声音${index + 1}`}>{selected === option.id && feedback === 'correct' ? <Icon name="check" /> : '选它'}</button></div>)}</div></div>}
      {step === 'recall' && <div className="recall-layout"><div className="word-illustration compact"><img src={word.imageUrl} alt={word.meaning} /></div><div className="recall-controls">
        {SPEECH_INPUT_ENABLED ? <><button className={`mic-circle ${recorder.recording ? 'recording' : ''}`} disabled={busy || feedback === 'correct'} onClick={() => startMic('en-US', onRecallResult)} aria-label={recorder.recording ? '说完了，停止录音' : recorder.processing ? '取消识别等待' : '开始说英语'}><Icon name="mic" size={37} /></button><strong>{recorder.recording ? '我在听…' : recorder.processing ? '听听你说的…' : feedback === 'correct' ? '这一次，完成啦！' : '点一下，说英语'}</strong>{spoken && <p className="transcript">{feedback === 'correct' && spoken === '一起练习过啦' ? spoken : <>我听到：“{spoken}”</>}</p>}<p className="recorder-note" role="status">{recorder.message || '说完后停一停，或再点一下麦克风。'}</p></> : <><button className="mic-circle" onClick={() => { markHinted(); void voice.speak(word.term, 'en-US', 'clear'); }} aria-label="播放英文单词，跟着练习"><Icon name="sound" size={37} /></button><strong>{feedback === 'correct' ? '练习记录好啦' : '自己说说，也可以跟读'}</strong><p className="recorder-note">看着图片自己说一说，<br />也可以点喇叭，跟着声音练习。</p>{spoken && <p className="transcript">跟读练习已记录</p>}</>}
        <button className="text-button" disabled={SPEECH_INPUT_ENABLED && recorder.recording} onClick={() => { markHinted(); void voice.speak(word.term, 'en-US', 'clear'); }}><Icon name="sound" size={18} />再听单词</button><button className="button secondary" disabled={busy || feedback === 'correct' || (SPEECH_INPUT_ENABLED && recorder.recording)} onClick={practiceRecall}>我练习过啦<Icon name="check" size={19} /></button>
      </div></div>}
      {step === 'spell' && <div className="spelling-layout"><div className="spell-picture"><img src={word.imageUrl} alt={word.meaning} /><button className="icon-button" onClick={() => { markHinted(); void voice.speak(word.term, 'en-US', 'clear'); }} aria-label="听单词"><Icon name="sound" /></button></div><div className="letter-slots">{[...word.term].map((_, index) => <button key={index} onClick={() => setSpelling(previous => previous.filter((_, at) => at !== index))} aria-label={`移除第${index + 1}个字母`} disabled={feedback === 'correct'}>{spelling[index] === undefined ? '' : letters.find(item => item.id === spelling[index])?.letter}</button>)}</div><div className="letter-bank">{letters.map(item => <button key={item.id} disabled={spelling.includes(item.id) || feedback === 'correct'} onClick={() => { setFeedback(null); setSpelling(previous => previous.length < word.term.length ? [...previous, item.id] : previous); }}>{item.letter}</button>)}</div><button className="button secondary" disabled={busy || spelling.length !== word.term.length || feedback === 'correct'} onClick={() => void run(async () => { const result = spelling.map(id => letters.find(item => item.id === id)?.letter).join('') === word.term.toLowerCase(); await recordAttempt('spell', result); setFeedback(result ? 'correct' : 'try'); setPracticeOnly(false); if (!result) markHinted(); })}>拼好啦<Icon name="check" size={19} /></button><button className="text-button" onClick={() => { markHinted(); setSpelling([...word.term.toLowerCase()].map((_, index) => index)); }}>小栗帮帮我</button><button className="text-button subdued" disabled={busy || feedback === 'correct'} onClick={skipSpelling}>今天先不拼，完成这个单词 →</button></div>}
      <div className={`game-footer ${feedback ? `has-${feedback}` : ''}`}><div className="feedback" role="status">{feedback === 'correct' ? <><span>✦</span> {practiceOnly ? '这次练习，记录好啦。' : '做到了！把这份发现收进口袋。'}</> : feedback === 'try' ? <>慢慢来，再试一次也没关系。</> : <><span className="tiny-fox">✳</span> 小栗陪你，按自己的节奏来。</>}</div>{(step === 'learn' || feedback === 'correct') && <button className="button primary" disabled={busy} onClick={next}>{lastStepForWord ? wordIndex + 1 === session.wordIds.length ? '领取今天的贴纸' : '下一个朋友' : step === 'learn' ? '一起玩一玩' : '继续探险'}<Icon name="arrow" /></button>}</div>
    </main>}
    {screen === 'play' && (!word || (session?.tasks && !serverPosition)) && <main className="empty-page"><Mascot small /><h1>{word ? '这个任务暂时没有接上' : '今天的小任务完成啦'}</h1>{word ? <button className="button primary" onClick={begin}>重新读取任务<Icon name="refresh" /></button> : <button className="button primary" onClick={() => void run(async () => { await patch('/api/session', { complete: true }); await load(); go('reward'); })}>看看我的贴纸<Icon name="arrow" /></button>}</main>}

    {screen === 'reward' && <main className="reward-page page-enter"><div className="reward-confetti">✦ <span>✧</span> ✦</div><span className="step-kicker">今日学词结果</span><h1>今天的练习，完成啦！</h1><p>每一次认真尝试，都值得一张贴纸。</p><div className="reward-sticker"><span>🌟</span><div>单词小探索家</div><small>送给勇敢尝试的你</small></div><div className="reward-summary"><span>完成 <strong>{session?.completedWordIds.length ?? 0}</strong> 个词的练习</span>{taskProgress && <span>完成 <strong>{taskProgress.completed}</strong> 个小任务</span>}<span>收藏了 <strong>{state.stickers.length}</strong> 张探险贴纸</span></div><div className="child-learning-result" aria-label="本轮学习结果"><span>听音独立答对 <strong>{learningSummary!.listen}</strong> 词</span>{SPEECH_INPUT_ENABLED && <span>看图独立说出 <strong>{learningSummary!.recall}</strong> 词</span>}<span>跟着练习 <strong>{learningSummary!.practiced}</strong> 词</span></div><p className="tomorrow-note">练习过的单词，还会在之后的复习中见面。慢慢来，一点点记住。</p><button className="button primary" onClick={() => go('home')}><Icon name="home" />回到学词首页</button></main>}

    {screen === 'parent' && <ParentSpace state={state} load={load} report={setNotice} editInterests={() => openInterest('parent')} />}
    {gate && <div className="modal-backdrop" role="presentation"><section className="modal gate-modal" role="dialog" aria-modal="true" aria-labelledby="gate-title"><button className="modal-close icon-button" onClick={() => setGate(false)} aria-label="关闭"><Icon name="close" /></button><span className="modal-emoji">🌿</span><h2 id="gate-title">这里交给大人啦</h2><p>输入 <strong>2468</strong> 进入家长空间。<br /><small>这是防止孩子误触的入口，不是安全密码。</small></p><form onSubmit={event => { event.preventDefault(); if (pin === '2468') { setGate(false); go('parent'); } else setPinError('再看一下上面的四个数字。'); }}><input autoFocus type="text" inputMode="numeric" maxLength={4} autoComplete="off" value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, ''))} aria-label="家长入口四位数字" /><p className="field-error">{pinError}</p><button className="button primary" type="submit">进入家长空间<Icon name="arrow" /></button></form></section></div>}
    {pause && <div className="modal-backdrop"><section className="modal pause-modal" role="dialog" aria-modal="true" aria-labelledby="pause-title"><span className="modal-emoji">☁️</span><h2 id="pause-title">小小休息站</h2><p>喝口水，伸个懒腰。<br />你的探险已经记好啦。</p><button className="button primary" onClick={() => setPause(false)}><Icon name="play" />我准备好啦</button><button className="text-button" onClick={() => go('home')}>先回游乐园</button></section></div>}
  </div>;
}

function ProviderStatusCard({ title, subtitle, status, setup, symbol }: { title: string; subtitle: string; status: ServiceStatus; setup: string; symbol: string }) {
  return <div className="service-card"><div className="service-top"><span className="service-icon">{symbol}</span><div><h3>{title}</h3><span>{subtitle}</span></div><span className={`service-dot ${status.available ? 'available' : ''}`} /></div><strong className="service-label">{status.status}</strong><p>{status.detail}</p>{!status.configured && <div className="service-hint">{setup}</div>}</div>;
}

function ParentSpace({ state, load, report, editInterests }: { state: AppState; load: () => Promise<AppState>; report: (message: string) => void; editInterests: () => void }) {
  const [tab, setTab] = useState<'learning' | 'packs' | 'assets' | 'settings'>('learning');
  const [text, setText] = useState('');
  const [title, setTitle] = useState('我的第一本词书');
  const [preview, setPreview] = useState<{ rows: ImportRow[]; errors: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [jobs, setJobs] = useState<IllustrationJob[]>([]);
  const [loginUrl, setLoginUrl] = useState('');
  const [loginMessage, setLoginMessage] = useState('');
  const [assetFilter, setAssetFilter] = useState('all');
  const [restoreText, setRestoreText] = useState('');
  const [settings, setSettings] = useState(state.settings);
  const [editingWord, setEditingWord] = useState<Word | null>(null);
  const [editedTerm, setEditedTerm] = useState('');
  const [editedMeaning, setEditedMeaning] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const restoreInput = useRef<HTMLInputElement>(null);
  const act = async (action: () => Promise<void>, success?: string) => { setBusy(true); try { await action(); await load(); if (success) report(success); } catch (error) { report(errorMessage(error)); } finally { setBusy(false); } };
  const getJobs = useCallback(async () => { try { const result = await api<{ jobs: IllustrationJob[] }>('/api/jobs'); setJobs(result.jobs); } catch { /* State already displays provider failures. */ } }, []);
  useEffect(() => { void getJobs(); const timer = setInterval(() => { void getJobs(); if (tab === 'assets') void load().catch(() => {}); }, 5000); return () => clearInterval(timer); }, [getJobs, load, tab]);
  const approved = state.words.filter(word => word.assetStatus === 'approved').length;
  const reviewing = state.words.filter(word => word.assetStatus === 'review').length;
  const activeJobs = jobs.filter(job => job.status === 'queued' || job.status === 'running');
  const shown = state.words.filter(word => assetFilter === 'all' || word.assetStatus === assetFilter);
  const wordsToCreate = state.words.filter(word => word.assetStatus === 'draft' || word.assetStatus === 'error');
  const backup = () => void act(async () => {
    const response = await fetch('/api/backup');
    if (!response.ok) throw new Error('备份未能完成，请重试。');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `单词游乐园备份-${new Date().toLocaleDateString('sv-SE')}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, '备份已准备好，请保存在你方便找到的位置。');

  return <main className="parent-page page-enter"><div className="parent-heading"><div><div className="step-kicker">给好奇心，准备一点养料</div><h1>家长空间 <span>小栗的备课室</span></h1></div><button className="button secondary compact-button" onClick={() => void act(async () => { await getJobs(); }, '状态已更新')} disabled={busy}><Icon name="refresh" size={17} />刷新状态</button></div>
    <div className="parent-stats"><div><span>已备好的单词</span><strong>{approved}<small> / {state.words.length}</small></strong></div><div><span>等待你确认</span><strong>{reviewing}<small> 张图片</small></strong></div><div><span>孩子的探险贴纸</span><strong>{state.stickers.length}<small> 张</small></strong></div><div><span>本月语音 API 估算</span><strong>¥{state.usage.estimatedCny.toFixed(2)}<small> / ¥{state.usage.budgetCny}</small></strong></div></div>
    <nav className="parent-tabs" aria-label="家长空间导航">{([{ id: 'learning', label: '学习记录', icon: '◷' }, { id: 'packs', label: '词书工坊', icon: '▤' }, { id: 'assets', label: '图片与备课', icon: '✦' }, { id: 'settings', label: '发音与设置', icon: '⚙' }] as const).map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}><span>{item.icon}</span>{item.label}{item.id === 'assets' && reviewing > 0 && <b>{reviewing}</b>}</button>)}</nav>
    {tab === 'learning' && <LearningOverview state={state} />}
    {tab === 'packs' && <div className="parent-columns"><section className="parent-panel import-panel"><div className="panel-heading"><h2>带上你自己的单词</h2><span>01 / 导入</span></div><p className="muted">每行一个「英文＋中文意思」，支持从 Excel 复制，也可以读取 CSV。</p><label className="field-label" htmlFor="pack-title">词书名字</label><input id="pack-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={60} placeholder="例如：第一周的小小发现" /><label className="field-label" htmlFor="words-input">英文与中文意思</label><textarea id="words-input" value={text} onChange={event => { setText(event.target.value); setPreview(null); }} placeholder={'apple\t苹果\ncat\t猫\njump\t跳跃'} rows={7} spellCheck={false} /><div className="import-toolbar"><input ref={fileInput} type="file" accept=".csv,.tsv,.txt" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void file.text().then(value => { setText(value); setPreview(null); }); event.target.value = ''; }} /><button className="text-button" onClick={() => fileInput.current?.click()}><Icon name="upload" size={17} />读取词表文件</button><button className="button secondary compact-button" disabled={busy || !text.trim()} onClick={() => void act(async () => { setPreview(await post('/api/import/preview', { text })); })}>预览词表<Icon name="arrow" size={17} /></button></div>
      {preview && <div className="import-preview"><div className="preview-heading"><strong>预览 · {preview.rows.length} 个词</strong><span>请确认中文义项准确</span></div>{preview.errors.length > 0 && <div className="inline-warning" role="alert">{preview.errors.map((error, index) => <p key={index}>{error}</p>)}</div>}<div className="preview-table"><table><thead><tr><th>英文</th><th>中文意思</th></tr></thead><tbody>{preview.rows.map((row, index) => <tr key={index}><td>{row.term}</td><td>{row.meaning}</td></tr>)}</tbody></table></div><button className="button primary" disabled={busy || !preview.rows.length || !title.trim() || preview.errors.length > 0} onClick={() => void act(async () => { await post('/api/packs', { title: title.trim(), rows: preview.rows }); setText(''); setPreview(null); setTab('assets'); }, '词书已创建。接着准备图片，再确认启用。')}>创建这本词书<Icon name="check" size={18} /></button></div>}
    </section><div><section className="parent-panel bookshelf"><div className="panel-heading"><h2>我的小小书架</h2><span>{state.packs.length} 本</span></div>{state.packs.length ? state.packs.map((pack, index) => { const words = state.words.filter(word => word.packId === pack.id); const count = words.filter(word => word.assetStatus === 'approved').length; return <div key={pack.id} className="book-row"><div className={`book-icon book-${index % 3}`}><span>✳</span></div><div className="book-detail"><strong>{pack.title}</strong><small>{count} / {words.length} 个词已备好</small><span className={pack.enabled ? 'text-green' : 'muted'}>{pack.enabled ? '孩子可以学习' : '尚未启用'}</span></div><button className={`toggle ${pack.enabled ? 'on' : ''}`} role="switch" aria-checked={pack.enabled} aria-label={`${pack.enabled ? '停用' : '启用'}${pack.title}`} disabled={busy || (!pack.enabled && !count)} onClick={() => void act(async () => { await patch(`/api/packs/${pack.id}`, { enabled: !pack.enabled }); })}><span /></button></div>; }) : <p className="empty-text">书架还空着。先导入第一本词书吧。</p>}<div className="panel-footnote">只有已确认图片的单词会进入学习。可以先备好一部分，再启用词书。</div></section>{CHAT_ENABLED && <section className="parent-panel interests-panel"><span className="section-icon">🪐</span><div><h2>让图片，长在兴趣上</h2><p>{state.profile.interests.length ? state.profile.interests.join(' · ') : '还没发现孩子的兴趣'}</p><button className="text-button" onClick={editInterests}>和孩子聊一聊<Icon name="arrow" size={17} /></button></div></section>}<section className="quiet-note"><span>🌱</span><p>一次只准备一小组。先试一周，看看孩子最爱哪个环节，再慢慢调整。</p></section></div></div>}
    {tab === 'assets' && <section className="parent-panel assets-panel"><div className="panel-heading"><div><h2>给单词，一张喜欢的脸</h2><p className="muted">兴趣：{state.profile.interests.join('、') || '尚未选择'} · 生成后由你确认，再交给孩子。</p></div><button className="button secondary compact-button" disabled={busy || !wordsToCreate.length || !state.integrations.codex.configured} onClick={() => void act(async () => { for (const item of wordsToCreate.slice(0, 3)) await post(`/api/words/${item.id}/illustrate`); await getJobs(); }, '最多 3 张图片已加入队列。可随时取消。')}><Icon name="spark" size={18} />{state.integrations.codex.available ? '准备下一组图片' : '试生成，验证生图'}</button></div>
      {!state.integrations.codex.available && <div className="inline-warning">Codex 生图尚未验证可用。已连接账号后可点「试生成」进行真实验证；未连接时先到「发音与设置」连接。内置插画可以先体验完整流程。</div>}
      {activeJobs.length > 0 && <div className="active-jobs">{activeJobs.map(job => <div key={job.id}><span className="spinner" /><span>{state.words.find(word => word.id === job.wordId)?.term} · {job.status === 'queued' ? '排队中' : '正在画'}</span><button className="text-button" disabled={busy} onClick={() => void act(async () => { await post(`/api/jobs/${job.id}/cancel`); await getJobs(); })}>取消</button></div>)}</div>}
      <div className="asset-filters">{[{ id: 'all', text: '全部单词' }, { id: 'review', text: '待我确认' }, { id: 'draft', text: '待准备' }, { id: 'approved', text: '可学习' }, { id: 'error', text: '未完成' }].map(item => <button key={item.id} className={assetFilter === item.id ? 'active' : ''} onClick={() => setAssetFilter(item.id)}>{item.text}<span>{state.words.filter(word => item.id === 'all' || word.assetStatus === item.id).length}</span></button>)}</div>
      <div className="asset-grid">{shown.map(item => <article key={item.id} className="asset-card"><div className="asset-image">{item.imageUrl ? <img src={item.imageUrl} alt={`${item.term}：${item.meaning}`} /> : <div className="asset-placeholder"><Icon name="spark" size={30} /><span>等待一张新插画</span></div>}<span className={`asset-status status-${item.assetStatus}`}>{statusLabels[item.assetStatus]}</span></div><div className="asset-info"><div><h3>{item.term}</h3><p>{item.meaning}</p></div><span className="asset-source">{item.imageSource === 'builtin' ? '内置插画' : item.imageSource === 'codex' ? 'Codex' : '本地图片'}</span></div>{item.error && <p className="asset-error">{item.error}</p>}<div className="asset-actions">{item.assetStatus === 'review' && <button className="button primary compact-button" disabled={busy} onClick={() => void act(async () => { await patch(`/api/words/${item.id}`, { assetStatus: 'approved' }); }, '图片已确认；启用词书后孩子就能学习。')}><Icon name="check" size={16} />确认图片</button>}<button className="text-button" disabled={busy || item.assetStatus === 'generating' || !state.integrations.codex.configured} onClick={() => void act(async () => { await post(`/api/words/${item.id}/illustrate`); await getJobs(); })}><Icon name="refresh" size={16} />{item.imageUrl ? '重新画一张' : '生成插画'}</button><button className="text-button edit-word" disabled={busy || item.assetStatus === 'generating'} onClick={() => { setEditingWord(item); setEditedTerm(item.term); setEditedMeaning(item.meaning); }}>编辑词义</button></div></article>)}</div>{!shown.length && <p className="empty-text">这里暂时没有单词。先到词书工坊导入，或换个筛选看看。</p>}<div className="panel-footnote">请检查图片是否准确表达中文义项，是否含答案文字。Codex 订阅使用额度与下方语音 API 预算分别计算。</div>
    </section>}
    {tab === 'settings' && <div className="parent-columns settings-columns"><div><section className="parent-panel"><div className="panel-heading"><h2>每天，按自己的节奏来</h2><span>学习设置</span></div><div className="setting-fields">{([{ key: 'dailyNewWords', label: '每天新朋友', unit: '个', min: 1, max: 10 }, { key: 'dailyReviewWords', label: '每天复习上限', unit: '个', min: 0, max: 30 }, { key: 'sessionMinutes', label: '预计学习时长', unit: '分钟', min: 3, max: 30 }] as const).map(item => <label className="number-setting" key={item.key}><span>{item.label}</span><span><input type="number" min={item.min} max={item.max} value={settings[item.key]} onChange={event => setSettings(previous => ({ ...previous, [item.key]: Number(event.target.value) }))} />{item.unit}</span></label>)}<label className="switch-setting"><div><strong>字母拼搭</strong><small>零基础可先关闭；开启后才记录拼写练习。</small></div><input type="checkbox" checked={settings.spellingEnabled} onChange={event => setSettings(previous => ({ ...previous, spellingEnabled: event.target.checked }))} /></label><label className="switch-setting"><div><strong>单词发音</strong><small>播放清晰英文示范，支持点喇叭重听。</small></div><input type="checkbox" checked={settings.voiceEnabled} onChange={event => setSettings(previous => ({ ...previous, voiceEnabled: event.target.checked }))} /></label><label className="number-setting"><span>每月语音 API 预算<small>人民币估算；到达上限停止新增调用。</small></span><span>¥<input type="number" min="0" max="1000" value={settings.monthlyBudgetCny} onChange={event => setSettings(previous => ({ ...previous, monthlyBudgetCny: Number(event.target.value) }))} /></span></label></div><button className="button primary compact-button" disabled={busy} onClick={() => void act(async () => { await patch('/api/settings', settings); }, '学习设置已保存。')}>保存设置<Icon name="check" size={17} /></button></section><section className="parent-panel"><div className="panel-heading"><h2>把小小进步，好好收好</h2><span>本地备份</span></div><p className="muted">备份包含词表、学习进度和图片音频，不含服务密钥。恢复前，系统会保留旧副本。</p><div className="backup-actions"><button className="button secondary compact-button" disabled={busy} onClick={backup}><Icon name="download" size={18} />下载备份</button><button className="button secondary compact-button" disabled={busy} onClick={() => restoreInput.current?.click()}><Icon name="upload" size={18} />选择备份恢复</button><input type="file" ref={restoreInput} accept=".json" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void file.text().then(setRestoreText).catch(error => report(errorMessage(error))); event.target.value = ''; }} /></div></section></div><div><section className="parent-panel service-panel"><div className="panel-heading"><h2>声音和画笔，准备好了吗？</h2><span>真实服务状态</span></div><p className="muted">ElevenLabs TTS 提供清晰英文单词示范，重复播放优先使用本地缓存。Codex 账号用于准备单词图片。</p><div className="service-hint">使用现有免费额度，不发起充值或付费升级。额度不足时停止云服务调用，可以继续点击练习。密钥只配置在本机 .env，不会放进浏览器。</div>{SPEECH_INPUT_ENABLED && <ProviderStatusCard title={`${inputProviderName(state.integrations.stt)} 语音输入`} subtitle="边说边显示 · 停顿后提交整句话" status={state.integrations.stt ?? state.integrations.speech} setup={inputProviderSetup(state.integrations.stt)} symbol="◖" />}<ProviderStatusCard title={state.integrations.tts?.provider === 'azure' ? 'Azure 单词发音（已显式选择）' : 'ElevenLabs TTS 单词发音'} subtitle="清晰英文示范 · 本地缓存" status={state.integrations.tts ?? state.integrations.speech} setup={state.integrations.tts?.provider === 'azure' ? '已显式选择 Azure，请在本机 .env 配置 AZURE_SPEECH_KEY 和 AZURE_SPEECH_REGION 后重启。' : '单词发音使用本机 .env 中的 ELEVENLABS_API_KEY 和 ELEVENLABS_VOICE_ID。仅合成词条英文并缓存，重复播放优先使用缓存。未配置时明确使用本机发音演示。'} symbol="♫" />{CHAT_ENABLED && <ProviderStatusCard title="Codex OAuth 对话" subtitle="理解孩子原话 · 提出下一步" status={state.integrations.dialogue ?? { configured: false, available: false, status: '尚未验证', detail: '请先连接官方 Codex 账号，再发送一句话验证真实对话。' }} setup="使用下方官方 Codex 登录。对话未接通时只显示明确标注的引导演示；不会把固定脚本当成 AI 回复。" symbol="✦" />}<div className="service-card"><div className="service-top"><span className="service-icon codex-icon">✳</span><div><h3>Codex 账号生图</h3><span>官方 OAuth · 使用你的订阅额度</span></div><span className={`service-dot ${state.integrations.codex.available ? 'available' : ''}`} /></div><strong className="service-label">{state.integrations.codex.status}</strong><p>{state.integrations.codex.detail}</p><button className="button secondary compact-button" disabled={busy} onClick={() => void act(async () => { const response = await post<{ status: string; authUrl?: string; message: string }>('/api/integrations/codex/connect'); setLoginUrl(response.authUrl || ''); setLoginMessage(response.message); })}>连接 / 检查 Codex<Icon name="arrow" size={17} /></button>{loginMessage && <p className="login-message" role="status">{loginMessage}</p>}{loginUrl && <a className="auth-link" href={loginUrl} target="_blank" rel="noreferrer">打开官方授权页面 ↗</a>}</div><div className="privacy-note"><Icon name="check" size={17} /><p>密钥留在本机服务端。当前学词只播放英文单词，不开启麦克风。</p></div></section><section className="parent-panel usage-panel"><div className="panel-heading"><h2>本月用量</h2><span>{state.usage.month}</span></div><div className="budget-line"><strong>¥{state.usage.estimatedCny.toFixed(2)}</strong><span>/ ¥{state.usage.budgetCny} 估算预算</span></div><div className="budget-track"><span style={{ width: `${Math.min(100, state.usage.budgetCny ? state.usage.estimatedCny / state.usage.budgetCny * 100 : 0)}%` }} /></div><div className="usage-details"><span>合成 {state.usage.ttsCharacters.toLocaleString()} 字符</span><span>历史识别 {Math.round(state.usage.sttSeconds)} 秒</span><span>生图任务 {state.usage.imageJobs} 次</span></div><p className="panel-footnote">免费额度调用也按单价折算，作为本地预算记录；此处金额不代表实际扣款，实际以服务商用量和账单为准。Codex 订阅额度单独计量，本地页面无法读取你的剩余额度。</p></section></div></div>}
    <footer className="parent-footer">本机私享 · 单孩学习空间 <span>有提示完成、独立答对和纯练习分别记录；跟读练习不计为独立说出。</span></footer>
    {editingWord && <div className="modal-backdrop"><section className="modal edit-word-modal" role="dialog" aria-modal="true" aria-labelledby="edit-word-title"><button className="icon-button modal-close" onClick={() => setEditingWord(null)} aria-label="取消编辑"><Icon name="close" /></button><span className="modal-emoji">✏️</span><h2 id="edit-word-title">把词义，说明白一点</h2><p>修改英文或中文义项后，会重新准备图片，<br />并重置这个词的掌握进度。</p><form onSubmit={event => { event.preventDefault(); void act(async () => { await patch(`/api/words/${editingWord.id}`, { term: editedTerm.trim(), meaning: editedMeaning.trim() }); setEditingWord(null); }, '词条已更新，请重新准备并确认图片。'); }}><label className="field-label" htmlFor="edit-term">英文</label><input id="edit-term" value={editedTerm} onChange={event => setEditedTerm(event.target.value)} maxLength={60} required autoFocus /><label className="field-label" htmlFor="edit-meaning">这次要学的中文意思</label><input id="edit-meaning" value={editedMeaning} onChange={event => setEditedMeaning(event.target.value)} maxLength={120} required /><button className="button primary" disabled={busy || !editedTerm.trim() || !editedMeaning.trim()} type="submit">保存这个词<Icon name="check" /></button></form></section></div>}
    {restoreText && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="restore-title"><span className="modal-emoji">📦</span><h2 id="restore-title">恢复这份学习备份？</h2><p>当前词表和进度会替换为备份内容。<br />恢复前会自动保留当前副本。</p><button className="button primary" disabled={busy} onClick={() => void act(async () => { let data: unknown; try { data = JSON.parse(restoreText); } catch { throw new Error('这个文件不是有效的 JSON 备份。'); } await post('/api/restore', data); setRestoreText(''); }, '备份已恢复。')}>确认恢复<Icon name="check" /></button><button className="text-button" disabled={busy} onClick={() => setRestoreText('')}>先不恢复</button></section></div>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
