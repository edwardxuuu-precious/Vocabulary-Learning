import { createContext, useContext, type ReactNode } from 'react';
import { companionFor, type CompanionCharacter } from '../shared/companions';
import { starterCompanions } from '../shared/companion-unlocks';

const CompanionAccess = createContext<readonly CompanionCharacter[]>(starterCompanions);
export function CompanionAccessProvider({ unlockedIds = starterCompanions, children }: { unlockedIds?: readonly CompanionCharacter[]; children: ReactNode }) {
  return <CompanionAccess.Provider value={unlockedIds}>{children}</CompanionAccess.Provider>;
}
export function useAvailableCompanion(character: CompanionCharacter) {
  const unlocked = useContext(CompanionAccess);
  return unlocked.includes(character) ? character : companionFor(character, 0, unlocked);
}
