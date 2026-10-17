import { pairedGame } from './game-boards.ts';
import { automaticSpelling, readyMaterial } from './game-materials.ts';
import type { GameKind, LearningStep, Word } from './contracts.ts';

export interface GameDefinition { kind: GameKind; number: number; title: string; step: LearningStep; minWords: number; practiceOnly: boolean; nounOnly?: boolean; verbOnly?: boolean; familyOnly?: boolean; otherSteps?: LearningStep[]; contextOnly?: boolean; batch?:number }
/** This registry contains working renderers and rules only. Planned mechanisms cannot enter the random pool. */
export const gameRegistry: readonly GameDefinition[] = [
  { kind: 'flip', number: 1, title: '声音翻翻乐', step: 'sound', minWords: 2, practiceOnly: true },
  { kind: 'supply', number: 2, title: '基地补给', step: 'listen', otherSteps:['recognize'], minWords: 2, practiceOnly: false, nounOnly: true },
  { kind: 'bingo', number: 3, title: '听词宾果', step: 'listen', minWords: 3, practiceOnly: true },
  { kind: 'repair', number: 5, title: '错配维修', step: 'sound', minWords: 2, practiceOnly: true },
  { kind: 'gate', number: 6, title: '词汇守门员', step: 'listen', otherSteps:['recognize'], minWords: 2, practiceOnly: false },
  { kind: 'treasure', number: 8, title: '声音藏宝格', step: 'listen', minWords: 2, practiceOnly: true },
  { kind: 'listen-first', number: 9, title: '先听后看', step: 'listen', minWords: 2, practiceOnly: true },
  { kind: 'portal', number: 21, title: '神秘传送门', step: 'recall', otherSteps:['read'], minWords: 2, practiceOnly: true },
  { kind: 'missing', number: 22, title: '谁不见了', step: 'recall', minWords: 2, practiceOnly: true },
  { kind: 'think-choice', number: 30, title: '先想再选', step: 'sound', otherSteps:['read'], minWords: 2, practiceOnly: false },
  { kind: 'queue', number: 4, title: '连听排队', step: 'listen', minWords: 2, practiceOnly: true },
  { kind: 'collect', number: 7, title: '双目标收集', step: 'listen', minWords: 3, practiceOnly: true },
  { kind: 'switch', number: 10, title: '双向切换', step: 'sound', minWords: 2, practiceOnly: true },
  { kind: 'peek', number: 12, title: '局部揭秘', step: 'sound', minWords: 2, practiceOnly: true },
  { kind: 'draw', number: 23, title: '画词回忆', step: 'listen', minWords: 2, practiceOnly: true },
  { kind: 'mimic', number: 24, title: '动作模仿秀', step: 'recall', minWords: 2, practiceOnly: true, verbOnly: true },
  { kind: 'associate', number: 26, title: '两词联想', step: 'sound', otherSteps: ['recall'], minWords: 2, practiceOnly: true },
  { kind: 'quiz', number: 29, title: '我来出题', step: 'recall', minWords: 2, practiceOnly: true, familyOnly: true },
  { kind: 'route', number: 38, title: '词义寻路', step: 'listen', minWords: 2, practiceOnly: true },
  { kind: 'letter-path', number: 41, title: '字母路径', step: 'spell', minWords: 2, practiceOnly: true },
  { kind: 'variants', number: 11, title: '同词异图', step: 'sound', minWords: 2, practiceOnly: true, batch: 3 },
  { kind: 'assemble', number: 13, title: '词义拼图', step: 'listen', minWords: 2, practiceOnly: true, batch: 3 },
  { kind: 'detective', number: 14, title: '易混侦探', step: 'sound', minWords: 2, practiceOnly: true, batch: 3 },
  { kind: 'opposites', number: 15, title: '反义跷跷板', step: 'listen', minWords: 2, practiceOnly: true, batch: 3 },
  { kind: 'sort', number: 16, title: '单词分拣站', step: 'listen', minWords: 2, practiceOnly: true, batch: 3 },
  { kind: 'odd', number: 17, title: '找出异类', step: 'listen', minWords: 3, practiceOnly: true, batch: 3 },
  { kind: 'parts', number: 18, title: '部件归位', step: 'listen', minWords: 2, practiceOnly: true, batch: 3 },
  { kind: 'paint', number: 19, title: '颜色工坊', step: 'listen', minWords: 2, practiceOnly: true, batch: 3 },
  { kind: 'position', number: 20, title: '位置摆摆乐', step: 'listen', minWords: 2, practiceOnly: true, batch: 3 },
  { kind: 'pantomime', number: 25, title: '无声哑剧', step: 'recall', minWords: 2, practiceOnly: true, batch: 3 },
  { kind: 'clue', number: 27, title: '听线索猜词', step: 'recall', minWords: 2, practiceOnly: true, batch: 4, contextOnly: true },
  { kind: 'cloze', number: 28, title: '口头补空', step: 'recall', minWords: 2, practiceOnly: true, batch: 4, contextOnly: true },
  { kind: 'story', number: 31, title: '图片故事排序', step: 'listen', minWords: 2, practiceOnly: true, batch: 4, contextOnly: true },
  { kind: 'program', number: 32, title: '动作编程', step: 'listen', minWords: 2, practiceOnly: true, batch: 4, contextOnly: true },
  { kind: 'combine', number: 33, title: '双词组合', step: 'listen', minWords: 2, practiceOnly: true, batch: 4, contextOnly: true },
  { kind: 'sentence-repair', number: 34, title: '找错改句', step: 'sound', minWords: 2, practiceOnly: true, batch: 4, contextOnly: true },
  { kind: 'negative', number: 35, title: '否定指令', step: 'listen', minWords: 2, practiceOnly: true, batch: 4, contextOnly: true },
  { kind: 'intersection', number: 36, title: '线索交集', step: 'listen', minWords: 2, practiceOnly: true, batch: 4, contextOnly: true },
  { kind: 'information', number: 37, title: '双人信息差', step: 'recall', minWords: 2, practiceOnly: true, batch: 4, familyOnly: true, contextOnly: true },
  { kind: 'assign', number: 39, title: '动作任务分工', step: 'listen', minWords: 2, practiceOnly: true, batch: 4, contextOnly: true },
  { kind: 'quantity', number: 40, title: '数量订单', step: 'listen', minWords: 2, practiceOnly: true, batch: 5, contextOnly: true },
  { kind: 'letter-gap', number: 42, title: '缺字维修', step: 'spell', minWords: 2, practiceOnly: true, batch: 5 },
  { kind: 'chunks', number: 43, title: '词块拼装', step: 'spell', minWords: 2, practiceOnly: true, batch: 5 },
  { kind: 'letter-sort', number: 44, title: '双词分料', step: 'spell', minWords: 2, practiceOnly: true, batch: 5 },
  { kind: 'letter-extra', number: 45, title: '多余字母回收', step: 'spell', minWords: 2, practiceOnly: true, batch: 5 },
  { kind: 'letter-swap', number: 46, title: '交换纠错', step: 'spell', minWords: 2, practiceOnly: true, batch: 5 },
  { kind: 'dictation', number: 47, title: '无图听写', step: 'spell', minWords: 2, practiceOnly: true, batch: 5 },
  { kind: 'cover-spell', number: 48, title: '合书再拼', step: 'spell', minWords: 2, practiceOnly: true, batch: 5 },
  { kind: 'letter-push', number: 49, title: '字母推箱', step: 'spell', minWords: 2, practiceOnly: true, batch: 5 },
  { kind: 'word-morph', number: 50, title: '相似词变换', step: 'spell', minWords: 2, practiceOnly: true, batch: 5 },
];
export const gameDefinition = (kind: string) => gameRegistry.find(game => game.kind === kind);
export const recallGame = (kind: string) => kind === 'portal' || kind === 'missing';
export function eligibleGames(step: LearningStep, words: Word[], options: Pick<GamePlanOptions,'familyEnabled'|'contextEnabled'|'allowedKinds'|'readyMaterialKeys'> = {}) {
  if (words.some(word => word.assetStatus !== 'approved' || word.imageUrl === '/assets/placeholder.svg') || new Set(words.map(word => word.term.toLowerCase())).size !== words.length || new Set(words.map(word => word.meaning.trim())).size !== words.length || new Set(words.map(word => word.imageUrl)).size !== words.length) return [];
  return gameRegistry.filter(game => (!options.allowedKinds||options.allowedKinds.includes(game.kind)) && (game.step === step || (step==='recognize'||step==='read')&&game.otherSteps?.includes(step)) && (game.step!=='spell'||words.every(word=>/^[a-z]{2,6}$/i.test(word.term))) && words.length >= game.minWords && (!game.nounOnly || words.every(word => word.partOfSpeech === 'noun')) && (!game.verbOnly || words.every(word => word.partOfSpeech === 'verb')) && (!game.familyOnly || options.familyEnabled) && (!game.contextOnly || options.contextEnabled) && (!game.batch || automaticSpelling.has(game.kind) ? !game.batch || words.every(word=>/^[a-z]{2,6}$/i.test(word.term)) : (pairedGame(game.kind)?words.slice(0,1):words).some(word=>!!readyMaterial(word,game.kind,words)&&(!options.readyMaterialKeys||options.readyMaterialKeys.includes(`${word.id}:${game.kind}`)))) && (game.kind !== 'letter-path' || words.every(word => /^[a-z]{2,6}$/i.test(word.term))));
}
export function seededRandom(seed: string) {
  let state = 2166136261;
  for (const ch of seed) state = Math.imul(state ^ ch.charCodeAt(0), 16777619);
  return () => { state += 0x6d2b79f5; let value = Math.imul(state ^ state >>> 15, 1 | state); value ^= value + Math.imul(value ^ value >>> 7, 61 | value); return ((value ^ value >>> 14) >>> 0) / 4294967296; };
}
export interface GamePlanOptions { randomize?: boolean; recentKinds?: string[]; forcedKind?: GameKind; familyEnabled?: boolean; contextEnabled?: boolean; allowedKinds?: GameKind[]; readyMaterialKeys?:string[] }
