import { createContext, useContext } from 'react';

/**
 * The sidebar page the current screen belongs to (`{ tone, soft, ... }` from navigation.js),
 * provided by AppShell. Card icons read `soft` from it, so a section's cards take that
 * section's colour. No provider (a card rendered on its own, a page outside the sidebar):
 * null, and cards keep the brand chip.
 */
export const SectionToneContext = createContext(null);

export function useSectionTone() {
  return useContext(SectionToneContext);
}
