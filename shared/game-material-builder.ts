import type { GameKind, GameMaterial, GameTile, Word } from './contracts.ts';

export const derivedGameKinds = ['assemble', 'clue'] as const;
const usable = (word: Word) => !word.deletedAt && word.assetStatus === 'approved' && word.imageUrl !== '/assets/placeholder.svg';
const tile = (word: Word): GameTile => ({ id: word.id, wordId: word.id, label: word.meaning, imageUrl: word.imageUrl });
function material(word: Word, members: Word[], instruction: string): GameMaterial {
  return { version: 1, wordVersion: word.learningVersion ?? 0, origin: 'proposal', instruction,
    wordIds: members.map(w => w.id), wordVersions: Object.fromEntries(members.map(w => [w.id, w.learningVersion ?? 0])), tiles: members.map(tile), answer: [word.id] };
}

/** A layout or verbatim approved meaning adds no new image, lexical relation or mastery fact. */
export function derivedWordMaterial(word: Word, kind: string): GameMaterial | undefined {
  if (!usable(word)) return;
  if (kind === 'assemble') {
    const m = material(word, [word], '先听单词，再把四块图片放回对应的位置。点一块，再点一个空位。');
    m.origin = 'approved-word';
    m.tiles = Array.from({ length: 4 }, (_, i) => ({ id: `piece-${i}`, label: ['左上角', '右上角', '左下角', '右下角'][i], imageUrl: word.imageUrl, fragment: i }));
    m.answer = m.tiles.map(t => t.id);
    m.slots = m.tiles.map((t, i) => ({ id: `slot-${i}`, label: t.label }));
    m.placements = Object.fromEntries(m.tiles.map((t, i) => [t.id, `slot-${i}`]));
    return m;
  }
  if (kind === 'clue') {
    const m = material(word, [word], '听中文意思，试着说出英文并录下来，再听答案。');
    m.origin = 'approved-word';
    m.prompt = { text: `意思是，${word.meaning.replace(/[。！？!?]+$/u, '')}。`, locale: 'zh-CN' };
    return m;
  }
}

export interface GameMaterialProposal { wordId: string; kind: GameKind; material: GameMaterial; note: string }
const colors: Record<string, [RegExp, string]> = { red: [/红/, '#e56b66'], yellow: [/黄/, '#efd066'], blue: [/蓝/, '#6f9edf'], green: [/绿/, '#77ad79'], black: [/黑/, '#343b48'], white: [/白/, '#f5f3eb'] };
const motions: Record<string, RegExp> = { run: /跑/, jump: /跳/, wave: /挥/, turn: /转/, sit: /坐/, stand: /站/ };
const opposites: [string, RegExp, string, RegExp][] = [['big', /大/, 'small', /小/], ['hot', /热/, 'cold', /冷/], ['up', /上/, 'down', /下/], ['open', /开/, 'closed', /关/], ['happy', /高兴|开心|快乐/, 'sad', /难过|伤心/]];
const categories: [string, string, RegExp][] = [['apple', '水果', /苹果/], ['banana', '水果', /香蕉/], ['orange', '水果', /橙子|橘子/], ['cat', '动物', /猫/], ['dog', '动物', /狗/], ['fish', '动物', /鱼/], ['bird', '动物', /鸟/], ['car', '交通工具', /汽车/], ['bus', '交通工具', /公交|巴士/]];
const category = (w: Word) => w.partOfSpeech==='noun'?categories.find(([term, , meaning]) => w.term.toLowerCase() === term && meaning.test(w.meaning))?.[1]:undefined;

/** Review proposals use only the supplied approved words and images. They never approve themselves. */
export function buildGameMaterialProposals(words: Word[]): GameMaterialProposal[] {
  const available = words.filter(usable), proposals: GameMaterialProposal[] = [];
  for (const word of available) {
    const term = word.term.toLowerCase();
    const add = (kind: GameKind, m: GameMaterial, note = '请核对题目与答案，确认孩子理解这些表达。') => {
      if (!word.gameMaterials?.[kind]) proposals.push({ wordId: word.id, kind, material: m, note });
    };
    if (colors[term]?.[0].test(word.meaning) && ['adjective', 'noun'].includes(word.partOfSpeech ?? '')) {
      const m = material(word, [word], '听颜色的英文，先选颜料，再点图案上色。');
      m.tiles = Object.entries(colors).slice(0, 4).map(([id, [, color]]) => ({ id, label: { red: '红色', yellow: '黄色', blue: '蓝色', green: '绿色' }[id] ?? id, color }));
      if (!m.tiles.some(t => t.id === term)) m.tiles.push({ id: term, label: word.meaning, color: colors[term][1] });
      m.answer = [term]; add('paint', m, '检查色块是否对应已确认的颜色词义。');
    }
    if (word.partOfSpeech === 'verb' && motions[term]?.test(word.meaning)) {
      const m = material(word, [word], '看无声动作，试着说英文并录下来，再听答案。');
      m.tiles = [{ id: 'action', label: word.meaning, motion: term as GameTile['motion'] }]; m.answer = ['action']; add('pantomime', m, '请查看动作演示是否清楚、符合词义。');
    }
    const pair = opposites.find(([a, am, b, bm]) => term === a && am.test(word.meaning) || term === b && bm.test(word.meaning));
    const opposite = pair && available.find(w => w.term.toLowerCase() === (term === pair[0] ? pair[2] : pair[0]) && (term === pair[0] ? pair[3] : pair[1]).test(w.meaning));
    if (opposite) { const m = material(word, [word, opposite], '听英文，找出意思相反的图片。'); m.answer = [opposite.id]; add('opposites', m); }
    const group = category(word);
    if (group) {
      const other = available.find(w => category(w) && category(w) !== group);
      if (other) {
        const m = material(word, [word, other], '听卡片上的词，把卡片放进对应的分类篮子。'); m.tiles = [tile(word)];
        m.slots = [{ id: 'same', label: group, symbol: group === '水果' ? '🍎' : group === '动物' ? '🐾' : '🚗' }, { id: 'other', label: category(other)!, symbol: category(other) === '水果' ? '🍎' : category(other) === '动物' ? '🐾' : '🚗' }];
        m.placements = { [word.id]: 'same' }; add('sort', m);
      }
    }
    if (/^[a-z]{2,6}$/.test(term)) {
      const m = material(word, [word], '听英文，把字母块按顺序拼好。这是记忆分块，不是自然拼读。');
      const split = Math.ceil(term.length / 2); m.chunks = [term.slice(0, split), term.slice(split)]; add('chunks', m, '分块只用于记忆单词，不表示发音或自然拼读规则。');
      const source = available.find(w => w.id !== word.id && /^[a-z]{2,6}$/i.test(w.term) && w.term.length === term.length && [...term].filter((c, i) => c !== w.term.toLowerCase()[i]).length === 1);
      if (source) { const morph = material(word, [word, source], '听目标单词，改一个字母，把原来的单词变成它。'); morph.source = source.term.toLowerCase(); add('word-morph', morph, '确认孩子已熟悉起始词。'); }
    }
    // A known frame is still a proposal: no sentence is assumed familiar to a beginner.
    const frames: Record<string, [RegExp, string[], number]> = { help: [/帮助/, ['Can', 'you', 'help'], 2], you: [/你/, ['Can', 'you', 'help'], 1], make: [/制作/, ['I', 'can', 'make', 'it'], 2] };
    const frame = frames[term];
    if (frame?.[0].test(word.meaning)) {
      const m = material(word, [word], '听短句，看图片，把空着的英文词说出来并录音，再听完整句子。');
      m.sentence = frame[1]; m.blank = frame[2]; m.prompt = { text: frame[1].map((v, i) => i === frame[2] ? '...' : v).join(' '), locale: 'en-US' }; add('cloze', m, '只有孩子已熟悉整句表达时才确认；此玩法还需开启进阶情境。');
    }
  }
  return proposals;
}
