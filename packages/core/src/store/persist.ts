import type { StorageValue } from '../storage/storageTypes';
import { isPromiseLike } from '../utils/promiseUtils';
import { RETURN_STATE_CHANGE, STATE_UNCHANGED, type RootStateCreator } from './rootStateCreator';
import type { PersistMethods, PersistOptions, StateCreator, StoreMutators } from './types';

// ============ Types ========================================================== //

type PersistMutators<PersistedState, PersistReturn, Mutators extends StoreMutators> = [
  ['stores/persist', [PersistedState, PersistReturn]],
  ...Mutators,
];

type HydrationRead<PersistedState> = {
  migrated: boolean;
  state: PersistedState | undefined;
};

type PostRehydrationCallback<State> = ((state?: State, error?: unknown) => void) | void;

// ============ Constants ====================================================== //

const EMPTY_STORAGE_READ = Object.freeze({ migrated: false, state: undefined });

// ============ Persist Middleware ============================================= //

/**
 * Wraps a state creator with persistence.
 */
export function persist<
  State,
  PersistedState extends Partial<State>,
  PersistReturn extends void | Promise<void> = void,
  Mutators extends StoreMutators = [],
>(
  createState: StateCreator<State, [], Mutators>,
  initialOptions: PersistOptions<State, PersistedState>,
  isAsync: boolean
): RootStateCreator<State, PersistMutators<PersistedState, PersistReturn, Mutators>> {
  return (set, get, api) => {
    let options = resolveOptions(initialOptions);
    let noOpPromise: Promise<void> | undefined;
    let hasHydrated = false;
    let hydrationVersion = 0;
    let stateFromStorage: State | undefined;
    let hydrationListeners: Set<(state: State) => void> | undefined;
    let finishHydrationListeners: Set<(state: State) => void> | undefined;

    function persistState(state: State): void | Promise<void> {
      return options.storage.setItem(options.name, state, options.version);
    }

    function setAndPersist(update: Parameters<typeof set>[0], replace?: boolean): void | Promise<void> {
      const stateChange = replace === true ? set(update, replace, RETURN_STATE_CHANGE) : set(update, false, RETURN_STATE_CHANGE);
      if (stateChange === STATE_UNCHANGED) {
        if (!isAsync) return;
        return (noOpPromise ??= Promise.resolve());
      }

      return persistState(get());
    }

    api.setState = setAndPersist;

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

    Object.assign(api, { persist: createPersistMethods() });

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
      if (value.migrated) return persistState(get());
    }

    function createPersistMethods(): PersistMethods<State, PersistedState> {
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
  if (!value) return EMPTY_STORAGE_READ;

  if (typeof value.version !== 'number' || value.version === options.version) return { migrated: false, state: value.state };

  if (!options.migrate) {
    console.error("State loaded from storage couldn't be migrated since no migrate function was provided");
    return EMPTY_STORAGE_READ;
  }

  const migratedState = options.migrate(value.state, value.version);

  if (isPromiseLike(migratedState)) {
    return migratedState.then(state => ({ migrated: true, state }));
  }

  return { migrated: true, state: migratedState };
}

// ============ Options ======================================================== //

function resolveOptions<State, PersistedState extends Partial<State>>(options: PersistOptions<State, PersistedState>) {
  return {
    ...options,
    merge: options.merge ?? mergePersistedState,
    skipHydration: options.skipHydration ?? false,
  };
}

function mergePersistedState<State, PersistedState extends Partial<State>>(
  persistedState: PersistedState | undefined,
  currentState: State
): State {
  if (persistedState === undefined) return currentState;
  return { ...currentState, ...persistedState };
}
