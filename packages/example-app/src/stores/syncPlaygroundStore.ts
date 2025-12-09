import { createBaseStore, createStoreActions } from 'stores';

export type SyncTheme = 'sunrise' | 'deep-ocean' | 'midnight';

export type SessionIdentity = {
  label: string;
  sessionId: string;
};

export type Participant = {
  label: string;
  lastSeenAt: number;
};

export type LastEditMetadata = {
  at: number;
  label: string;
  sessionId: string;
};

export type SyncPlaygroundState = {
  lastEditedBy: LastEditMetadata | null;
  localDisplayName: string;
  localSessionId: string;
  participants: Record<string, Participant>;
  sharedNotes: string;
  sharedTitle: string;
  theme: SyncTheme;
  chooseTheme: (theme: SyncTheme) => void;
  heartbeat: () => void;
  initializeSession: (sessionId: string, displayName: string) => void;
  removeParticipant: (sessionId: string) => void;
  setLocalDisplayName: (name: string) => void;
  updateSharedNotes: (notes: string) => void;
  updateSharedTitle: (title: string) => void;
};

const PRESENCE_TTL_MS = 8000; // 8 seconds - participants disappear 8s after last heartbeat

function buildIdentity(name: string, sessionId: string): SessionIdentity {
  return { label: name, sessionId };
}

function normalizeLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length) return trimmed.slice(0, 32);
  return 'Anonymous Tab';
}

function pruneParticipants(participants: Record<string, Participant>, now: number): Record<string, Participant> {
  const result: Record<string, Participant> = {};
  for (const [sessionId, info] of Object.entries(participants)) {
    if (now - info.lastSeenAt <= PRESENCE_TTL_MS) {
      result[sessionId] = info;
    }
  }
  return result;
}

function applyPresence(participants: Record<string, Participant>, identity: SessionIdentity, now: number): Record<string, Participant> {
  const normalizedLabel = normalizeLabel(identity.label);
  const pruned = pruneParticipants(participants, now);

  return {
    ...pruned,
    [identity.sessionId]: {
      label: normalizedLabel,
      lastSeenAt: now,
    },
  };
}

export const useSyncPlaygroundStore = createBaseStore<SyncPlaygroundState>(
  set => ({
    lastEditedBy: null,
    localDisplayName: '',
    localSessionId: '',
    participants: {},
    sharedNotes:
      'Capture lightweight notes, ideas, or checklists together. Open this page in another tab to see every change appear instantly.',
    sharedTitle: 'Shared workspace',
    theme: 'sunrise',

    initializeSession: (sessionId, displayName) =>
      set(state => {
        const identity = buildIdentity(displayName, sessionId);
        const now = Date.now();
        return {
          localSessionId: sessionId,
          localDisplayName: displayName,
          participants: applyPresence(state.participants, identity, now),
        };
      }),

    setLocalDisplayName: name =>
      set(state => {
        const updated = { localDisplayName: name };
        // Immediately update participants with new name
        const identity = buildIdentity(name, state.localSessionId);
        const now = Date.now();
        return {
          ...updated,
          participants: applyPresence(state.participants, identity, now),
        };
      }),

    chooseTheme: theme =>
      set(state => {
        const identity = buildIdentity(state.localDisplayName, state.localSessionId);
        const now = Date.now();
        return {
          lastEditedBy: {
            at: now,
            label: normalizeLabel(identity.label),
            sessionId: identity.sessionId,
          },
          participants: applyPresence(state.participants, identity, now),
          theme,
        };
      }),

    heartbeat: () =>
      set(state => {
        // Don't heartbeat if session isn't initialized
        if (!state.localSessionId) return state;

        const identity = buildIdentity(state.localDisplayName, state.localSessionId);
        const normalizedLabel = normalizeLabel(identity.label);
        const now = Date.now();
        const existing = state.participants[identity.sessionId];

        // If this exact participant already exists with the same label, just update the timestamp
        if (existing?.label === normalizedLabel) {
          return {
            participants: {
              ...state.participants,
              [identity.sessionId]: {
                label: normalizedLabel,
                lastSeenAt: now,
              },
            },
          };
        }

        // Otherwise apply presence (which also prunes)
        return { participants: applyPresence(state.participants, identity, now) };
      }),

    removeParticipant: sessionId =>
      set(state => {
        if (!state.participants[sessionId]) return state;
        const { [sessionId]: _removed, ...rest } = state.participants;
        return { participants: rest };
      }),

    updateSharedNotes: notes =>
      set(state => {
        const identity = buildIdentity(state.localDisplayName, state.localSessionId);
        const now = Date.now();
        return {
          lastEditedBy: {
            at: now,
            label: normalizeLabel(identity.label),
            sessionId: identity.sessionId,
          },
          participants: applyPresence(state.participants, identity, now),
          sharedNotes: notes,
        };
      }),

    updateSharedTitle: title =>
      set(state => {
        const identity = buildIdentity(state.localDisplayName, state.localSessionId);
        const now = Date.now();
        return {
          lastEditedBy: {
            at: now,
            label: normalizeLabel(identity.label),
            sessionId: identity.sessionId,
          },
          participants: applyPresence(state.participants, identity, now),
          sharedTitle: title,
        };
      }),
  }),
  {
    partialize: state => ({
      sharedNotes: state.sharedNotes,
      sharedTitle: state.sharedTitle,
      theme: state.theme,
    }),
    storageKey: 'example-app:sync-playground',
    sync: {
      fields: ['lastEditedBy', 'participants', 'sharedNotes', 'sharedTitle', 'theme'],
    },
  }
);

export const syncPlaygroundActions = createStoreActions(useSyncPlaygroundStore);
