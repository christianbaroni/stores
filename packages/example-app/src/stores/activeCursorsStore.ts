import { createDerivedStore, time } from '@stores';
import { CursorPosition, useMultiplayerCursorStore } from './multiplayerCursorStore';

// ============ Types ========================================================== //

export type ActiveCursor = CursorPosition & {
  sessionId: string;
};

export type ActiveCursorsState = {
  activeCursors: ActiveCursor[];
  count: number;
};

// ============ Constants ====================================================== //

const CURSOR_ACTIVE_TIME_MS = time.seconds(2);

// ============ Derived Store ================================================== //

export const useActiveCursorsStore = createDerivedStore(
  $ => {
    const cursors = $(useMultiplayerCursorStore, s => s.cursors);
    const localSessionId = $(useMultiplayerCursorStore, s => s.localSessionId);

    const now = Date.now();
    const activeCursors: ActiveCursor[] = [];

    for (const entry of Object.entries(cursors)) {
      const sessionId = entry[0];
      const cursor = entry[1];
      if (sessionId === localSessionId) continue;
      if (now - cursor.timestamp < CURSOR_ACTIVE_TIME_MS) {
        activeCursors.push({ ...cursor, sessionId });
      }
    }

    return activeCursors;
  },
  { lockDependencies: true }
);
