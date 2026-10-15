import type { StoreApi } from '../store/types';
import type { BivariantMethod } from '../types/functions';
import type { Listener, Selector } from '../types/subscribe';
import { noop } from '../utils/core';
import { activateCascade } from './cascadeScheduler';
import { hasNativeSubscriptions } from './cascadeSubscriptions';
import {
  SelectionFlags,
  UNINITIALIZED_SELECTION,
  type Selection,
  type InternalSubscribeOptions,
  type InternalUnsubscribeFn,
} from './internalSubscriptions';

// ============ Types ========================================================== //

type SelectionOptions<Selected> = InternalSubscribeOptions<Selected> & { selection: Selection<Selected> };

// ============ Selection Lifecycle ============================================ //

/**
 * Creates shared selection state for updates and refreshes.
 */
export function createSelection<Selected>(listener: Listener<Selected>, options?: InternalSubscribeOptions<Selected>): Selection<Selected> {
  return {
    currentSlice: UNINITIALIZED_SELECTION,
    equalityFn: options?.equalityFn ?? Object.is,
    listener,
    flags: options?.isCascadeParticipant ? SelectionFlags.Cascade : SelectionFlags.None,
    refresh: noop,
  };
}

/**
 * Delivers the accepted value as both current and previous, if initialized.
 */
export function notifyInitial<Selected>(selection: Selection<Selected>): void {
  const current = selection.currentSlice;
  if (current === UNINITIALIZED_SELECTION) return;
  selection.listener(current, current);
}

// ============ Subscriptions ================================================== //

/**
 * Checks whether subscription options include a selection.
 */
export function hasSelection<Selected>(options?: InternalSubscribeOptions<Selected>): options is SelectionOptions<Selected> {
  return options?.selection !== undefined;
}

/**
 * Subscribes using the supplied selection's listener and equality function.
 * When evaluation is deferred, the caller refreshes the selection after setup.
 */
export function subscribeSelection<State, Selected>(
  store: StoreApi<State>,
  selector: Selector<State, Selected>,
  options: SelectionOptions<Selected>,
  deferEvaluation?: boolean
): InternalUnsubscribeFn {
  const selection = options.selection;
  const flags = selection.flags;

  if (deferEvaluation) selection.flags = flags | SelectionFlags.Attaching;

  try {
    return hasNativeSubscriptions(store) ? store.subscribe(selector, noop, options) : subscribeProviderSelection(store, selector, options);
  } finally {
    if (deferEvaluation) selection.flags = flags;
  }
}

/**
 * Returns a listener that compares selector results and notifies on changes.
 * Installs it as `refresh`, preserving the accepted value across reconnections.
 */
export function connectSelection<State, Selected>(
  selection: Selection<Selected>,
  selector: BivariantMethod<{ select(state: State, previousState?: State): Selected }>,
  getState: () => State
): Listener<State> {
  function check(state?: State): void {
    const flags = selection.flags;
    if (flags & SelectionFlags.Attaching) return;

    if (state === undefined) state = getState();
    const current = selector(state);

    if (selection.currentSlice === UNINITIALIZED_SELECTION) {
      selection.currentSlice = current;
      return;
    }

    if (selection.equalityFn(selection.currentSlice, current)) return;

    const previous = selection.currentSlice;
    selection.currentSlice = current;

    if (flags & SelectionFlags.Cascade) activateCascade();
    selection.listener(current, previous);
  }

  selection.refresh = check;

  if (selection.currentSlice === UNINITIALIZED_SELECTION && !(selection.flags & SelectionFlags.Attaching)) {
    selection.currentSlice = selector(getState());
  }

  return check;
}

/**
 * Adapts public store subscriptions to share selection state with refreshes.
 */
function subscribeProviderSelection<State, Selected>(
  store: StoreApi<State>,
  selector: Selector<State, Selected>,
  options: SelectionOptions<Selected>
): InternalUnsubscribeFn {
  const selection = options.selection;
  selection.refresh = noop;

  const providerOptions: SelectionOptions<Selected> = {
    selection,
    equalityFn(previous, current) {
      if (selection.flags & SelectionFlags.Attaching) return true;
      if (selection.currentSlice === UNINITIALIZED_SELECTION) selection.currentSlice = previous;
      return selection.equalityFn(selection.currentSlice, current);
    },
    isCascadeParticipant: options.isCascadeParticipant,
    fireImmediately: options.fireImmediately,
  };

  const unsubscribe = store.subscribe(
    selector,
    current => {
      if (selection.flags & SelectionFlags.Attaching) return;

      if (selection.currentSlice === UNINITIALIZED_SELECTION) {
        selection.currentSlice = current;
        selection.listener(current, current);
      } else {
        const previous = selection.currentSlice;
        selection.currentSlice = current;

        if (selection.flags & SelectionFlags.Cascade) activateCascade();
        selection.listener(current, previous);
      }
    },
    providerOptions
  );

  if (selection.refresh === noop) {
    try {
      connectSelection(selection, selector, store.getState);
    } catch (error) {
      unsubscribe();
      throw error;
    }
  }

  return unsubscribe;
}
