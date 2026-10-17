import { GameMaterialLibrary } from './game-material-library';
import { Mascot } from './mascot';
import { CompanionLibrary } from './companion-library';
import { companionFor } from '../shared/companions';
import { RecallPractice } from './recall-practice';
import { PracticeRecordingHistory } from './practice-recording-history';
import { WordIntroduction } from './word-introduction-view';
import { LearningGame } from './learning-games';
import { GoalGame, GoalTrail } from './goal-games';
import { isGoalCheckpoint } from '../shared/learning-goals';
import { currentActivity } from '../shared/game-plan';
import { gameAudioWords } from '../shared/game-rules';
import { EntryHome } from './entry-home';
import { LearningHub, WordPicker } from './learning-hub';
import { ChildGrowth, LearningReward } from './child-growth';
import { learningBackground } from '../shared/learning-backgrounds';
import { assessmentDay } from '../shared/assessment';
import { ParentGate, ParentPinSettings } from './parent-gate';
import { partOfSpeechLabels, partsOfSpeech, wordGamePlan } from '../shared/vocabulary';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ActivityAction, AppState, ChatAction, ChatReply, IllustrationJob, ImportRow, LearningAttempt, LearningSession, LearningStartRequest, LearningStep, RecognitionResponse, ServiceStatus, Skill, Word } from '../shared/contracts';
import { api, errorMessage, patch, post } from './api';
import { useRecorder, useVoice } from './voice';
import { useLiveRecorder } from './live-recorder';
import { useConversation } from './conversation';
import { useListeningFeedback } from './listening-feedback';
import { confirmedInterestIntent, microphoneAction } from './speech-controller';
import { MicrophoneHelp } from './microphone-help';
import { LearningOverview } from './learning-overview';
import { AssessmentCenter, AssessmentPracticeView, AssessmentReport } from './assessments';
import { assessmentLabels, practiceDimension } from '../shared/assessment';
import type { AssessmentGrant } from '../shared/contracts';
import { PackWorkbench, usePackAudio } from './pack-workbench';
import { usePackImages } from './pack-image-status';
import { PackImageReview } from './pack-image-review-panel';
import { learningAnswerOptions, packPreparation, parentPreparationNeeded } from './pack-workflow';
import { dailyLearningPlan, newWordSteps } from '../shared/learning';
import { learningHintKey, restoreLearningPosition, sessionStepIsLast, sessionTaskProgress } from './learning-session';
import { CHAT_ENABLED, SPEECH_INPUT_ENABLED } from '../shared/features';
import './style.css';
import './parent.css';
import './responsive.css';
import './learning.css';
import './entry-home.css';
import './child-learning.css';
import './parent-preparation.css';
import './game-layout.css';

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
const hasWordImage = (url: string) => Boolean(url && !/(?:^|\/)assets\/placeholder\.svg(?:[?#]|$)/i.test(url));
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
type Screen = 'hub' | 'select' | 'home' | 'waiting' | 'interest' | 'play' | 'reward' | 'parent' | 'companions' | 'assessment' | 'growth';
type Step = LearningStep;

function VoiceWave({ active, level = 0, listening = false }: { active: boolean; level?: number; listening?: boolean }) {
  return <span className={`voice-wave ${active ? 'active' : ''} ${listening ? 'listening' : ''}`} aria-hidden="true">{[0.45, 0.75, 1, 0.6, 0.9, 0.55, 0.8].map((height, index) => <i key={index} style={{ '--bar-height': height, '--bar-index': index, '--input-level': listening ? Math.max(.16, level * 9) : 1 } as React.CSSProperties} />)}</span>;
}

function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [screen, setScreen] = useState<Screen>(() => location.hash.startsWith('#challenge/') ? 'assessment' : 'home');
  const [fatal, setFatal] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [gate, setGate] = useState(false);
  const [parentGrant, setParentGrant] = useState<AssessmentGrant>();
  const [gateDestination, setGateDestination] = useState<'parent' | 'assessment'>('parent');
  const [assessmentReturn, setAssessmentReturn] = useState<'parent' | 'reward' | 'growth' | 'hub'>('hub');
  const [rewardSession, setRewardSession] = useState<LearningSession | null>(null);
  const startLock = useRef(false);
  const startRetry = useRef<{key: string; id: string} | undefined>(undefined);
  const [assessmentWordIds, setAssessmentWordIds] = useState<string[]>();
  const [pause, setPause] = useState(false);
  const [legacyStep, setStep] = useState<Step>('learn');
  const [hinted, setHinted] = useState(false);
  const [feedback, setFeedback] = useState<'correct' | 'try' | null>(null);
  const [practiceOnly, setPracticeOnly] = useState(false);
  const [basicHeardIds,setBasicHeardIds]=useState<string[]>([]),[basicAudioUnavailable,setBasicAudioUnavailable]=useState(false);
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
    if (initialLoad.current) { initialLoad.current = false; setScreen(location.hash.startsWith('#challenge/') ? 'assessment' : 'home'); }
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
  const learningPlan = state ? dailyLearningPlan(state, new Date(state.learningNow ?? Date.now())) : null;
  const readyWords = learningPlan?.available ?? [];
  const session = state?.activeSession?.suspendedAt ? null : state?.activeSession;
  const needsPreparation = state ? parentPreparationNeeded(state.packs, state.words) : true;
  const serverPosition = state ? restoreLearningPosition(state) : null;
  const currentId = serverPosition?.wordId ?? session?.wordIds.find(id => !session.completedWordIds.includes(id));
  const word = state?.words.find(item => item.id === currentId);
  const activity = session ? currentActivity(session) : undefined;
  const gameActionLock = useRef(false);
  const [oralBusy,setOralBusy]=useState(false);
  const step: Step = session?.tasks ? serverPosition?.step ?? 'learn' : legacyStep;
  const currentTask = session?.tasks?.find(task => task.wordId === currentId);
  const taskProgress = session ? sessionTaskProgress(session) : null;
  const currentSteps = currentTask?.steps ?? (word && state ? newWordSteps(word, state.settings.spellingEnabled) : []);
  const lastStepForWord = session && word ? sessionStepIsLast(session, word.id, step, currentSteps) : false;
  const markHinted = () => {
    setHinted(true);
    if (session && word) try { localStorage.setItem(learningHintKey(session.id, word.id, step, word.learningVersion ?? 0), '1'); } catch { /* Server attempts still retain hint evidence after submission. */ }
  };
  const wordIndex = session ? session.activities ? Math.max(0, session.wordIds.indexOf(currentId ?? '')) : session.completedWordIds.length : 0;
  const companion = companionFor(session?.id ?? 'welcome', session?.activities ? Math.max(0, session.activities.findIndex(item => item.id === activity?.id)) : taskProgress?.completed ?? wordIndex * 5 + ['learn', 'listen', 'sound', 'recall', 'spell'].indexOf(step));
  const options = useMemo(() => {
    if(!word||!state)return [];
    if(activity?.kind==='standard'&&activity.choices.length>=2)return activity.choices.map(snapshot=>readyWords.find(item=>item.id===snapshot.id)!).filter(Boolean);
    return shuffle(learningAnswerOptions(word, shuffle(readyWords), state.packs));
  }, [word?.id, word?.learningVersion, step, activity?.id, activity?.choices.map(item=>item.id).join('|'), readyWords.map(item => `${item.id}:${item.term}:${item.imageUrl}`).join('|')]);
  const letters = useMemo(() => word ? shuffle([...word.term.toLowerCase()].map((letter, index) => ({ letter, id: index }))) : [], [word?.id, word?.learningVersion]);
  useEffect(() => { recorder.cancel(); setDialogueReply(null); dialogueGeneration.current += 1; dialogueActive.current = false; void conversation.cancel(); }, [screen, step, word?.id, pause]);

  const interruptDialogue = () => { narrationGeneration.current += 1; dialogueGeneration.current += 1; dialogueActive.current = false; listeningFeedback.end(); voice.stop(); void conversation.cancel(); };
  const go = (next: Screen) => { recorder.cancel(); interruptDialogue(); setDialogueReply(null); if (next === 'home' && parentGrant) { void api('/api/parent-gate/assessment/revoke', { method: 'POST', headers: { Authorization: `Bearer ${parentGrant.token}` } }).catch(() => {}); setParentGrant(undefined); } setScreen(next === 'interest' && !CHAT_ENABLED ? 'home' : next); setPause(false); };
  const openParent = () => { recorder.cancel(); interruptDialogue(); setGateDestination('parent'); setGate(true); };
  const openAssessment = (from: 'parent' | 'reward' | 'growth' | 'hub') => { recorder.cancel(); interruptDialogue(); setAssessmentReturn(from); setAssessmentWordIds(from === 'reward' ? rewardSession?.completedWordIds.slice(0, 5) : undefined); go('assessment'); };
  useEffect(() => { if (screen === 'play' && state?.activeSession?.suspendedAt) go('home'); }, [screen, state?.activeSession?.suspendedAt]);
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
    if (position.feedback === 'correct' && (position.step === 'listen' || position.step === 'sound')) setSelected(position.wordId);
    if (position.step === 'recall' && position.practiceOnly) setSpoken('一起练习过啦');
    if (position.step === 'spell' && position.feedback === 'correct' && !position.practiceOnly) setSpelling([...snapshot.words.find(item => item.id === position!.wordId)!.term].map((_, index) => index));
  };
  useEffect(() => { if (screen === 'play' && state?.activeSession?.tasks) restorePosition(state); }, [screen, session?.id, currentId, word?.learningVersion, serverPosition?.step]);
  useEffect(()=>{setBasicHeardIds([]);setBasicAudioUnavailable(false);},[session?.id,word?.id,step,activity?.id]);
  const startSession = async (request: LearningStartRequest = {mode: 'recommended'}) => {
    if (startLock.current) return;
    startLock.current = true;
    try {
      recorder.cancel(); interruptDialogue();
      const key = JSON.stringify(request);
      if (!startRetry.current || startRetry.current.key !== key) startRetry.current = {key, id: crypto.randomUUID()};
      const started = await post<LearningSession>('/api/session/start', {...request, ...(request.mode === 'resume' ? {} : {requestId: startRetry.current.id})});
      const next = await load();
      if (started.completedAt) { setRewardSession(started); startRetry.current = undefined; go('reward'); return; }
      if (!started.wordIds.length || !next.activeSession?.wordIds.length) { startRetry.current = undefined; setNotice('暂时没有可推荐的词，自己选几个朋友吧。'); go('hub'); return; }
      startRetry.current = undefined; restorePosition(next); go('play');
    } finally { startLock.current = false; }
  };
  const begin = () => go('hub');
  const launch = (request: LearningStartRequest) => void run(() => startSession(request));
  const completeRound = async (sessionId: string) => {
    const next = await patch<AppState>('/api/session', {sessionId, complete: true});
    setState(next); setRewardSession(next.lastCompletedSession ?? null); go('reward');
  };
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
    if (screen !== 'play' || step !== 'listen' || pause || !word || (session?.tasks && !serverPosition) || activity && activity.kind !== 'standard') return;
    const timer = setTimeout(() => {
      void voice.speak(word.term, 'en-US', 'clear');
    }, 300);
    return () => { clearTimeout(timer); voice.stop(); };
  }, [screen, step, word?.id, pause, Boolean(serverPosition), activity?.id, activity?.kind]);

  const gameAction = (action: ActivityAction, selectedId?: string) => {
    if (!session || !activity || gameActionLock.current || pause || gate) return;
    gameActionLock.current = true;
    interruptDialogue();
    void run(async () => {
      try {
        const updated = await post<AppState>('/api/session/activity', { sessionId: session.id, activityId: activity.id, action, ...(selectedId ? { selectedId } : {}) });
        setState(updated);
        const audioWords = gameAudioWords(activity, action, selectedId, updated.activeSession?.activityStates?.[activity.id]);
        for (const audioWord of audioWords) {
          const played = await voice.speakCached(audioWord.term,'locale' in audioWord?audioWord.locale as 'en-US'|'zh-CN':'en-US');
          if (!played) {
            const failed = await post<AppState>('/api/session/activity', { sessionId: session.id, activityId: activity.id, action: 'audio-failed' });
            setState(failed);
            break;
          }
        }
        if (action === 'next') {
          if (updated.activeSession && !currentActivity(updated.activeSession)) {
            await completeRound(session!.id);
          } else restorePosition(updated);
        }
      } finally { gameActionLock.current = false; }
    });
  };

  const recordAttempt = async (skill: Skill, correct: boolean, source: LearningAttempt['source'] = 'click', practiceOnly = false) => {
    if (!word || !session) return;
    await post('/api/attempts', { id: crypto.randomUUID(), wordId: word.id, learningVersion: word.learningVersion ?? 0, step, skill, correct, hinted, practiceOnly, source, sessionId: session.id });
  };
  const answer = (id: string) => void run(async () => {
    if (feedback === 'correct' || !word) return;
    setSelected(id);
    const correct = id === word.id;
    const guided=options.length<2||!basicHeardIds.includes(step==='sound'?id:word.id);
    await recordAttempt('listen', correct, 'click', guided);
    setFeedback(correct ? 'correct' : 'try');
    setPracticeOnly(guided);
    if (!correct) markHinted();
  });
  const playBasicAudio=async(term:string,id:string)=>{const played=await voice.speakCached(term,'en-US');if(played)setBasicHeardIds(ids=>[...new Set([...ids,id])]);else setBasicAudioUnavailable(true);};
  const finishWord = async () => {
    recorder.cancel(); interruptDialogue();
    if (!word) return;
    await patch('/api/session', { sessionId: session?.id, completedWordId: word.id });
    const next = await load();
    const finished = next.activeSession && next.activeSession.wordIds.every(id => next.activeSession!.completedWordIds.includes(id));
    if (finished) { await completeRound(session!.id); }
    else setGameStep('learn');
  };
  const completePlannedStep = async () => {
    if (!session?.tasks || !word) return;
    await patch('/api/session', { sessionId: session.id, completedStep: { wordId: word.id, step } });
    const updated = await load();
    const active = updated.activeSession;
    if (active && active.wordIds.every(id => active.completedWordIds.includes(id))) {
      await completeRound(session!.id);
    } else restorePosition(updated);
  };
  const completeAssessmentPractice = (oralStatus?:'recorded'|'skipped') => void run(async () => {
    if (!session || !word) return;
    const dimension = practiceDimension(step); if (!dimension) return;
    const updated = await post<AppState>('/api/session/assessment-practice', { sessionId: session.id, wordId: word.id, learningVersion: word.learningVersion ?? 0, dimension, ...(oralStatus?{oralStatus}:{}) });
    setState(updated);
    const active = updated.activeSession;
    if (active && active.wordIds.every(id => active.completedWordIds.includes(id))) { await completeRound(session!.id); }
    else restorePosition(updated);
  });
  const completeIntroduction = async () => {
    if (!word || step !== 'learn' || busy) return false;
    recorder.cancel(); interruptDialogue();
    let completed = false;
    await run(async () => {
      if (session?.tasks) await completePlannedStep(); else setGameStep('listen');
      completed = true;
    });
    return completed;
  };
  const next = () => { recorder.cancel(); interruptDialogue(); void run(async () => {
    if (session?.tasks) { if (step === 'learn' || feedback === 'correct') await completePlannedStep(); return; }
    if (step === 'learn') setGameStep('listen');
    else if (step === 'listen') setGameStep('sound');
    else if (step === 'sound') setGameStep('recall');
    else if (step === 'recall' && state?.settings.spellingEnabled && word && /^[a-z]+$/i.test(word.term)) setGameStep('spell');
    else await finishWord();
  }); };
  const practiceRecall = (source: 'click' | 'speech') => { recorder.cancel(); interruptDialogue(); void run(async () => { await recordAttempt('recall', false, source, true); setFeedback('correct'); setPracticeOnly(true); setSpoken('一起练习过啦'); }); };
  const skipSpelling = () => void run(async () => {
    await recordAttempt('spell', false, 'click', true); setFeedback('correct'); setPracticeOnly(true);
    if (session?.tasks) await completePlannedStep(); else await finishWord();
  });
  const submitSpelling = () => void run(async () => {
    if (!word) return;
    const correct = spelling.map(id => letters.find(item => item.id === id)?.letter).join('') === word.term.toLowerCase();
    await recordAttempt('spell', correct);
    setFeedback(correct ? 'correct' : 'try'); setPracticeOnly(false);
    if (!correct) markHinted();
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
    const result = await conversation.turn(original, { screen: screen === 'hub' || screen === 'select' || screen === 'waiting' || screen === 'companions' || screen === 'assessment' || screen === 'growth' ? 'home' : screen, wordId: screen === 'play' ? word?.id : undefined, step: screen === 'play' && ['learn','listen','sound','recall','spell'].includes(step) ? step as 'learn' | 'listen' | 'sound' | 'recall' | 'spell' : undefined });
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

  const background = learningBackground((screen === 'reward' ? rewardSession?.id : session?.id) ?? assessmentDay());
  return <div className={`app screen-${screen}`} data-learning-background={background.id} style={{ '--learning-scene': `url("${background.image}")` } as React.CSSProperties}>
    {screen === 'interest' && <header className="topbar">
      <button className="brand" onClick={() => go('home')} aria-label="回到单词游乐园首页"><span className="brand-mark">✦</span><span>单词游乐园<small>小栗陪你学单词</small></span></button>
      <div className="header-right">
        {voice.localMode && <span className="local-mode"><span />本机朗读演示</span>}
        <button className="quiet-button parent-entry" onClick={openParent}><Icon name="settings" size={17} />家长空间</button>
      </div>
    </header>}
    {SPEECH_INPUT_ENABLED && micPurpose === 'command' && (screen === 'home' || screen === 'play') && (recorder.recording || recorder.processing || recorder.message) && <div className="command-status" role="status"><Icon name="mic" size={16} /><span>{recorder.message || (recorder.recording ? '我在听。可以说：开始、再听一次、不会、下一题、退出。' : '正在听听你说的…')}</span>{!recorder.recording && !recorder.processing && <button onClick={recorder.dismissMessage} aria-label="关闭语音提示"><Icon name="close" size={15} /></button>}</div>}
    {notice && <div className="toast" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="关闭通知"><Icon name="close" size={16} /></button></div>}

    {CHAT_ENABLED && screen !== 'interest' && screen !== 'parent' && (conversation.busy || dialogueReply || conversation.error) && <section className="conversation-panel" aria-live="polite">{conversation.busy ? <p><span className="spinner" />小栗在想想…</p> : conversation.error ? <p>{conversation.error}</p> : <p>{voice.speaking && voice.currentText ? voice.currentText : dialogueReply?.text}</p>}{conversation.needsReset && <button className="text-button" onClick={restartConversation}>重新聊</button>}<button className="text-button" onClick={() => { interruptDialogue(); setDialogueReply(null); }}>关闭 / 停止</button></section>}

    {screen === 'home' && <EntryHome busy={busy} openParent={openParent} openGrowth={() => go('growth')} openCompanions={() => go('companions')} begin={needsPreparation ? () => go('waiting') : begin} />}
    {screen === 'hub' && <LearningHub state={state} busy={busy} onStart={launch} onHome={() => go('home')} onSelect={() => go('select')} onTest={() => openAssessment('hub')} onSpeak={word => {void voice.speakCached(word.term, 'en-US');}} />}
    {screen === 'select' && <WordPicker state={state} busy={busy} onStart={launch} onHome={() => go('hub')} onTest={() => openAssessment('hub')} onSpeak={word => {void voice.speakCached(word.term, 'en-US');}} />}
    {screen === 'companions' && <CompanionLibrary onBack={() => go('home')} />}
    {screen === 'growth' && <ChildGrowth growth={state.growth} onBack={() => go('home')} onTest={() => openAssessment('growth')} />}

    {screen === 'waiting' && <main className="entry-waiting page-enter">
      <div className="entry-waiting-character"><Mascot character={companionFor('waiting', state.words.length)} /></div>
      <h1>单词还在准备中</h1>
      <p>请家长帮忙准备一下吧。</p>
      <button className="button primary" onClick={openParent}><Icon name="settings" />找家长帮忙</button>
      <button className="text-button" onClick={() => go('home')}><Icon name="home" size={18} />回到首页</button>
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

    {screen === 'play' && session && activity && isGoalCheckpoint(activity.step) && <GoalGame key={activity.id} activity={activity} session={session} attempts={state.attempts} busy={busy || pause || gate} playing={voice.speaking} onAction={gameAction} onHome={() => go('home')} onPause={() => { recorder.cancel(); voice.stop(); setPause(true); }} stopAudio={voice.stop} />}
    {screen === 'play' && session && activity && !isGoalCheckpoint(activity.step) && activity.kind !== 'standard' && <LearningGame key={activity.id} activity={activity} session={session} busy={busy || pause || gate} playing={voice.speaking} onAction={gameAction} onHome={() => go('home')} onPause={() => { recorder.cancel(); voice.stop(); setPause(true); }} stopAudio={voice.stop} />}
    {screen === 'play' && word && session && (!activity || activity.kind === 'standard'&&!isGoalCheckpoint(activity.step)) && (!session.tasks || serverPosition) && <main className={`lesson-page lesson-${step} page-enter`}>
      <nav className="lesson-nav" aria-label="学习导航">
        <button className="lesson-nav-button" onClick={() => go('home')} aria-label="回到单词游乐园首页"><Icon name="home" size={24} /></button>
        <div className="lesson-progress-wrap">
          <div className="lesson-progress" role="progressbar" aria-label="本轮小任务进度" aria-valuemin={0} aria-valuemax={taskProgress?.total ?? session.wordIds.length} aria-valuenow={taskProgress?.completed ?? session.completedWordIds.length}><span style={{ width: `${100 * (taskProgress?.completed ?? session.completedWordIds.length) / Math.max(1, taskProgress?.total ?? session.wordIds.length)}%` }} /></div>
          <span className="lesson-word-count" aria-label={`第${wordIndex + 1}个单词，共${session.wordIds.length}个`}>{wordIndex + 1} / {session.wordIds.length}</span>
        </div>
        <button className="lesson-nav-button" onClick={() => { recorder.cancel(); voice.stop(); setPause(true); }} aria-label="休息一下"><Icon name="pause" size={24} /></button>
      </nav>
      <div className="lesson-guide"><Mascot small character={companion} /><h1>{practiceDimension(step) ? `${assessmentLabels[practiceDimension(step)!]} · 练一练` : step === 'learn' ? '一起认识这个词' : wordGamePlan(word, true).find(game => game.step === step)?.title}</h1>{currentTask?.mode === 'review' && <span className="lesson-review">复习</span>}</div>
      {session.goalVersion===1&&<GoalTrail session={session} wordId={word.id} attempts={state.attempts}/>}
      <section className="lesson-content" aria-label="当前单词任务">
        {practiceDimension(step) && <AssessmentPracticeView target={{sessionId:session.id,activityId:activity?.id??`${word.id}:${step}`}} stopAudio={voice.stop} key={`${session.id}:${word.id}:${step}`} word={word} dimension={practiceDimension(step)!} choices={options} busy={busy || pause || gate} play={voice.speakCached} complete={completeAssessmentPractice} />}
        {step === 'learn' && <WordIntroduction key={`${word.id}:${word.learningVersion}:${word.term}:${word.meaning}`} word={word} active={!pause && !gate} busy={busy} audioEnabled={state.settings.voiceEnabled} speak={voice.speakSequence} getPlaybackId={voice.getPlaybackId} stopIfPlayback={voice.stopIfPlayback} onComplete={completeIntroduction} />}
        {step === 'listen' && <div className="lesson-listen">
          <button className={`lesson-audio ${voice.speaking ? 'is-playing' : ''}`} onClick={() => void playBasicAudio(word.term,word.id)} aria-label="再听一次英文单词"><Icon name="sound" size={30} /><span>听一听</span></button>
          <div className="lesson-pictures">{options.map(option => <button key={option.id} disabled={busy || voice.speaking || feedback === 'correct'||!basicHeardIds.includes(word.id)&&!basicAudioUnavailable} className={`lesson-picture-choice ${selected === option.id ? feedback === 'correct' ? 'is-correct' : 'is-retry' : ''}`} onClick={() => answer(option.id)} aria-label={`选择${option.meaning}`}><img src={option.imageUrl} alt={option.meaning} /><span className="lesson-choice-mark" aria-hidden="true">{selected === option.id && feedback === 'correct' ? <Icon name="check" size={26} /> : selected === option.id ? <Icon name="refresh" size={22} /> : null}</span></button>)}</div>
        </div>}
        {step === 'sound' && <div className="lesson-match">
          <div className="lesson-picture"><img src={word.imageUrl} alt={word.meaning} /></div>
          <div className="lesson-sound-panel">
            <div className="lesson-sound-instructions" id="sound-instructions">
              <p><span className="lesson-instruction-number">1</span><strong>点这{options.length}个喇叭，听听读音</strong></p>
              <p><span className="lesson-instruction-number">2</span><span>哪个是图里的？点「选这个」</span></p>
            </div>
            <div className="lesson-sounds" role="group" aria-label="听读音，选出图片对应的声音" aria-describedby="sound-instructions">{options.map((option, index) => {
              const playing = voice.speaking && voice.currentText === option.term;
              const correct = selected === option.id && feedback === 'correct';
              return <div key={option.id} className={`lesson-sound-row ${playing ? 'is-playing' : ''} ${selected === option.id ? correct ? 'is-correct' : 'is-retry' : ''}`}>
                <button className="lesson-sound-play" onClick={() => void playBasicAudio(option.term,option.id)} aria-label={`播放声音${index + 1}`}>
                  <span className="lesson-sound-number">{index + 1}</span><Icon name="sound" size={29} /><span className="lesson-sound-label">{playing ? '播放中' : '听读音'}</span>
                  <span className="lesson-sound-wave" aria-hidden="true">{[0, 1, 2, 3, 4].map(bar => <i key={bar} />)}</span>
                </button>
                <button className="lesson-sound-select" disabled={busy || voice.speaking || feedback === 'correct'||!basicHeardIds.includes(option.id)&&!basicAudioUnavailable} onClick={() => answer(option.id)} aria-label={`选择声音${index + 1}`}>{correct ? <>选对啦<Icon name="check" size={22} /></> : <>选这个<Icon name="arrow" size={20} /></>}</button>
              </div>;
            })}</div>
          </div>
        </div>}
        {step === 'recall' && <div className="lesson-practice">
          <div className="lesson-picture"><img src={word.imageUrl} alt={word.meaning} /></div>
          <RecallPractice target={{sessionId:session.id,activityId:activity?.id??`${word.id}:${step}`}} onBusy={setOralBusy} key={`${session.id}:${word.id}:${word.learningVersion ?? 0}`} active={!pause && !gate} busy={busy} completed={feedback === 'correct'}
            demonstrate={() => { markHinted(); return voice.speak(word.term, 'en-US', 'clear'); }} stopAudio={voice.stop} onComplete={practiceRecall} />
        </div>}
        {step === 'spell' && <div className="lesson-spelling">
          <div className="lesson-spell-picture"><img src={word.imageUrl} alt={word.meaning} /><button className="lesson-nav-button" onClick={() => { markHinted(); void voice.speak(word.term, 'en-US', 'clear'); }} aria-label="听单词"><Icon name="sound" size={25} /></button></div>
          <div className="lesson-letter-slots" aria-label="拼写位置">{[...word.term].map((_, index) => <button key={index} onClick={() => setSpelling(previous => previous.filter((_, at) => at !== index))} aria-label={`移除第${index + 1}个字母`} disabled={feedback === 'correct'}>{spelling[index] === undefined ? '' : letters.find(item => item.id === spelling[index])?.letter}</button>)}</div>
          <div className="lesson-letter-bank" aria-label="选择字母">{letters.map(item => <button key={item.id} disabled={spelling.includes(item.id) || feedback === 'correct'} onClick={() => { setFeedback(null); setSpelling(previous => previous.length < word.term.length ? [...previous, item.id] : previous); }}>{item.letter}</button>)}</div>
          <div className="lesson-spell-help"><button onClick={() => { markHinted(); setSpelling([...word.term.toLowerCase()].map((_, index) => index)); }} disabled={busy || feedback === 'correct'}><Icon name="spark" size={19} />帮帮我</button><button disabled={busy || feedback === 'correct'} onClick={skipSpelling}>先跳过<Icon name="arrow" size={18} /></button></div>
        </div>}
      </section>
      {step !== 'learn' && !practiceDimension(step) && <footer className={`lesson-footer ${feedback ? `lesson-feedback-${feedback}` : ''}`}>
        <div className="lesson-feedback" role="status">{feedback === 'correct' ? <><Icon name="check" size={24} />{practiceOnly ? '练习记好啦' : step === 'spell' ? '拼对啦！' : '选对啦！'}</> : feedback === 'try' ? <><Icon name="refresh" size={22} />再试一下，慢慢来</> : null}</div>
        {step === 'spell' && feedback !== 'correct' ? <button className="lesson-next" disabled={busy || spelling.length !== word.term.length} onClick={submitSpelling}>拼好啦<Icon name="check" size={24} /></button> : feedback === 'correct' && <button className="lesson-next" disabled={busy||oralBusy} onClick={next}>{lastStepForWord ? wordIndex + 1 === session.wordIds.length ? '拿贴纸' : '下一个' : '继续'}<Icon name="arrow" size={26} /></button>}
      </footer>}
    </main>}
    {screen === 'play' && (!word || (session?.tasks && !serverPosition)) && <main className="lesson-empty"><Mascot small /><h1>{word ? '小任务还没接上' : '这一轮完成啦'}</h1>{word ? <button className="lesson-next" onClick={begin}>再试一下<Icon name="refresh" /></button> : <button className="lesson-next" onClick={() => void run(async () => { await completeRound(session!.id); })}>看看我的成长<Icon name="arrow" /></button>}<button className="lesson-back" onClick={() => go('home')}>回首页</button></main>}

    {screen === 'reward' && <LearningReward growth={state.growth} session={rewardSession} onGrowth={() => go('growth')} onTest={() => openAssessment('reward')} onAgain={() => launch({mode: 'recommended'})} onSelect={() => go('select')} onHome={() => go('hub')} />}

    {screen === 'parent' && <ParentSpace state={state} grant={parentGrant} onGrant={setParentGrant} load={load} report={setNotice} editInterests={() => openInterest('parent')} onExit={() => go('home')} onTest={() => openAssessment('parent')} />}
    {screen === 'assessment' && <AssessmentCenter parentMode={assessmentReturn === 'parent'} state={state} grant={parentGrant} onGrant={setParentGrant} reload={load} initialWordIds={assessmentWordIds} onExit={() => go(assessmentReturn)} />}
    {gate && <ParentGate onClose={() => setGate(false)} onUnlock={grant => { setParentGrant(grant); setGate(false); go(gateDestination); }} />}
    {pause && <div className="modal-backdrop"><section className="modal lesson-pause" role="dialog" aria-modal="true" aria-labelledby="pause-title"><Mascot small /><h2 id="pause-title">休息一下</h2><p>进度已经记好啦。</p><button className="lesson-next" onClick={() => setPause(false)}><Icon name="play" size={24} />继续玩</button><button className="lesson-back" onClick={() => go('home')}><Icon name="home" size={20} />回首页</button></section></div>}

  </div>;
}

function ProviderStatusCard({ title, subtitle, status, setup, symbol }: { title: string; subtitle: string; status: ServiceStatus; setup: string; symbol: string }) {
  return <div className="service-card"><div className="service-top"><span className="service-icon">{symbol}</span><div><h3>{title}</h3><span>{subtitle}</span></div><span className={`service-dot ${status.available ? 'available' : ''}`} /></div><strong className="service-label">{status.status}</strong><p>{status.detail}</p>{!status.configured && <div className="service-hint">{setup}</div>}</div>;
}

function ParentSpace({ state, grant, onGrant, load, report, editInterests, onExit, onTest }: { state: AppState; grant?:AssessmentGrant; onGrant:(grant?:AssessmentGrant)=>void; load: () => Promise<AppState>; report: (message: string) => void; editInterests: () => void; onExit: () => void; onTest: () => void }) {
  const [tab, setTab] = useState<'learning' | 'packs' | 'assets' | 'settings'>('packs');
  const [busy, setBusy] = useState(false);
  const [loginUrl, setLoginUrl] = useState('');
  const [loginMessage, setLoginMessage] = useState('');
  const [assetPackId, setAssetPackId] = useState(() => state.packs.find(pack => !pack.isSample)?.id ?? state.packs[0]?.id ?? '');
  const [restoreText, setRestoreText] = useState('');
  const [settings, setSettings] = useState(state.settings);
  const [editingWord, setEditingWord] = useState<Word | null>(null);
  const [editedTerm, setEditedTerm] = useState('');
  const [editedMeaning, setEditedMeaning] = useState('');
  const [editedPos, setEditedPos] = useState<Word['partOfSpeech']>();
  const restoreInput = useRef<HTMLInputElement>(null);
  const packAudio = usePackAudio(state.packs, tab === 'packs' || tab === 'assets');
  const packImages = usePackImages(state.packs, tab === 'packs' || tab === 'assets');
  useEffect(() => { if (!state.packs.some(pack => pack.id === assetPackId)) setAssetPackId(state.packs.find(pack => !pack.isSample)?.id ?? state.packs[0]?.id ?? ''); }, [state.packs, assetPackId]);
  const showPackImages = (packId: string) => { setAssetPackId(packId); setTab('assets'); void load().catch(() => {}); window.scrollTo({ top: 0 }); };
  const act = async (action: () => Promise<void>, success?: string) => { setBusy(true); try { await action(); await load(); if (success) report(success); } catch (error) { report(errorMessage(error)); } finally { setBusy(false); } };
  useEffect(() => { if (tab !== 'packs' && tab !== 'assets') return; const timer = setInterval(() => void load().catch(() => {}), 4000); return () => clearInterval(timer); }, [load, tab]);
  const reviewing = state.words.filter(word => word.assetStatus === 'review' && state.packs.some(pack => pack.id === word.packId && !pack.isSample)).length;
  const handoff = async (packId: string) => {
    const pack = state.packs.find(item => item.id === packId);
    if (!pack) throw new Error('这份词表已经变化，请重新选择。');
    const ready = packPreparation(pack, state.words, packAudio.statuses[packId]);
    if (!ready.canEnable) throw new Error(ready.blockedReason);
    if (!pack.enabled) await patch(`/api/packs/${encodeURIComponent(packId)}`, { enabled: true });
    await load(); report(pack.isSample ? '已开启示例体验，不代替正式词表。' : '词表已交给孩子，可以开始学习。'); onExit();
  };

  const backup = () => void act(async () => {
    const response = await fetch('/api/backup');
    if (!response.ok) throw new Error('备份未能完成，请重试。');
    const blob = await response.blob();
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `单词游乐园备份-${new Date().toLocaleDateString('sv-SE')}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, '备份已准备好，请保存在你方便找到的位置。');

  return <main className="parent-page parent-studio page-enter">
    <header className="studio-header"><div className="studio-brand"><Mascot small /><div><h1>家长空间</h1><p>为孩子准备下一次小冒险</p></div></div><button className="prep-secondary" onClick={onExit}><Icon name="home" size={19} />孩子首页</button></header>
    <nav className="studio-tabs" aria-label="家长空间导航">{([{ id: 'packs', label: '备课', icon: '▤' }, { id: 'learning', label: '学习记录', icon: '◷' }, { id: 'settings', label: '设置', icon: '⚙' }] as const).map(item => <button key={item.id} aria-current={tab === item.id || item.id === 'packs' && tab === 'assets' ? 'page' : undefined} className={tab === item.id || item.id === 'packs' && tab === 'assets' ? 'active' : ''} onClick={() => { setTab(item.id); window.scrollTo({ top: 0 }); }}><span aria-hidden="true">{item.icon}</span>{item.label}{item.id === 'packs' && reviewing > 0 && <b>{reviewing}</b>}</button>)}</nav>
    {tab === 'learning' && <><section className="parent-panel"><h2>看、读、翻译，分别测一测</h2><p>孩子可独立录音挑战。这里集中回听、核验，或继续家长现场测试。</p><button className="button primary" onClick={onTest}>集中核验与现场测试</button><AssessmentReport state={state} /></section><PracticeRecordingHistory grant={grant} onGrant={onGrant}/><GameMaterialLibrary state={state} grant={grant} onGrant={onGrant} reload={load}/><LearningOverview state={state} /></>}
    {<div hidden={tab !== 'packs'}><PackWorkbench state={state} statuses={packAudio.statuses} statusErrors={packAudio.errors} refreshAudio={packAudio.refresh} imageStatuses={packImages.statuses} imageErrors={packImages.errors} refreshImages={packImages.refresh} reload={load} report={report} showImages={showPackImages} onExit={onExit} packId={assetPackId} selectPack={setAssetPackId} handoff={handoff} showSettings={() => { setTab('settings'); window.scrollTo({ top: 0 }); }} /></div>}
    {tab === 'assets' && <PackImageReview state={state} packId={assetPackId} setPackId={setAssetPackId} status={packImages.statuses[assetPackId]} statusError={packImages.errors[assetPackId]} refreshImages={packImages.refresh} reload={load} report={report} editWord={word => { setEditingWord(word); setEditedTerm(word.term); setEditedMeaning(word.meaning); setEditedPos(word.partOfSpeech); }} backToPacks={() => setTab('packs')} audioStatus={packAudio.statuses[assetPackId]} handoff={handoff} />}
    {tab === 'settings' && <div className="parent-columns settings-columns"><div><section className="parent-panel"><div className="panel-heading"><h2>每天，按自己的节奏来</h2><span>学习设置</span></div><div className="setting-fields">{([{ key: 'dailyNewWords', label: '每天新朋友', unit: '个', min: 1, max: 10 }, { key: 'dailyReviewWords', label: '每天复习上限', unit: '个', min: 0, max: 30 }, { key: 'sessionMinutes', label: '预计学习时长', unit: '分钟', min: 3, max: 30 }] as const).map(item => <label className="number-setting" key={item.key}><span>{item.label}</span><span><input type="number" min={item.min} max={item.max} value={settings[item.key]} onChange={event => setSettings(previous => ({ ...previous, [item.key]: Number(event.target.value) }))} />{item.unit}</span></label>)}<label className="switch-setting"><div><strong>字母拼搭</strong><small>零基础可先关闭；开启后才记录拼写练习。</small></div><input type="checkbox" checked={settings.spellingEnabled} onChange={event => setSettings(previous => ({ ...previous, spellingEnabled: event.target.checked }))} /></label><label className="switch-setting"><div><strong>亲子出题游戏</strong><small>有家长陪玩时开启“我来出题”；只记录练习。</small></div><input type="checkbox" checked={Boolean(settings.familyGamesEnabled)} onChange={event => setSettings(previous => ({ ...previous, familyGamesEnabled: event.target.checked }))} /></label><label className="switch-setting"><div><strong>进阶情境游戏</strong><small>孩子熟悉已审核的短句、否定和组合后开启。</small></div><input type="checkbox" checked={Boolean(settings.contextGamesEnabled)} onChange={event=>setSettings(previous=>({...previous,contextGamesEnabled:event.target.checked}))}/></label><label className="switch-setting"><div><strong>单词发音</strong><small>播放英文示范和中文释义，支持点喇叭重听。</small></div><input type="checkbox" checked={settings.voiceEnabled} onChange={event => setSettings(previous => ({ ...previous, voiceEnabled: event.target.checked }))} /></label><label className="number-setting"><span>每月语音 API 预算<small>人民币估算；到达上限停止新增调用。</small></span><span>¥<input type="number" min="0" max="1000" value={settings.monthlyBudgetCny} onChange={event => setSettings(previous => ({ ...previous, monthlyBudgetCny: Number(event.target.value) }))} /></span></label></div><button className="button primary compact-button" disabled={busy} onClick={() => void act(async () => { await patch('/api/settings', settings); }, '学习设置已保存。')}>保存设置<Icon name="check" size={17} /></button></section><section className="parent-panel"><div className="panel-heading"><h2>把小小进步，好好收好</h2><span>本地备份</span></div><p className="muted">备份包含词表、学习进度和图片音频，不含服务密钥。恢复前，系统会保留旧副本。</p><div className="backup-actions"><button className="button secondary compact-button" disabled={busy} onClick={backup}><Icon name="download" size={18} />下载备份</button><button className="button secondary compact-button" disabled={busy} onClick={() => restoreInput.current?.click()}><Icon name="upload" size={18} />选择备份恢复</button><input type="file" ref={restoreInput} accept=".json" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void file.text().then(setRestoreText).catch(error => report(errorMessage(error))); event.target.value = ''; }} /></div></section><ParentPinSettings /></div><div><section className="parent-panel service-panel"><div className="panel-heading"><h2>声音和画笔，准备好了吗？</h2><span>真实服务状态</span></div><p className="muted">ElevenLabs TTS 提供英文示范和认识页中文释义，重复播放优先使用本地缓存。Codex 账号用于补全中文、词性和准备单词图片。</p><div className="service-hint">使用现有免费额度，不发起充值或付费升级。额度不足时停止云服务调用，可以继续点击练习。密钥只配置在本机 .env，不会放进浏览器。</div>{SPEECH_INPUT_ENABLED && <ProviderStatusCard title={`${inputProviderName(state.integrations.stt)} 语音输入`} subtitle="边说边显示 · 停顿后提交整句话" status={state.integrations.stt ?? state.integrations.speech} setup={inputProviderSetup(state.integrations.stt)} symbol="◖" />}<ProviderStatusCard title={state.integrations.tts?.provider === 'azure' ? 'Azure 单词发音（已显式选择）' : 'ElevenLabs TTS 单词发音'} subtitle="清晰英文示范 · 本地缓存" status={state.integrations.tts ?? state.integrations.speech} setup={state.integrations.tts?.provider === 'azure' ? '已显式选择 Azure，请在本机 .env 配置 AZURE_SPEECH_KEY 和 AZURE_SPEECH_REGION 后重启。' : '单词发音使用本机 .env 中的 ELEVENLABS_API_KEY 和 ELEVENLABS_VOICE_ID。英文示范使用已有缓存；中文首次合成前确认免费额度，成功后缓存。密钥需有 user_read 只读权限；无法确认时暂停中文朗读，可点击继续。'} symbol="♫" />{CHAT_ENABLED && <ProviderStatusCard title="Codex OAuth 对话" subtitle="理解孩子原话 · 提出下一步" status={state.integrations.dialogue ?? { configured: false, available: false, status: '尚未验证', detail: '请先连接官方 Codex 账号，再发送一句话验证真实对话。' }} setup="使用下方官方 Codex 登录。对话未接通时只显示明确标注的引导演示；不会把固定脚本当成 AI 回复。" symbol="✦" />}<div className="service-card"><div className="service-top"><span className="service-icon codex-icon">✳</span><div><h3>Codex 账号生图</h3><span>官方 OAuth · 使用你的订阅额度</span></div><span className={`service-dot ${state.integrations.codex.available ? 'available' : ''}`} /></div><strong className="service-label">{state.integrations.codex.status}</strong><p>{state.integrations.codex.detail}</p><button className="button secondary compact-button" disabled={busy} onClick={() => void act(async () => { const response = await post<{ status: string; authUrl?: string; message: string }>('/api/integrations/codex/connect'); setLoginUrl(response.authUrl || ''); setLoginMessage(response.message); })}>连接 / 检查 Codex<Icon name="arrow" size={17} /></button>{loginMessage && <p className="login-message" role="status">{loginMessage}</p>}{loginUrl && <a className="auth-link" href={loginUrl} target="_blank" rel="noreferrer">打开官方授权页面 ↗</a>}</div><div className="privacy-note"><Icon name="check" size={17} /><p>密钥留在本机服务端。认识页只读英文与家长确认的中文释义；跟读录音仅在本机临时保存，不上传。</p></div></section><section className="parent-panel usage-panel"><div className="panel-heading"><h2>本月用量</h2><span>{state.usage.month}</span></div><div className="budget-line"><strong>¥{state.usage.estimatedCny.toFixed(2)}</strong><span>/ ¥{state.usage.budgetCny} 估算预算</span></div><div className="budget-track"><span style={{ width: `${Math.min(100, state.usage.budgetCny ? state.usage.estimatedCny / state.usage.budgetCny * 100 : 0)}%` }} /></div><div className="usage-details"><span>合成 {state.usage.ttsCharacters.toLocaleString()} 字符</span><span>历史识别 {Math.round(state.usage.sttSeconds)} 秒</span><span>生图任务 {state.usage.imageJobs} 次</span></div><p className="panel-footnote">免费额度调用也按单价折算，作为本地预算记录；此处金额不代表实际扣款，实际以服务商用量和账单为准。Codex 订阅额度单独计量，本地页面无法读取你的剩余额度。</p></section></div></div>}
    <footer className="parent-footer">本机保存 · 家长确认后，孩子才能学习</footer>
    {editingWord && <div className="modal-backdrop"><section className="modal edit-word-modal" role="dialog" aria-modal="true" aria-labelledby="edit-word-title"><button className="icon-button modal-close" onClick={() => setEditingWord(null)} aria-label="取消编辑"><Icon name="close" /></button><span className="modal-emoji">✏️</span><h2 id="edit-word-title">把词义，说明白一点</h2><p>修改英文或中文义项后，会重新准备图片，<br />并重置这个词的掌握进度。</p><form onSubmit={event => { event.preventDefault(); void act(async () => { await patch(`/api/words/${editingWord.id}`, { term: editedTerm.trim(), meaning: editedMeaning.trim(), ...(editedPos ? { partOfSpeech: editedPos } : {}) }); setEditingWord(null); }, '词条已更新，请重新准备并确认图片。'); }}><label className="field-label" htmlFor="edit-term">英文</label><input id="edit-term" value={editedTerm} onChange={event => setEditedTerm(event.target.value)} maxLength={60} required autoFocus /><label className="field-label" htmlFor="edit-meaning">这次要学的中文意思</label><input id="edit-meaning" value={editedMeaning} onChange={event => setEditedMeaning(event.target.value)} maxLength={120} required /><label className="field-label" htmlFor="edit-pos">词性</label><select id="edit-pos" value={editedPos ?? ''} onChange={event => setEditedPos(event.target.value as Word['partOfSpeech'])}><option value="">未标注</option>{partsOfSpeech.map(pos => <option key={pos} value={pos}>{partOfSpeechLabels[pos]}</option>)}</select><button className="button primary" disabled={busy || !editedTerm.trim() || !editedMeaning.trim()} type="submit">保存这个词<Icon name="check" /></button></form></section></div>}
    {restoreText && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="restore-title"><span className="modal-emoji">📦</span><h2 id="restore-title">恢复这份学习备份？</h2><p>当前词表和进度会替换为备份内容。<br />恢复前会自动保留当前副本。</p><button className="button primary" disabled={busy} onClick={() => void act(async () => { let data: unknown; try { data = JSON.parse(restoreText); } catch { throw new Error('这个文件不是有效的 JSON 备份。'); } await post('/api/restore', data); setRestoreText(''); }, '备份已恢复。')}>确认恢复<Icon name="check" /></button><button className="text-button" disabled={busy} onClick={() => setRestoreText('')}>先不恢复</button></section></div>}
  </main>;
}

createRoot(document.getElementById('root')!).render(<App />);
