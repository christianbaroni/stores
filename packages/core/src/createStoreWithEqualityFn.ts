import { createStore, type Mutate, type StateCreator as ZustandStateCreator, type StoreApi } from 'zustand/vanilla';
import { useSyncExternalStoreWithSelector } from './hooks/useSyncExternalStoreWithSelector';
import type { EqualityFn, Selector, StoreMutators, StoreMutatorsWithSelector, UseBoundStoreWithEqualityFn } from './types';

// ============ Store Creator ================================================== //

export function createStoreWithEqualityFn<State, Mutators extends StoreMutators = []>(
  initializer: ZustandStateCreator<State, [], StoreMutatorsWithSelector<Mutators>>,
  defaultEqualityFn?: EqualityFn
): UseBoundStoreWithEqualityFn<Mutate<StoreApi<State>, StoreMutatorsWithSelector<Mutators>>, State>;
export function createStoreWithEqualityFn<State>(): <Mutators extends StoreMutators = []>(
  initializer: ZustandStateCreator<State, [], StoreMutatorsWithSelector<Mutators>>,
  defaultEqualityFn?: EqualityFn
) => UseBoundStoreWithEqualityFn<Mutate<StoreApi<State>, StoreMutatorsWithSelector<Mutators>>, State>;
export function createStoreWithEqualityFn<State, Mutators extends StoreMutators = []>(
  initializer?: ZustandStateCreator<State, [], StoreMutatorsWithSelector<Mutators>>,
  defaultEqualityFn?: EqualityFn
):
  | UseBoundStoreWithEqualityFn<Mutate<StoreApi<State>, StoreMutatorsWithSelector<Mutators>>, State>
  | ((
      initializer: ZustandStateCreator<State, [], StoreMutatorsWithSelector<Mutators>>,
      equalityFn?: EqualityFn
    ) => UseBoundStoreWithEqualityFn<Mutate<StoreApi<State>, StoreMutatorsWithSelector<Mutators>>, State>) {
  if (initializer === undefined) {
    return (stateCreator: ZustandStateCreator<State, [], StoreMutatorsWithSelector<Mutators>>, equalityFn?: EqualityFn) =>
      createStoreHook(stateCreator, equalityFn);
  }

  return createStoreHook(initializer, defaultEqualityFn);
}

// ============ Utilities ====================================================== //

function createStoreHook<State, Mutators extends StoreMutators>(
  initializer: ZustandStateCreator<State, [], StoreMutatorsWithSelector<Mutators>>,
  defaultEqualityFn: EqualityFn | undefined
): UseBoundStoreWithEqualityFn<Mutate<StoreApi<State>, StoreMutatorsWithSelector<Mutators>>, State> {
  const api = createStore(initializer);

  function useStore(): State;
  function useStore<Selected>(selector: Selector<State, Selected>, equalityFn?: EqualityFn<Selected>): Selected;
  function useStore<Selected>(selector?: Selector<State, Selected>, equalityFn?: EqualityFn<Selected>): State | Selected {
    return useSyncExternalStoreWithSelector(api.subscribe, api.getState, api.getInitialState, selector, equalityFn, defaultEqualityFn);
  }

  return Object.assign(useStore, api);
}
