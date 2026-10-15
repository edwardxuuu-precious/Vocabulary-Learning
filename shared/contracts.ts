export type Skill = 'listen' | 'recall' | 'spell';
export type LearningStep = 'learn' | 'listen' | 'sound' | 'recall' | 'spell';
export interface LearningTask { wordId: string; mode: 'new' | 'review'; steps: LearningStep[] }
export type Theme = string;
export type AssetStatus = 'draft' | 'generating' | 'review' | 'approved' | 'error';
export interface ChildProfile { nickname: string; interests: Theme[]; interestVersion: number; onboardingCompleted: boolean }
export interface Settings { dailyNewWords: number; dailyReviewWords: number; sessionMinutes: number; spellingEnabled: boolean; monthlyBudgetCny: number; voiceEnabled: boolean }
export interface Word { id: string; packId: string; term: string; meaning: string; imageUrl: string; assetStatus: AssetStatus; imageSource: 'builtin' | 'codex' | 'upload'; error?: string; learningResetAt?: string; learningVersion?: number }
export interface WordPack { id: string; title: string; createdAt: string; enabled: boolean }
export interface SkillProgress { wordId: string; skill: Skill; stage: number; dueAt: string; successes: number; attempts: number }
export interface LearningAttempt { id: string; wordId: string; skill: Skill; correct: boolean; hinted: boolean; practiceOnly?: boolean; step?: LearningStep; learningVersion?: number; source: 'click' | 'speech' | 'keyboard'; createdAt: string; sessionId: string }
export interface LearningSession { id: string; wordIds: string[]; completedWordIds: string[]; startedAt: string; completedAt?: string; rewardGranted: boolean; tasks?: LearningTask[]; completedSteps?: Record<string, LearningStep[]>; taskLimit?: number; estimatedMinutes?: number }
export interface ServiceStatus { configured: boolean; available: boolean; status: string; detail: string; provider?: 'soniox' | 'elevenlabs' | 'azure' | 'codex' }
export interface IntegrationStatus { speech: ServiceStatus; codex: ServiceStatus; stt?: ServiceStatus; tts?: ServiceStatus; dialogue?: ServiceStatus }
export interface UsageSummary { month: string; estimatedCny: number; budgetCny: number; ttsCharacters: number; sttSeconds: number; imageJobs: number }
export interface AppState { profile: ChildProfile; settings: Settings; packs: WordPack[]; words: Word[]; progress: SkillProgress[]; attempts: LearningAttempt[]; activeSession: LearningSession | null; stickers: string[]; usage: UsageSummary; integrations: IntegrationStatus }
export interface ImportRow { term: string; meaning: string }
export interface IllustrationJob { id: string; wordId: string; status: 'queued' | 'running' | 'review' | 'error' | 'cancelled'; error?: string; imageUrl?: string; createdAt: string }
export interface SpeechResponse { audioUrl?: string; mode: 'api' | 'local'; cached: boolean; message?: string }
export interface RecognitionResponse { transcript: string; status: 'recognized' | 'unclear' | 'unavailable'; message?: string }
export interface ApiError { error: string; code?: string }

export type VoiceTone = 'curious' | 'cheerful' | 'gentle' | 'excited' | 'clear';
export type ChatScreen = 'interest' | 'home' | 'play' | 'reward' | 'parent';
export interface ChatContext { screen: ChatScreen; wordId?: string; step?: 'learn' | 'listen' | 'sound' | 'recall' | 'spell' }
export type ChatAction = { type: 'none' | 'start_learning' | 'repeat_audio' | 'next_step' | 'pause' | 'exit' | 'prepare_images' } | { type: 'propose_interest'; interest: string };
export interface ChatReply { text: string; tone: VoiceTone; action: ChatAction }
export interface ChatTurnRequest { message: string; conversationId?: string; context: ChatContext }
export interface ChatPreparationRequest { preparationId: string; conversationId?: string }
export interface ChatPreparationCancelRequest { preparationId: string }
export type ChatStreamEvent = { type: 'status'; stage: 'thinking' | 'responding' } | { type: 'reply'; conversationId: string; reply: ChatReply } | { type: 'error'; code: string; message: string } | { type: 'done' } | { type: 'timing'; phase: string; elapsedMs: number };
export interface VoiceStartMessage { type: 'start'; locale: 'zh-CN' | 'en-US'; vocabulary?: string[] }
export type VoiceClientMessage = VoiceStartMessage | { type: 'finish' | 'cancel' };
export type VoiceServerMessage = { type: 'ready' } | { type: 'transcript'; text: string; final: boolean } | { type: 'endpoint'; text: string } | { type: 'error'; code: string; message: string } | { type: 'closed' };
