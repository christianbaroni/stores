import type { Listener, Selector, SetStateArgs, UnsubscribeFn } from '../types';
import type { InternalSubscribeArgs, InternalSubscribeOptions } from '../internal/types/internalSubscribeTypes';
import { activateCascade, flushCascade } from './cascadeScheduler';
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
  let cascadeListeners: Set<Listener<State>> | undefined;

  function setState(...args: SetStateArgs<State>): void {
    const nextState = applyStateUpdate(state, ...args);
    if (Object.is(nextState, state)) return;

    const previousState = state;
    state = nextState;

    if (cascadeListeners) for (const listener of cascadeListeners) listener(state, previousState);
    if (listeners.size) flushCascade();

    for (const listener of listeners) listener(state, previousState);
  }

  function getState(): State {
    return state;
  }

  function getInitialState(): State {
    return initialState;
  }

  function subscribe<Selected>(...args: InternalSubscribeArgs<State, Selected>): UnsubscribeFn {
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

  function createCascadeSubscription(listener: Listener<State>): UnsubscribeFn {
    (cascadeListeners ??= new Set()).add(listener);
    return () => {
      cascadeListeners?.delete(listener);
      if (cascadeListeners?.size === 0) cascadeListeners = undefined;
    };
  }

  function createSelectorSubscription<Selected>(
    selector: Selector<State, Selected>,
    listener: Listener<Selected>,
    options: InternalSubscribeOptions<Selected> | undefined
  ): UnsubscribeFn {
    const equalityFn = options?.equalityFn ?? Object.is;
    const isCascadeParticipant = options?.isCascadeParticipant ?? false;
    let currentSelection = selector(state);

    function selectedListener(nextState: State): void {
      const nextSelection = selector(nextState);
      if (equalityFn(currentSelection, nextSelection)) return;

      const previousSelection = currentSelection;
      currentSelection = nextSelection;

      if (isCascadeParticipant) activateCascade();
      listener(nextSelection, previousSelection);
    }

    if (options?.fireImmediately) listener(currentSelection, currentSelection);

    return isCascadeParticipant ? createCascadeSubscription(selectedListener) : createSubscription(selectedListener);
  }
}
