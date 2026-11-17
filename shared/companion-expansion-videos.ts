import { companionExpansion, type ExpandedCompanionId } from './companion-expansion.ts';
import { companionEpisodes, type CompanionVideo } from './companion-video-source.ts';

/** Every added role uses the matching episode in the domestic Mandarin collection. */
export const expandedCompanionVideos = Object.fromEntries(Object.entries(companionExpansion).map(([id, entry]) =>
  [id, id === 'scorponok' ? companionEpisodes.rebirthFinal : companionEpisodes[entry.episode]],
)) as Record<ExpandedCompanionId, CompanionVideo>;
