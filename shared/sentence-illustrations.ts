import { assessmentCue, type AssessmentCue } from './assessment-cues.ts';
import type { GameWord } from './contracts.ts';

interface ReviewedScene { sentence: string; translation: string; src: string; alt: string; original?: true }

/** Entries are visually checked against the whole bilingual sentence. */
const reviewedScenes: Record<string, ReviewedScene> = {
  all: { sentence: '___ the children are here.', translation: '所有的小朋友都到了。', src: '/media/images/e3d3fa16-7b05-439d-8f6d-70d505aed18c/illustration.png', alt: '三个小朋友都到了，站在一起招手', original: true },
  am: { sentence: 'I ___ a child.', translation: '我是一个孩子。', src: '/assets/sentence-scenes/child-introduction.png', alt: '一个小朋友把手放在胸前介绍自己' },
  are: { sentence: 'You ___ my friend.', translation: '你是我的朋友。', src: '/assets/sentence-scenes/high-five.png', alt: '面前的小朋友朝我伸手击掌' },
  at: { sentence: 'I am ___ school.', translation: '我在学校。', src: '/assets/sentence-scenes/at-school.png', alt: '背书包的小朋友站在学校教室门口' },
  ate: { sentence: 'Yesterday, I ___ an apple.', translation: '昨天，我吃了一个苹果。', src: '/assets/sentence-scenes/apple-core.png', alt: '小朋友吃完苹果，盘子里剩下苹果核' },
  be: { sentence: 'I want to ___ a cook.', translation: '长大后，我想当厨师。', src: '/assets/sentence-scenes/want-to-cook.png', alt: '小朋友想象自己将来当厨师做菜' },
  black: { sentence: 'The bag is ___.', translation: '这个书包是黑色的。', src: '/assets/sentence-scenes/black-backpack.png', alt: '一个黑色双肩书包' },
  brown: { sentence: 'The bear is ___.', translation: '小熊是棕色的。', src: '/media/images/0dc71b7a-f2db-4300-8578-a69f69d699cf/illustration.png', alt: '一只棕色的小熊', original: true },
  but: { sentence: 'I want to play, ___ it is raining.', translation: '我想出去玩，但是下雨了。', src: '/assets/sentence-scenes/rainy-playground.png', alt: '小朋友抱着球望向正在下雨的室外游乐场' },
  came: { sentence: 'Yesterday, he ___ to my home.', translation: '昨天，他来我家了。', src: '/media/images/485e06b0-1a6b-431f-9306-233059898510/illustration.png', alt: '一名小朋友从门外走进屋里', original: true },
  is: { sentence: 'He ___ my friend.', translation: '他是我的朋友。', src: '/assets/sentence-scenes/introducing-friend.png', alt: '小朋友指向身边挥手的朋友，向别人介绍他' },
};

export function sentenceIllustration(word: Pick<GameWord, 'term' | 'meaning' | 'imageUrl'>, cue: AssessmentCue = assessmentCue(word)) {
  const scene = reviewedScenes[word.term.trim().toLowerCase()];
  if (!scene || scene.sentence !== cue.sentence || scene.translation !== cue.text || scene.original && scene.src !== word.imageUrl) return;
  return { src: scene.src, alt: scene.alt };
}
