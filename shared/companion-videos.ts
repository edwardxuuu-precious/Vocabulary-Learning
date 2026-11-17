import type { CompanionCharacter } from './companions.ts';
import { expandedCompanionVideos } from './companion-expansion-videos.ts';
import { companionEpisodes as episodes, type CompanionVideo } from './companion-video-source.ts';

/** Domestic Mandarin resources, played through the platform's documented iframe. */
export const companionVideos: Record<CompanionCharacter, CompanionVideo> = {
  ...expandedCompanionVideos,
  optimus: episodes.arrival, bumblebee: episodes.arrival, arcee: episodes.cybertron,
  ironhide: episodes.immobilizer, ratchet: episodes.dinobots, jazz: episodes.arrival,
  wheeljack: episodes.dinobots, prowl: episodes.arrival, hound: episodes.microbots, mirage: episodes.traitor,
  sideswipe: episodes.arrival, hotrod: { ...episodes.cybertron, note: '热破成长为补天士之后的故事。' },
  ultramagnus: episodes.cybertron, grimlock: episodes.warDinobots, elitaone: episodes.alpha, jetfire: episodes.sky,
  megatron: episodes.arrival, starscream: episodes.sky, soundwave: episodes.arrival, shockwave: episodes.alpha,
};
