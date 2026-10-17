export const learningBackgrounds = [
  { id: 'meadow', title: '晴空草原', image: '/assets/backgrounds/meadow-v1.png' },
  { id: 'lagoon', title: '宁静海湾', image: '/assets/backgrounds/lagoon-v1.png' },
  { id: 'cloud-garden', title: '云端花园', image: '/assets/backgrounds/cloud-garden-v1.png' },
] as const;

/** Session IDs are random. Hash once per session, so steps, pause, navigation and reload keep one scene. */
export function learningBackground(seed: string) {
  let hash = 2166136261;
  for (const letter of seed) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619);
  return learningBackgrounds[(hash >>> 0) % learningBackgrounds.length];
}
