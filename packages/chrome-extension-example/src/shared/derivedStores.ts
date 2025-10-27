import { createDerivedStore, shallowEqual } from 'stores';
import { useMissionControlStore } from './missionControlStore';
import { THEME_TOKENS } from './theme';

export const useSortedCrew = createDerivedStore(
  $ => {
    const state = $(useMissionControlStore);
    const crew = state.crew;
    const removals = state.crewRemovals;

    // Filter out crew members that have been removed
    // Only include members whose lastSeenAt is after any removal timestamp
    const activeCrew = Object.entries(crew)
      .filter(([sessionId, member]) => {
        const removalTime = removals[sessionId];
        if (!removalTime) return true; // Not removed
        return member.lastSeenAt > removalTime; // Only include if heartbeat is newer than removal
      })
      .map(([, member]) => member);

    // Sort alphabetically by label for stable ordering (don't sort by lastSeenAt - causes jumping)
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
