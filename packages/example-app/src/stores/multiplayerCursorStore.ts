import { createBaseStore, createStoreActions, time } from 'stores';

// ============ Types ========================================================== //

export type CursorPosition = {
  color: string;
  displayName: string;
  timestamp: number;
  x: number;
  y: number;
};

export type ClickEffect = {
  color: string;
  id: string;
  sessionId: string;
  timestamp: number;
  x: number;
  y: number;
};

export type SessionInfo = {
  color: string;
  displayName: string;
  sessionId: string;
};

export type MultiplayerCursorState = {
  clickEffects: ClickEffect[];
  cursors: Record<string, CursorPosition>;
  localColor: string;
  localDisplayName: string;
  localSessionId: string;
  addClickEffect: (x: number, y: number) => void;
  cleanupStaleClickEffects: () => void;
  initializeSession: (sessionId: string, displayName: string, color: string) => void;
  removeClickEffect: (effectId: string) => void;
  removeSession: (sessionId: string) => void;
  updateCursor: (x: number, y: number) => void;
};

// ============ Constants ====================================================== //

const CURSOR_STALE_TIME_MS = time.seconds(10);
const CLICK_EFFECT_DURATION_MS = time.seconds(2);

const CURSOR_COLORS = [
  '#FF6B6B', // Red
  '#4ECDC4', // Turquoise
  '#FFD93D', // Gold
  '#A8E6CF', // Mint
  '#FF8C42', // Orange
  '#9B59B6', // Purple
  '#3498DB', // Blue
  '#E74C3C', // Crimson
  '#F39C12', // Amber
  '#1ABC9C', // Emerald
];

// ============ Store ========================================================== //

export const useMultiplayerCursorStore = createBaseStore<MultiplayerCursorState>(
  set => ({
    clickEffects: [],
    cursors: {},
    localColor: '',
    localDisplayName: '',
    localSessionId: '',

    initializeSession: (sessionId, displayName, color) =>
      set({
        localColor: color,
        localDisplayName: displayName,
        localSessionId: sessionId,
      }),

    updateCursor: (x, y) =>
      set(state => {
        if (!state.localSessionId) return state;
        const now = Date.now();
        return {
          cursors: {
            ...state.cursors,
            [state.localSessionId]: {
              color: state.localColor,
              displayName: state.localDisplayName,
              timestamp: now,
              x,
              y,
            },
          },
        };
      }),

    addClickEffect: (x, y) =>
      set(state => {
        if (!state.localSessionId) return state;
        const now = Date.now();
        const newEffect: ClickEffect = {
          color: state.localColor,
          id: createClickEffectId(),
          sessionId: state.localSessionId,
          timestamp: now,
          x,
          y,
        };
        return {
          clickEffects: [...pruneStaleClickEffects(state.clickEffects, now), newEffect],
        };
      }),

    removeClickEffect: effectId =>
      set(state => ({
        clickEffects: state.clickEffects.filter(e => e.id !== effectId),
      })),

    cleanupStaleClickEffects: () =>
      set(state => {
        const now = Date.now();
        const pruned = pruneStaleClickEffects(state.clickEffects, now);
        if (pruned.length === state.clickEffects.length) return state;
        return { clickEffects: pruned };
      }),

    removeSession: sessionId =>
      set(state => {
        if (!state.cursors[sessionId]) return state;
        const { [sessionId]: _removed, ...rest } = state.cursors;
        return { cursors: rest };
      }),
  }),
  {
    sync: {
      key: 'multiplayerStore',
      fields: ['clickEffects', 'cursors'],
      merge: {
        clickEffects: mergeClickEffects,
        cursors: mergeCursors,
      },
    },
  }
);

export const multiplayerCursorActions = createStoreActions(useMultiplayerCursorStore, {
  assignCursorColor,
});

// ============ Helpers ======================================================== //

function assignCursorColor(sessionId: string): string {
  let hash = 0;
  for (let i = 0; i < sessionId.length; i += 1) {
    const char = sessionId.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  const index = Math.abs(hash) % CURSOR_COLORS.length;
  return CURSOR_COLORS[index];
}

function createClickEffectId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function pruneStaleClickEffects(effects: ClickEffect[], now: number): ClickEffect[] {
  return effects.filter(effect => now - effect.timestamp < CLICK_EFFECT_DURATION_MS);
}

function mergeCursors(
  incomingCursors: Record<string, CursorPosition>,
  currentCursors: Record<string, CursorPosition>
): Record<string, CursorPosition> {
  const now = Date.now();
  const merged: Record<string, CursorPosition> = {};

  for (const [sessionId, cursor] of Object.entries(incomingCursors)) {
    if (now - cursor.timestamp < CURSOR_STALE_TIME_MS) {
      merged[sessionId] = cursor;
    }
  }

  for (const [sessionId, cursor] of Object.entries(currentCursors)) {
    if (merged[sessionId]) continue;
    if (now - cursor.timestamp < CURSOR_STALE_TIME_MS) {
      merged[sessionId] = cursor;
    }
  }

  return merged;
}

function mergeClickEffects(incomingEffects: ClickEffect[], currentEffects: ClickEffect[]): ClickEffect[] {
  const now = Date.now();
  const effectsMap = new Map<string, ClickEffect>();

  for (const effect of incomingEffects) {
    if (now - effect.timestamp < CLICK_EFFECT_DURATION_MS) {
      effectsMap.set(effect.id, effect);
    }
  }

  for (const effect of currentEffects) {
    if (effectsMap.has(effect.id)) continue;
    if (now - effect.timestamp < CLICK_EFFECT_DURATION_MS) {
      effectsMap.set(effect.id, effect);
    }
  }

  return Array.from(effectsMap.values()).sort((a, b) => a.timestamp - b.timestamp);
}
