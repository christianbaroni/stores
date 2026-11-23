import { RETURN_STATE_CHANGE, STATE_UNCHANGED } from '../store/rootStateCreator';
import { applyStateUpdate } from '../store/stateUpdate';
import type { Mutate, StateCreator, StoreApi, StoreMutators } from '../store/types';
import type { EqualityFn, Listener, Selector, SetFull, SetPartial, UnsubscribeFn } from '../types';
import type { Primitive, Widen } from '../types/primitives';
import { isFunction } from '../types/utils';
import { notifyListener } from '../utils/core';
import { addToSingleOrSet, deleteFromSingleOrSet, forEachSingleOrSet, type SingleOrSet } from '../utils/singleOrSet';
import { activateCascade, notifyAfterCascade } from './cascadeScheduler';
import { SUBSCRIBE_CASCADE_STATE, type CascadeStateSubscribable } from './cascadeSubscriptions';
import type { InternalSubscribe } from './internalSubscriptions';
import { connectSelection, notifyInitial } from './selectorSubscription';

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

  function setState(update: SetPartial<State>, replace?: false): void;
  function setState(update: SetFull<State>, replace: true): void;
  function setState(update: SetPartial<State>, replace: false, result: typeof RETURN_STATE_CHANGE): typeof STATE_UNCHANGED | void;
  function setState(update: SetFull<State>, replace: true, result: typeof RETURN_STATE_CHANGE): typeof STATE_UNCHANGED | void;
  function setState(update: SetPartial<State>, replace?: boolean, result?: typeof RETURN_STATE_CHANGE): typeof STATE_UNCHANGED | void {
    const nextState = applyStateUpdate(state, update, replace);
    if (Object.is(nextState, state)) return result === RETURN_STATE_CHANGE ? STATE_UNCHANGED : undefined;

    const previousState = state;
    state = nextState;

    if (cascadeListeners) forEachSingleOrSet(cascadeListeners, cascadeListenerCount, notifyListener, state, previousState);
    if (listeners) notifyAfterCascade(notifyListeners, previousState);
  }

  function notifyListeners(previousState: State): void {
    if (listeners) for (const listener of listeners) listener(state, previousState);
  }

  function getState(): State {
    return state;
  }

  function getInitialState(): State {
    return initialState;
  }

  const subscribe: InternalSubscribe<State> = (selectorOrListener, listener?, options?): UnsubscribeFn => {
    if (!listener) return createSubscription(selectorOrListener);

    const isCascadeParticipant = options?.isCascadeParticipant ?? false;
    const selection = options?.selection;

    if (selection) {
      const selectedListener = connectSelection(selection, selectorOrListener, getState);
      if (options.fireImmediately) notifyInitial(selection);
      return createSubscription(selectedListener, isCascadeParticipant);
    }

    const equalityFn = options?.equalityFn ?? Object.is;
    const initialSelection = selectorOrListener(state);
    if (options?.fireImmediately) listener(initialSelection, initialSelection);

    const selectedListener = createSelectorListener(selectorOrListener, listener, equalityFn, isCascadeParticipant, initialSelection);
    return createSubscription(selectedListener, isCascadeParticipant);
  };

  const api: StoreApi<State> & CascadeStateSubscribable<State> = {
    getInitialState,
    getState,
    setState,
    subscribe,
    [SUBSCRIBE_CASCADE_STATE]: subscribeCascadeState,
  };

  const initialState = (state = isFunction(stateOrCreator) ? stateOrCreator(setState, getState, api) : stateOrCreator);

  return api;

  function createSubscription(listener: Listener<State>, isCascadeParticipant?: boolean): UnsubscribeFn {
    if (!isCascadeParticipant) {
      (listeners ??= new Set()).add(listener);
      return () => {
        listeners?.delete(listener);
        if (listeners?.size === 0) listeners = undefined;
      };
    }

    const nextListeners = addToSingleOrSet(cascadeListeners, cascadeListenerCount, listener);
    if (nextListeners) {
      cascadeListeners = nextListeners;
      cascadeListenerCount += 1;
    }

    return () => {
      const nextListeners = deleteFromSingleOrSet(cascadeListeners, cascadeListenerCount, listener);
      if (nextListeners === null) return;

      cascadeListeners = nextListeners;
      cascadeListenerCount -= 1;
    };
  }

  function subscribeCascadeState(listener: Listener<State>): UnsubscribeFn {
    function cascadeStateListener(nextState: State, previousState: State): void {
      activateCascade();
      listener(nextState, previousState);
    }

    return createSubscription(cascadeStateListener, true);
  }
}

function createSelectorListener<State, Selected>(
  selector: Selector<State, Selected>,
  listener: Listener<Selected>,
  equalityFn: EqualityFn<Selected>,
  isCascadeParticipant: boolean,
  currentSelection: Selected
): Listener<State> {
  return nextState => {
    const nextSelection = selector(nextState);
    if (equalityFn(currentSelection, nextSelection)) return;

    const previousSelection = currentSelection;
    currentSelection = nextSelection;

    if (isCascadeParticipant) activateCascade();
    listener(nextSelection, previousSelection);
  };
}
