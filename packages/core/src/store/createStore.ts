import type { InternalSubscribeOptions } from '../internal/types/internalSubscribeTypes';
import type { Listener, Selector, SetPartial, UnsubscribeFn } from '../types';
import type { BivariantMethod } from '../types/functions';
import { Primitive, Widen } from '../types/primitives';
import { notifyListener } from '../utils/core';
import { addToSingleOrSet, deleteFromSingleOrSet, forEachSingleOrSet, type SingleOrSet } from '../utils/singleOrSet';
import { activateCascade, flushCascade } from './cascadeScheduler';
import { SUBSCRIBE_CASCADE_STATE, type CascadeStateSubscribable } from './internalSubscriptions';
import { applyStateUpdate } from './stateUpdate';
import type { Mutate, StateCreator, StoreApi, StoreMutators } from './types';

/**
 * Creates a store from its initial state.
 */
export function createStore<State extends Primitive | unknown[] | Record<string, unknown> | undefined>(
  initial: State
): StoreApi<Widen<State>>;

/**
 * Creates a store from a state creator that receives `(set, get, api)`.
 */
export function createStore<State, Mutators extends StoreMutators = []>(
  createState: StateCreator<State, [], Mutators>
): Mutate<StoreApi<State>, Mutators>;

export function createStore<State>(stateOrCreator: State | StateCreator<State>): StoreApi<State> {
  let state: State;

  let listeners: Set<Listener<State>> | undefined;
  let cascadeListeners: SingleOrSet<Listener<State>>;
  let cascadeListenerCount = 0;

  function setState(update: SetPartial<State>, replace?: boolean): void {
    const nextState = applyStateUpdate(state, update, replace);
    if (Object.is(nextState, state)) return;

    const previousState = state;
    state = nextState;

    forEachSingleOrSet(cascadeListeners, cascadeListenerCount, notifyListener, state, previousState);

    if (listeners) {
      flushCascade();
      for (const listener of listeners) listener(state, previousState);
    }
  }

  function getState(): State {
    return state;
  }

  function getInitialState(): State {
    return initialState;
  }

  function subscribe(listener: Listener<State>): UnsubscribeFn;
  function subscribe<Selected>(
    selector: Selector<State, Selected>,
    listener: Listener<Selected>,
    options?: InternalSubscribeOptions<Selected>
  ): UnsubscribeFn;
  function subscribe<Selected>(
    selectorOrListener: BivariantMethod<{ callback(state: State, previousState: State): Selected }>,
    listener?: Listener<Selected>,
    options?: InternalSubscribeOptions<Selected>
  ): UnsubscribeFn {
    if (!listener) return createSubscription(selectorOrListener);
    return createSelectorSubscription(selectorOrListener, listener, options);
  }

  const api: StoreApi<State> & CascadeStateSubscribable<State> = {
    [SUBSCRIBE_CASCADE_STATE]: subscribeCascadeState,
    getInitialState,
    getState,
    setState,
    subscribe,
  };

  const initialState = (state = isStateCreator(stateOrCreator) ? stateOrCreator(setState, getState, api) : stateOrCreator);

  return api;

  function createSubscription(listener: Listener<State>): UnsubscribeFn {
    (listeners ??= new Set()).add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) listeners = undefined;
    };
  }

  function createCascadeSubscription(listener: Listener<State>): UnsubscribeFn {
    const nextListeners = addToSingleOrSet(cascadeListeners, cascadeListenerCount, listener);
    if (nextListeners !== null) {
      cascadeListeners = nextListeners;
      cascadeListenerCount += 1;
    }

    return () => removeCascadeSubscription(listener);
  }

  function subscribeCascadeState(listener: Listener<State>): UnsubscribeFn {
    function cascadeStateListener(nextState: State, previousState: State): void {
      activateCascade();
      listener(nextState, previousState);
    }

    return createCascadeSubscription(cascadeStateListener);
  }

  function removeCascadeSubscription(listener: Listener<State>): void {
    const nextListeners = deleteFromSingleOrSet(cascadeListeners, cascadeListenerCount, listener);
    if (nextListeners === null) return;

    cascadeListeners = nextListeners;
    cascadeListenerCount -= 1;
  }

  function createSelectorSubscription<Selected>(
    selector: BivariantMethod<{ selector(state: State, previousState?: State): Selected }>,
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

function isStateCreator<S>(initial: S | StateCreator<S>): initial is StateCreator<S> {
  return typeof initial === 'function';
}
