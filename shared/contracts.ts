export type LearningGoal = 'recognize' | 'listen' | 'read';
export type Skill = LearningGoal | 'recall' | 'spell';
export type AssessmentDimension = 'look' | 'read' | 'en-zh' | 'zh-en';
export type AssessmentPracticeStep = `practice-${AssessmentDimension}`;
export type LearningStep = 'learn' | 'recognize' | 'listen' | 'sound' | 'read' | 'recall' | 'spell' | AssessmentPracticeStep;
export type AssessmentResult = 'correct' | 'incorrect' | 'hinted' | 'unconfirmed' | 'skipped' | 'unavailable';
export interface AssessmentRecording { id: string; bytes: number; seconds: number; sha256: string; status: 'ready' | 'purge-pending' | 'deleted' | 'missing' }
export interface AssessmentResponse { version: number; kind: 'recording' | 'choice' | 'skipped' | 'unavailable'; answeredAt: string; recording?: AssessmentRecording }
export type AssessmentVerdict = 'matched' | 'practice' | 'unclear';
export interface AssessmentProposal { version: number; responseVersion: number; verdict: AssessmentVerdict; reason: string; at: string }
export interface AssessmentReview { version: number; responseVersion: number; proposalVersion: number; result: AssessmentResult; at: string }
export interface AssessmentItem { id: string; dimension: AssessmentDimension; word: GameWord; choices: GameWord[]; result?: AssessmentResult; selectedId?: string; response?: AssessmentResponse; transcript?: { text: string; responseVersion: number; at: string }; proposal?: AssessmentProposal; reviews?: AssessmentReview[] }
export interface AssessmentJob { status: 'queued' | 'transcribing' | 'grading' | 'review' | 'failed' | 'interrupted'; stage: 'transcribe' | 'grade'; runs: number; runId?: string; error?: string }
export interface AssessmentSession { id: string; wordIds: string[]; mode: 'full' | 'due' | 'recommended'; items: AssessmentItem[]; startedAt: string; completedAt?: string; workflow?: 'recorded'; submittedAt?: string; job?: AssessmentJob }
export interface AssessmentAttempt { id: string; sessionId: string; itemId: string; wordId: string; learningVersion: number; dimension: AssessmentDimension; result: AssessmentResult; source: 'server' | 'parent'; createdAt: string; confirmedAt?: string; reviewVersion?: number }
export interface AssessmentProgress { wordId: string; learningVersion: number; dimension: AssessmentDimension; stage: number; dueAt: string; lastSuccessDay?: string }
export interface AssessmentPractice { id: string; sessionId: string; wordId: string; learningVersion: number; dimension: AssessmentDimension; createdAt: string; oralStatus?:'recorded'|'skipped' }
export interface AssessmentData { assessments?: AssessmentSession[]; assessmentAttempts?: AssessmentAttempt[]; assessmentProgress?: AssessmentProgress[]; assessmentPractices?: AssessmentPractice[] }
export interface LearningTask { wordId: string; mode: 'new' | 'review'; steps: LearningStep[] }
export interface GameWord { id: string; term: string; meaning: string; imageUrl: string; learningVersion: number }
export type GameKind = 'flip' | 'supply' | 'portal' | 'bingo' | 'repair' | 'gate' | 'treasure' | 'listen-first' | 'missing' | 'think-choice' | 'queue' | 'collect' | 'switch' | 'peek' | 'draw' | 'mimic' | 'associate' | 'quiz' | 'route' | 'letter-path' | 'variants' | 'assemble' | 'detective' | 'opposites' | 'sort' | 'odd' | 'parts' | 'paint' | 'position' | 'pantomime' | 'clue' | 'cloze' | 'story' | 'program' | 'combine' | 'sentence-repair' | 'negative' | 'intersection' | 'information' | 'assign' | 'quantity' | 'letter-gap' | 'chunks' | 'letter-sort' | 'letter-extra' | 'letter-swap' | 'dictation' | 'cover-spell' | 'letter-push' | 'word-morph';
export interface GameCue { text: string; locale: 'zh-CN' | 'en-US' }
export interface GameTile { id: string; label: string; imageUrl?: string; fragment?: number; text?: string; wordId?: string; color?: string; motion?: 'run' | 'jump' | 'wave' | 'turn' | 'sit' | 'stand' }
export interface GameMaterial { version: 1; wordVersion: number; approvedAt?: string; origin?: 'approved-word' | 'proposal'; instruction: string; prompt?: GameCue; wordIds: string[]; wordVersions:Record<string,number>; tiles: GameTile[]; answer: string[]; slots?: {id:string;label:string;symbol?:string;x?:number;y?:number}[]; acceptedSlots?:string[]; placements?: Record<string,string>; clues?: (GameCue & {matches:string[]})[]; sentence?:string[]; blank?:number; source?:string; chunks?:string[]; count?:number }
export interface LearningActivity { id: string; wordId: string; step: LearningStep; kind: 'standard' | GameKind; word: GameWord; choices: GameWord[]; groupId?: string; cueWord?: GameWord; targets?: GameWord[]; direction?: 'hear-picture' | 'picture-hear'; routeStart?: number; routeCells?: number[]; letterGrid?: string; material?: GameMaterial; spellingBoard?: string[] }
export interface ActivityState { heard?: boolean; revealed?: boolean; hinted?: boolean; audioUnavailable?: boolean; concealed?: boolean; optionsVisible?: boolean; heardOptionIds?: string[]; selectedId?: string; outcome?: 'correct' | 'try' | 'practice'; selectedIds?: string[]; uncoveredTiles?: number[]; drawing?: string; composed?: boolean; handedOver?: boolean; gesture?: boolean; guessId?: string; letterPath?: number[]; gameMoves?: string[]; gamePlaced?: Record<string,string>; gameFocus?: string; gameStage?: number; gameText?: string; gamePositions?: number[] }
export type ActivityAction = 'listen' | 'choose' | 'reveal' | 'skip' | 'next' | 'audio-failed' | 'conceal' | 'show-options' | 'listen-option' | 'pick' | 'undo' | 'submit' | 'uncover' | 'draw' | 'compare' | 'finish' | 'compose' | 'hand-over' | 'guess' | 'letter' | 'tap' | 'place' | 'run' | 'reset' | 'swap' | 'guide' | 'clue';
export interface PracticeRecordingTarget { sessionId: string; activityId: string; planVersion?: 1 | 2 | 3 }
export interface PracticeRecording extends PracticeRecordingTarget { id: string; word: GameWord; kind: LearningActivity['kind']; step: LearningStep; mode: 'read' | 'recall' | 'follow'; round: number; createdAt: string; seconds: number; bytes: number; sha256: string; status: 'ready' | 'missing' }
export type Theme = string;
export type AssetStatus = 'draft' | 'generating' | 'review' | 'approved' | 'error';
export interface ChildProfile { nickname: string; interests: Theme[]; interestVersion: number; onboardingCompleted: boolean }
export type LearningStrategy = 'classic' | 'memory-loop';
export interface Settings { dailyNewWords: number; dailyReviewWords: number; sessionMinutes: number; spellingEnabled: boolean; monthlyBudgetCny: number; voiceEnabled: boolean; feedbackSoundsEnabled?: boolean; familyGamesEnabled?: boolean; contextGamesEnabled?: boolean; learningStrategy?: LearningStrategy }
export type PartOfSpeech = 'noun' | 'verb' | 'adjective' | 'adverb' | 'pronoun' | 'preposition' | 'conjunction' | 'interjection' | 'determiner' | 'numeral' | 'phrase' | 'other';
export interface Word { gameMaterials?: Partial<Record<GameKind,GameMaterial>>; id: string; packId: string; term: string; meaning: string; partOfSpeech?: PartOfSpeech; pictureHint?: string; usageNote?: string; imageTheme?: string; imageUrl: string; assetStatus: AssetStatus; imageSource: 'builtin' | 'codex' | 'upload'; error?: string; learningResetAt?: string; learningVersion?: number; deletedAt?: string }
export interface WordPack { id: string; title: string; createdAt: string; enabled: boolean; isSample?: boolean; confirmedAt?: string; deletedAt?: string }
export interface PackEditRow extends ImportRow { id?: string }
export interface PackEditRequest { title: string; rows: PackEditRow[]; revision: string }
export interface SkillProgress { wordId: string; skill: Skill; stage: number; dueAt: string; successes: number; attempts: number }
export interface LearningAttempt { id: string; wordId: string; skill: Skill; correct: boolean; hinted: boolean; practiceOnly?: boolean; step?: LearningStep; learningVersion?: number; source: 'click' | 'speech' | 'keyboard'; createdAt: string; sessionId: string; activityId?: string; oralStatus?: 'recorded' | 'skipped'; sessionPracticeOnly?: true }
export type LearningMode = 'recommended' | 'relearn' | 'practice';
export interface LessonPlan { id: string; title: string; revision: number; wordIds: string[]; focusWordIds: string[]; wordVersions: Record<string, number>; completedWordIds: string[]; segmentMinutes: number; createdAt: string; updatedAt: string }
export interface LearningStartRequest { mode?: LearningMode | 'resume' | 'lesson'; wordIds?: string[]; packId?: string; game?: GameKind | 'random'; sessionId?: string; requestId?: string; strategy?: LearningStrategy; lessonPlanId?: string; lessonRevision?: number }
export interface MemoryLoopPolicy { version: 1 | 2 | 3; kind: 'memory-loop'; segmentSize: 8; checkpoints: string[] }
export interface LearningExposure { wordId: string; learningVersion: number; introducedAt: string }
export interface LearningExperienceUpgrade { fromVersion: 1 | 2; toVersion?: 2 | 3; at: string; checkpointId: string; previousActivities: LearningActivity[]; previousUpgrade?:LearningExperienceUpgrade }
export interface LearningSession { experienceUpgrade?: LearningExperienceUpgrade; id: string; wordIds: string[]; completedWordIds: string[]; startedAt: string; completedAt?: string; suspendedAt?: string; rewardGranted: boolean; tasks?: LearningTask[]; completedSteps?: Record<string, LearningStep[]>; taskLimit?: number; estimatedMinutes?: number; activities?: LearningActivity[]; activityStates?: Record<string, ActivityState>; gameSeed?: string; mode?: LearningMode; practiceOnly?: boolean; requestId?: string; lastResumedAt?: string; exposures?: LearningExposure[]; goalVersion?: 1; learningPolicy?: MemoryLoopPolicy; acknowledgedCheckpoints?: string[]; endReason?: 'reselect' | 'restart'; replacementSessionId?: string; practicePackId?: string; practicePackTitle?: string; packGame?: { selection: GameKind | 'random'; scopeWordIds: string[] }; lessonPlanId?: string; lessonPlanRevision?: number; lessonTitle?: string; lessonScopeCount?: number; lessonWordVersions?: Record<string, number> }
export interface ServiceStatus { configured: boolean; available: boolean; status: string; detail: string; provider?: 'soniox' | 'elevenlabs' | 'azure' | 'codex' }
export interface IntegrationStatus { speech: ServiceStatus; codex: ServiceStatus; stt?: ServiceStatus; tts?: ServiceStatus; dialogue?: ServiceStatus }
export interface UsageSummary { month: string; estimatedCny: number; budgetCny: number; ttsCharacters: number; sttSeconds: number; imageJobs: number }
export interface GrowthWord { wordId: string; term: string; meaning: string; practiced: boolean; verified: boolean; stable: boolean; dimensions: { dimension: AssessmentDimension; passed: boolean; result?: AssessmentResult; dueAt?: string }[] }
export type BadgeMetric = 'days' | 'practicedWords' | 'verifiedWords' | 'stableWords' | AssessmentDimension;
export interface BadgeAward { badgeId: string; recordedAt: string; value: number; source: 'progress' | 'backfill' }
export interface GrowthBadge { id: string; serial: string; title: string; description: string; kind: 'practice' | 'skill'; series: BadgeMetric; seriesTitle: string; icon: string; color: string; frame: 'round' | 'shield' | 'hexagon' | 'flower'; unit: '天' | '词'; target: number; current: number; progress: number; remaining: number; unlocked: boolean; recordedAt?: string; incentive?: string }
export interface GrowthSummary { asOf: string; days: string[]; totalDays: number; currentStreak: number; longestStreak: number; todayCheckedIn: boolean; todayPracticedWords: number; practicedWords: number; verifiedWords: number; stableWords: number; dueWords: number; skills: Record<AssessmentDimension, number>; words: GrowthWord[]; badges: GrowthBadge[]; rank: { title: string; nextTarget?: number } }
export interface AppState extends AssessmentData { learningMode?: 'child' | 'test'; lessonPlan?: LessonPlan; profile: ChildProfile; settings: Settings; packs: WordPack[]; words: Word[]; progress: SkillProgress[]; attempts: LearningAttempt[]; activeSession: LearningSession | null; resumableSessions?: LearningSession[]; lastCompletedSession?: LearningSession | null; learningHistory?: LearningExposure[]; learningNow?: string; stickers: string[]; growth?: GrowthSummary; usage: UsageSummary; integrations: IntegrationStatus }
export interface ImportRow { term: string; meaning: string; partOfSpeech?: PartOfSpeech; pictureHint?: string; usageNote?: string }
export interface ImportPreparation { id: string; status: 'running' | 'ready' | 'error' | 'stopped'; rows: ImportRow[]; total: number; completed: number; error?: string }
export interface PackAudioStatus { packId: string; status: 'idle' | 'running' | 'ready' | 'stopped' | 'error'; total: number; cached: number; currentTerm?: string; error?: string; words: { wordId: string; term: string; cached: boolean }[] }
export interface PackGameAudioStatus { packId: string; status: 'idle' | 'running' | 'ready' | 'stopped' | 'error'; total: number; ready: number; error?: string }
export interface PackImageStatus { packId: string; status: 'idle' | 'queued' | 'running' | 'review' | 'ready' | 'stopped' | 'error'; total: number; approved: number; reviewing: number; pending: number; failed: number; currentWordId?: string; error?: string }
export interface ImageReviewSelection { wordId: string; imageUrl: string; term: string; meaning: string; learningVersion?: number }
export interface IllustrationJob { id: string; wordId: string; status: 'queued' | 'running' | 'review' | 'error' | 'cancelled'; error?: string; imageUrl?: string; createdAt: string }
export interface SpeechResponse { audioUrl?: string; mode: 'api' | 'local'; cached: boolean; message?: string }
export interface RecognitionResponse { transcript: string; status: 'recognized' | 'unclear' | 'unavailable'; message?: string }
export interface ApiError { error: string; code?: string }
export interface AssessmentGrant { token: string; expiresAt: string }
export interface ParentGateStatus { configured: boolean; retryAfterSeconds: number; assessmentGrant?: AssessmentGrant }
export interface ParentPinRequest { pin: string; currentPin?: string }

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

export interface PackGameCatalogue { wordCount:number; randomWordCount:number; games:{kind:GameKind;title:string;step:LearningStep;wordCount:number}[] }
