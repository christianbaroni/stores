import { createDerivedStore, shallowEqual } from 'stores';
import { useMissionControlStore } from './missionControlStore';
import { THEME_TOKENS } from './theme';

const PRESENCE_TTL_MS = 8000; // Must match missionControlStore.ts

export const useSortedCrew = createDerivedStore(
  $ => {
    const state = $(useMissionControlStore);
    const crew = state.crew;
    const removals = state.crewRemovals;
    const now = Date.now();

    // Filter out crew members that have been removed
    const activeCrew = Object.entries(crew)
      .filter(([sessionId, member]) => {
        const removalTime = removals[sessionId];
        if (removalTime !== undefined && member.lastSeenAt <= removalTime) {
          return false;
        }
        const age = now - member.lastSeenAt;
        if (age > PRESENCE_TTL_MS) return false;
        return true;
      })
      .map(([, member]) => member);

    return activeCrew.sort((a, b) => a.label.localeCompare(b.label));
  },
  { equalityFn: shallowEqual, lockDependencies: true }
);

export const useTimelinePreview = createDerivedStore(
  $ => {
    const timeline = $(useMissionControlStore).timeline;
    return timeline.slice(-4).reverse();
  },
  { lockDependencies: true }
);

export const useReversedTimeline = createDerivedStore(
  $ => {
    const timeline = $(useMissionControlStore).timeline;
    return [...timeline].reverse();
  },
  { lockDependencies: true }
);

export const useThemeTokens = createDerivedStore(
  $ => {
    const theme = $(useMissionControlStore).theme;
    return THEME_TOKENS[theme];
  },
  { lockDependencies: true }
);
