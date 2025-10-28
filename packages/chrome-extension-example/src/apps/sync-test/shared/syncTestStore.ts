import { createBaseStore, createStoreActions, time } from '@stores';
import { createSyncedChromeStorage } from './createSyncedStorage';

// ============ Types ======================================================== //

export type ContextType = 'popup' | 'options' | 'background';

export type ExtensionContext = {
  color: string;
  label: string;
  sessionId: string;
  type: ContextType;
};

export type OperationType = 'increment' | 'decrement' | 'reset' | 'set';

export type Operation = {
  contextColor: string;
  contextLabel: string;
  id: string;
  newValue: number;
  oldValue: number;
  timestamp: number;
  type: OperationType;
};

export type ActiveContext = {
  color: string;
  label: string;
  lastSeenAt: number;
  sessionId: string;
  type: ContextType;
};

export type SyncTestState = {
  activeContexts: Record<string, ActiveContext>;
  autoIncrementOnOpen: boolean;
  burstMode: boolean;
  counter: number;
  operations: Operation[];
  decrement: (context: ExtensionContext) => void;
  heartbeat: (context: ExtensionContext) => void;
  increment: (context: ExtensionContext, isInitialMount?: boolean) => void;
  pruneInactiveContexts: () => void;
  reset: (context: ExtensionContext) => void;
  setAutoIncrementOnOpen: (enabled: boolean) => void;
  setBurstMode: (enabled: boolean) => void;
  setCounter: (value: number, context: ExtensionContext) => void;
};

// ============ Constants ==================================================== //

const MAX_OPERATIONS = 51;
const CONTEXT_TTL_MS = time.seconds(3);

// ============ Store Setup ================================================== //

const { storage, syncEngine } = createSyncedChromeStorage();

const initial: Pick<SyncTestState, 'activeContexts' | 'autoIncrementOnOpen' | 'burstMode' | 'counter' | 'operations'> = {
  activeContexts: {},
  autoIncrementOnOpen: true,
  burstMode: false,
  counter: 0,
  operations: [],
};

export const useSyncTestStore = createBaseStore<SyncTestState>(
  set => ({
    activeContexts: initial.activeContexts,
    autoIncrementOnOpen: initial.autoIncrementOnOpen,
    burstMode: initial.burstMode,
    counter: initial.counter,
    operations: initial.operations,

    decrement: context => {
      const store = useSyncTestStore.getState();
      const times = store.burstMode ? 10 : 1;
      for (let i = 0; i < times; i++) {
        set(state => {
          const newValue = state.counter - 1;
          return {
            counter: newValue,
            operations: addOperation(state.operations, {
              contextColor: context.color,
              contextLabel: context.label,
              newValue,
              oldValue: state.counter,
              type: 'decrement',
            }),
          };
        });
      }
    },

    heartbeat: context =>
      set(state => {
        const timestamp = now();
        const existing = state.activeContexts[context.sessionId];

        // No change if context exists with same data and recent timestamp
        if (
          existing &&
          existing.color === context.color &&
          existing.label === context.label &&
          existing.type === context.type &&
          timestamp - existing.lastSeenAt < 500
        ) {
          return state;
        }

        return {
          activeContexts: {
            ...pruneContexts(state.activeContexts, timestamp),
            [context.sessionId]: {
              color: context.color,
              label: context.label,
              lastSeenAt: timestamp,
              sessionId: context.sessionId,
              type: context.type,
            },
          },
        };
      }),

    increment: (context, isInitialMount = false) => {
      let times = 1;
      for (let i = 0; i < times; i++) {
        set(state => {
          if (isInitialMount && !state.autoIncrementOnOpen) return state;
          if (state.burstMode) times = 10;
          const newValue = state.counter + 1;
          return {
            counter: newValue,
            operations: addOperation(state.operations, {
              contextColor: context.color,
              contextLabel: context.label,
              newValue,
              oldValue: state.counter,
              type: 'increment',
            }),
          };
        });
      }
    },

    pruneInactiveContexts: () =>
      set(state => {
        const timestamp = now();
        const pruned = pruneContexts(state.activeContexts, timestamp);
        if (pruned === state.activeContexts) return state;
        return { activeContexts: pruned };
      }),

    reset: context =>
      set(state => {
        return {
          ...initial,
          activeContexts: state.activeContexts,
          operations: addOperation(initial.operations, {
            contextColor: context.color,
            contextLabel: context.label,
            newValue: 0,
            oldValue: state.counter,
            type: 'reset',
          }),
        };
      }),

    setAutoIncrementOnOpen: enabled =>
      set(state => {
        if (state.autoIncrementOnOpen === enabled) return state;
        return { autoIncrementOnOpen: enabled };
      }),

    setBurstMode: enabled =>
      set(state => {
        if (state.burstMode === enabled) return state;
        return { burstMode: enabled };
      }),

    setCounter: (value, context) =>
      set(state => {
        if (state.counter === value) return state;
        return {
          counter: value,
          operations: addOperation(state.operations, {
            contextColor: context.color,
            contextLabel: context.label,
            newValue: value,
            oldValue: state.counter,
            type: 'set',
          }),
        };
      }),
  }),

  {
    storage,
    storageKey: 'syncTestStore',
    sync: { engine: syncEngine },
  }
);

export const syncTestActions = createStoreActions(useSyncTestStore);

// ============ Helper Functions ============================================= //

function addOperation(
  operations: Operation[],
  params: {
    contextColor: string;
    contextLabel: string;
    newValue: number;
    oldValue: number;
    type: OperationType;
  }
): Operation[] {
  const newOperation: Operation = {
    contextColor: params.contextColor,
    contextLabel: params.contextLabel,
    id: generateId(),
    newValue: params.newValue,
    oldValue: params.oldValue,
    timestamp: now(),
    type: params.type,
  };

  const updated = [...operations, newOperation];

  if (updated.length <= MAX_OPERATIONS) return updated;
  return updated.slice(updated.length - MAX_OPERATIONS);
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

function now(): number {
  return Date.now();
}

function pruneContexts(contexts: Record<string, ActiveContext>, currentTime: number): Record<string, ActiveContext> {
  let didPrune = false;
  const next: Record<string, ActiveContext> = {};

  for (const [sessionId, context] of Object.entries(contexts)) {
    if (currentTime - context.lastSeenAt <= CONTEXT_TTL_MS) {
      next[sessionId] = context;
    } else {
      didPrune = true;
    }
  }

  return didPrune ? next : contexts;
}
