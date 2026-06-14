import type { Listener, Selector, SetStateArgs, SubscribeArgs, SubscribeOptions, UnsubscribeFn } from '../types';
import { applyStateUpdate } from './stateUpdate';
import type { Mutate, StateCreator, StoreApi, StoreMutators } from './types';

/**
 * Creates the internal core store API.
 */
export function createStore<State, Mutators extends StoreMutators = []>(
  createState: StateCreator<State, [], Mutators>
): Mutate<StoreApi<State>, Mutators>;

export function createStore<State>(createState: StateCreator<State>): StoreApi<State> {
  let state: State;
  const listeners = new Set<Listener<State>>();

  function setState(...args: SetStateArgs<State>): void {
    const nextState = applyStateUpdate(state, ...args);
    if (Object.is(nextState, state)) return;

    const previousState = state;
    state = nextState;
    listeners.forEach(listener => listener(state, previousState));
  }

  function getState(): State {
    return state;
  }

  function getInitialState(): State {
    return initialState;
  }

  function subscribe<Selected>(...args: SubscribeArgs<State, Selected>): UnsubscribeFn {
    if (args.length === 1) return createSubscription(args[0]);
    return createSelectorSubscription(args[0], args[1], args[2]);
  }

  const api: StoreApi<State> = { getInitialState, getState, setState, subscribe };
  const initialState = (state = createState(setState, getState, api));

  return api;

  function createSubscription(listener: Listener<State>): UnsubscribeFn {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  function createSelectorSubscription<Selected>(
    selector: Selector<State, Selected>,
    listener: Listener<Selected>,
    options: SubscribeOptions<Selected> | undefined
  ): UnsubscribeFn {
    const equalityFn = options?.equalityFn ?? Object.is;
    let currentSelection = selector(state);

    function selectedListener(nextState: State): void {
      const nextSelection = selector(nextState);
      if (equalityFn(currentSelection, nextSelection)) return;

      const previousSelection = currentSelection;
      currentSelection = nextSelection;
      listener(nextSelection, previousSelection);
    }

    if (options?.fireImmediately) listener(currentSelection, currentSelection);
    return createSubscription(selectedListener);
  }
}
