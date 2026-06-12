import { useSyncExternalStoreWithSelector } from './hooks/useSyncExternalStoreWithSelector';
import { createStore } from './store/createStore';
import type { Mutate, StateCreator, StoreApi, StoreMutatorIdentifier } from './store/types';
import type { EqualityFn, Selector, UseBoundStoreWithEqualityFn } from './types';

// ============ Store Creator ================================================== //

type StoreMutatorTuple = [StoreMutatorIdentifier, unknown];

export function createStoreWithEqualityFn<State, StoreMutatorOutput extends StoreMutatorTuple[] = []>(
  initializer: StateCreator<State, [], StoreMutatorOutput>,
  defaultEqualityFn?: EqualityFn
): UseBoundStoreWithEqualityFn<Mutate<StoreApi<State>, StoreMutatorOutput>, State>;
export function createStoreWithEqualityFn<State>(): <StoreMutatorOutput extends StoreMutatorTuple[] = []>(
  initializer: StateCreator<State, [], StoreMutatorOutput>,
  defaultEqualityFn?: EqualityFn
) => UseBoundStoreWithEqualityFn<Mutate<StoreApi<State>, StoreMutatorOutput>, State>;
export function createStoreWithEqualityFn<State, StoreMutatorOutput extends StoreMutatorTuple[] = []>(
  initializer?: StateCreator<State, [], StoreMutatorOutput>,
  defaultEqualityFn?: EqualityFn
):
  | UseBoundStoreWithEqualityFn<Mutate<StoreApi<State>, StoreMutatorOutput>, State>
  | (<NextStoreMutatorOutput extends StoreMutatorTuple[] = []>(
      initializer: StateCreator<State, [], NextStoreMutatorOutput>,
      equalityFn?: EqualityFn
    ) => UseBoundStoreWithEqualityFn<Mutate<StoreApi<State>, NextStoreMutatorOutput>, State>) {
  if (initializer === undefined) {
    return <NextStoreMutatorOutput extends StoreMutatorTuple[] = []>(
      stateCreator: StateCreator<State, [], NextStoreMutatorOutput>,
      equalityFn?: EqualityFn
    ) => createStoreHook(stateCreator, equalityFn);
  }

  return createStoreHook(initializer, defaultEqualityFn);
}

// ============ Utilities ====================================================== //

function createStoreHook<State, StoreMutatorOutput extends StoreMutatorTuple[] = []>(
  initializer: StateCreator<State, [], StoreMutatorOutput>,
  defaultEqualityFn: EqualityFn | undefined
): UseBoundStoreWithEqualityFn<Mutate<StoreApi<State>, StoreMutatorOutput>, State> {
  const api = createStore(initializer);

  function useStore(): State;
  function useStore<Selected>(selector: Selector<State, Selected>, equalityFn?: EqualityFn<Selected>): Selected;
  function useStore<Selected>(selector?: Selector<State, Selected>, equalityFn?: EqualityFn<Selected>): State | Selected {
    return useSyncExternalStoreWithSelector(api.subscribe, api.getState, api.getInitialState, selector, equalityFn ?? defaultEqualityFn);
  }

  return Object.assign(useStore, api);
}
