import { companionCharacters } from './companions';
export type { CompanionCharacter } from './companions';

/** Family-selected theme. Changes art direction, never vocabulary meaning or learning evidence. */
export const visualTheme = {
  id: 'transformers-mecha-v2',
  label: 'Q版变形金刚 · 机械面罩',
  homeDesktop: '/assets/brand/autobot-courtyard-desktop-v5.png',
  homePortrait: '/assets/brand/autobot-courtyard-portrait-v5.png',
  characters: companionCharacters,
} as const;

export const vocabularyArtDirection = [
  'Family-selected visual theme: Q-version CHIBI TRANSFORMERS, from the app catalogue of 20 Autobots and Decepticons. Follow the assigned companion identity and colors instead of defaulting to Optimus Prime, Bumblebee or Arcee. Use recognisable vehicle-part armor and compact oversized-head toy mecha proportions.',
  'All faces MUST be clearly ROBOTIC: rigid metal faceplates or segmented mechanical masks, narrow flat cyan optical lens slits or angular visors, hard helmet panels, screws and seams. NO human skin, round cartoon eyeballs, sclera, irises, pupils, eyelashes, makeup, human noses, lips, teeth or smiling human mouths. Friendliness comes from pose and soft lighting, never human facial anatomy.',
  'Premium colorful 3D toy-mecha rendering, crisp engineered armor with softly beveled edges, soft studio illumination, simple light cream or pale blue background. No weapons, combat, military scene, logos, labels, written words, letters, watermark or frightening elements.',
  'Match the vocabulary display frame: deliver a true 1:1 square master image, with a source edge of at least 1024 pixels and crisp detail for display up to 520 CSS pixels. Do not bake in a UI frame, rounded-corner mask or thumbnail crop. Compose a complete square scene with comfortable breathing room: keep the entire target object, relevant action, hands, tools, helmet and antenna tips inside the frame, with at least 10 percent safe margin around the important subject. Pull the camera back rather than cropping an oversized close-up. A seated actor may be shown at a table, but never cut through the head, hands or target prop. Keep the action and object prominent within the safe area and clear when downscaled to a small vocabulary choice; do not add excessive empty space or tiny clutter.',
  'Use at most ONE small Transformer as the supporting companion, regardless of faction. For nouns the target object is large and unmistakable; a small companion can hold or point to it. For verbs a Transformer may be the actor, but the requested action must be immediately obvious. For adjectives or prepositions show the exact property or relationship clearly; do not add unrelated gadgets or busy sci-fi environments.',
  'Vocabulary correctness overrides theme decoration. If a companion would confuse the meaning, omit the companion but keep the same 3D toy material, palette and lighting. Never replace the target animal, person, food or natural object with a robot, vehicle, emblem or gadget. Never add English answers or copy the app interface into a word picture.',
].join('\n');
