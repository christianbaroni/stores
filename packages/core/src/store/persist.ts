import type { StorageValue } from '../storage/storageTypes';
import type { SetStateArgs } from '../types';
import type { PersistOptions, PersistStorage, StateCreator, StoreMutatorIdentifier, StorePersistApi } from './types';
import { isPromiseLike } from '../utils/promiseUtils';
import { applySetState } from './stateUpdate';

// ============ Types ========================================================== //

type StoreMutatorTuple = [StoreMutatorIdentifier, unknown];
type PersistMutators<PersistedState, PersistReturn, StoreMutators extends StoreMutatorTuple[]> = [
  ['stores/persist', [PersistedState, PersistReturn]],
  ...StoreMutators,
];

type PersistOptionsWithStorage<State, PersistedState extends Partial<State>, PersistReturn> = Omit<
  PersistOptions<State, PersistedState, PersistReturn>,
  'storage'
> & {
  storage: PersistStorage<State, PersistedState>;
};

type ResolvedOptions<State, PersistedState extends Partial<State>, PersistReturn> = Omit<
  PersistOptions<State, PersistedState, PersistReturn>,
  'merge' | 'skipHydration' | 'storage' | 'version'
> & {
  merge: (persistedState: PersistedState | undefined, currentState: State) => State;
  skipHydration: boolean;
  storage: PersistStorage<State, PersistedState>;
  version: number;
};

type HydrationRead<PersistedState> = {
  migrated: boolean;
  state: PersistedState | undefined;
};

type PostRehydrationCallback<State> = ((state?: State, error?: unknown) => void) | void;

// ============ Middleware ===================================================== //

/**
 * Wraps a state creator with persistence.
 */
export function persist<
  State,
  PersistedState extends Partial<State>,
  PersistReturn extends void | Promise<void> = void,
  StoreMutators extends StoreMutatorTuple[] = [],
>(
  createState: StateCreator<State, [], StoreMutators>,
  initialOptions: PersistOptionsWithStorage<State, PersistedState, PersistReturn>
): StateCreator<State, [], PersistMutators<PersistedState, PersistReturn, StoreMutators>> {
  return (set, get, api) => {
    let options = resolveOptions(initialOptions);
    let hasHydrated = false;
    let hydrationVersion = 0;
    let stateFromStorage: State | undefined;
    let hydrationListeners: Set<(state: State) => void> | undefined;
    let finishHydrationListeners: Set<(state: State) => void> | undefined;

    function persistState(): void | Promise<void> {
      return options.storage.setItem(options.name, get(), options.version);
    }

    const savedSetState = api.setState;
    function setStateAndPersist(...args: SetStateArgs<State>): void | Promise<void> {
      applySetState(savedSetState, args);
      return persistState();
    }

    api.setState = setStateAndPersist;

    function setAndPersist(...args: SetStateArgs<State>): void | Promise<void> {
      applySetState(set, args);
      return persistState();
    }

    const configState = createState(setAndPersist, get, api);
    api.getInitialState = () => configState;

    function hydrate(): Promise<void> | void {
      const currentVersion = startHydration();
      const postRehydrationCallback = options.onRehydrateStorage?.(get() ?? configState);

      try {
        const storedValue = options.storage.getItem(options.name);

        if (isPromiseLike(storedValue)) {
          return storedValue
            .then(value => hydrateStoredValue(currentVersion, value, postRehydrationCallback))
            .catch(error => failHydration(currentVersion, postRehydrationCallback, error));
        }

        return hydrateStoredValue(currentVersion, storedValue, postRehydrationCallback);
      } catch (error) {
        failHydration(currentVersion, postRehydrationCallback, error);
      }
    }

    Object.assign(api, { persist: createPersistApi() });

    if (!options.skipHydration) hydrate();
    return stateFromStorage ?? configState;

    function hydrateStoredValue(
      currentVersion: number,
      storedValue: StorageValue<PersistedState> | null,
      postRehydrationCallback: PostRehydrationCallback<State>
    ): Promise<void> | void {
      const hydrationRead = readStoredValue(options, storedValue);

      if (isPromiseLike(hydrationRead)) {
        return hydrationRead
          .then(value => finishHydrationRead(currentVersion, value, postRehydrationCallback))
          .catch(error => failHydration(currentVersion, postRehydrationCallback, error));
      }

      return finishHydrationRead(currentVersion, hydrationRead, postRehydrationCallback);
    }

    function finishHydrationRead(
      currentVersion: number,
      value: HydrationRead<PersistedState>,
      postRehydrationCallback: PostRehydrationCallback<State>
    ): Promise<void> | void {
      const persistResult = applyHydration(currentVersion, value);
      if (isPromiseLike(persistResult)) {
        return persistResult.then(() => finishHydration(currentVersion, postRehydrationCallback));
      }

      finishHydration(currentVersion, postRehydrationCallback);
    }

    function applyHydration(currentVersion: number, value: HydrationRead<PersistedState>): Promise<void> | void {
      if (currentVersion !== hydrationVersion) return;

      const nextState = options.merge(value.state, get() ?? configState);
      stateFromStorage = nextState;
      set(nextState, true);
      if (value.migrated) return persistState();
    }

    function createPersistApi(): StorePersistApi<State, PersistedState, PersistReturn> {
      return {
        clearStorage: () => {
          void options.storage.removeItem(options.name);
        },
        getOptions: () => options,
        hasHydrated: () => hasHydrated,
        onFinishHydration: listener => {
          finishHydrationListeners ??= new Set();
          finishHydrationListeners.add(listener);
          return () => {
            finishHydrationListeners?.delete(listener);
            if (finishHydrationListeners?.size === 0) finishHydrationListeners = undefined;
          };
        },
        onHydrate: listener => {
          hydrationListeners ??= new Set();
          hydrationListeners.add(listener);
          return () => {
            hydrationListeners?.delete(listener);
            if (hydrationListeners?.size === 0) hydrationListeners = undefined;
          };
        },
        rehydrate: hydrate,
        setOptions: nextOptions => {
          options = resolveOptions({ ...options, ...nextOptions, storage: nextOptions.storage ?? options.storage });
        },
      };
    }

    function startHydration(): number {
      const currentVersion = ++hydrationVersion;
      hasHydrated = false;
      hydrationListeners?.forEach(listener => listener(get() ?? configState));
      return currentVersion;
    }

    function finishHydration(currentVersion: number, postRehydrationCallback: PostRehydrationCallback<State>): void {
      if (currentVersion !== hydrationVersion) return;

      postRehydrationCallback?.(stateFromStorage, undefined);
      const hydratedState = get();
      stateFromStorage = hydratedState;
      hasHydrated = true;
      finishHydrationListeners?.forEach(listener => listener(hydratedState));
    }

    function failHydration(currentVersion: number, postRehydrationCallback: PostRehydrationCallback<State>, error: unknown): void {
      if (currentVersion === hydrationVersion) postRehydrationCallback?.(undefined, error);
    }
  };
}

// ============ Hydration ====================================================== //

function readStoredValue<PersistedState>(
  options: { migrate?: (persistedState: PersistedState, version: number) => PersistedState | Promise<PersistedState>; version: number },
  value: StorageValue<PersistedState> | null
): HydrationRead<PersistedState> | Promise<HydrationRead<PersistedState>> {
  if (!value) return { migrated: false, state: undefined };

  if (typeof value.version !== 'number' || value.version === options.version) return { migrated: false, state: value.state };

  if (!options.migrate) {
    console.error("State loaded from storage couldn't be migrated since no migrate function was provided");
    return { migrated: false, state: undefined };
  }

  const migratedState = options.migrate(value.state, value.version);

  if (isPromiseLike(migratedState)) {
    return migratedState.then(state => ({ migrated: true, state }));
  }

  return { migrated: true, state: migratedState };
}

// ============ Options ======================================================== //

function resolveOptions<State, PersistedState extends Partial<State>, PersistReturn>(
  options: PersistOptionsWithStorage<State, PersistedState, PersistReturn>
): ResolvedOptions<State, PersistedState, PersistReturn> {
  return {
    ...options,
    merge: options.merge ?? mergePersistedState,
    skipHydration: options.skipHydration ?? false,
    version: options.version ?? 0,
  };
}

function mergePersistedState<State, PersistedState extends Partial<State>>(
  persistedState: PersistedState | undefined,
  currentState: State
): State {
  if (persistedState === undefined) return currentState;
  return { ...currentState, ...persistedState };
}
