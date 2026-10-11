import { IS_DEV } from '#env';
import { RefObject, useLayoutEffect } from 'react';
import { BaseStore, EqualityFn, InferStoreState, Selector } from '../types';
import { noop } from '../utils/core';
import { useLazyRef as useRef } from './useLazyRef';

// ============ Types ========================================================== //

/**
 * Handle returned by `useListen`.
 *
 * The hook cleans itself up, so you normally ignore this handle.
 * Keep it when you need to refresh the selection or pause and resume the listener manually.
 */
export type ListenHandle = {
  /** `true` while the listener is attached. */
  isActive: boolean;
  /** Re-evaluate the selector and notify if its value changed. Does nothing while detached. */
  refresh: () => void;
  /** Re-attach the listener. */
  resubscribe: (options?: ResubscribeOptions) => void;
  /** Detach the listener. Safe to call more than once. */
  unsubscribe: () => void;
};

/**
 * Options for resubscribing a listener.
 */
export type ResubscribeOptions = {
  /**
   * Whether to fire the callback immediately when resubscribing.
   * @default false
   */
  fireImmediately?: boolean;
  /**
   * Whether to force a resubscription even if the listener is already active.
   * @default false
   */
  forceResubscribe?: boolean;
};

/**
 * Options for the `useListen` hook.
 */
export type UseListenOptions<Selected> = {
  /**
   * Whether to log debug messages to the console.
   * @default false
   */
  debugMode?: boolean;
  /**
   * Whether to enable the listener.
   * @default true
   */
  enabled?: boolean;
  /**
   * Dictates whether `react` should be called on state slice changes.
   * Compares the previous and current selected values.
   * @default Object.is
   */
  equalityFn?: EqualityFn<Selected>;
  /**
   * Whether to fire the callback immediately on mount. Note that if `true`,
   * the `react` callback will be called on mount regardless of whether the
   * selected value has changed.
   * @default false
   */
  fireImmediately?: boolean;
};

type Reaction<S, Selected> = (current: Selected, previous: Selected, get: () => S, unsubscribe: () => void) => void;

type ListenerRef<S, Selected> = {
  selector: Selector<S, Selected>;
  react: Reaction<S, Selected>;
  options: UseListenOptions<Selected> | EqualityFn<Selected>;
} & ListenHandle;

// ============ useListen ====================================================== //

const DEFAULT_OPTIONS = Object.freeze({
  debugMode: false,
  enabled: true,
  equalityFn: Object.is,
  fireImmediately: false,
}) satisfies Required<UseListenOptions<unknown>>;

/**
 * ### `useListen`
 *
 * Subscribes to a slice of a store and runs a callback whenever that slice changes,
 * **without triggering re-renders**.
 *
 * Useful for forwarding updates to non-React state (e.g. Reanimated shared values), scoped side
 * effects, or deciding yourself if or when a render should happen.
 *
 * The hook attaches the listener and cleans it up automatically. Use the returned `ListenHandle`
 * to refresh the selection or pause and resume the listener manually.
 *
 * ---
 * 💡 **Note:** With the exception of `enabled`, changes in `options` are **not reactive**.
 * They take effect only if a resubscription occurs.
 *
 * ---
 * @param store - Store to listen to. Should be a stable reference.
 * @param selector - Selects the slice of the store state to listen to.
 * @param react - Triggered when the selected slice changes. Receives `(current, previous, get, unsubscribe)`.
 * @param optionsOrEqualityFn - Equality function or listener options, including `enabled` and `fireImmediately`.
 *
 * ---
 * @example
 * ```ts
 * useListen(
 *   useCandlestickStore,
 *   s => s.getData(),
 *   (candles, previous, get, unsubscribe) => {
 *     if (candles?.unsupported) return unsubscribe();
 *     updateTokenPrice(token, getPriceUpdate(candles, previous));
 *     runOnUI(() => chartManager.value?.setCandles(candles))();
 *   }
 * );
 * ```
 */
export function useListen<Store extends BaseStore<S>, Selected, S = InferStoreState<Store>>(
  store: Store,
  selector: Selector<S, Selected>,
  react: Reaction<S, Selected>,
  optionsOrEqualityFn: UseListenOptions<Selected> | EqualityFn<Selected> = DEFAULT_OPTIONS
): RefObject<Readonly<ListenHandle>> {
  const listenerRef = useRef<ListenerRef<S, Selected>>(() => createListenerRef(selector, react, optionsOrEqualityFn));
  const enabled = getEnabledOption(optionsOrEqualityFn);

  setListenerRef(listenerRef, selector, react, optionsOrEqualityFn);

  useLayoutEffect(() => {
    if (!enabled) return;
    attachListener(store, listenerRef);
    return () => detachListener(listenerRef);
  }, [enabled, store]);

  return listenerRef;
}

// ============ Listener Helpers =============================================== //

const DEFAULT_RESUBSCRIBE_OPTIONS = Object.freeze({
  fireImmediately: false,
  forceResubscribe: false,
}) satisfies Readonly<ResubscribeOptions>;

function attachListener<Store extends BaseStore<S>, Selected, S>(
  store: Store,
  listenerRef: RefObject<ListenerRef<S, Selected>>,
  resubscribeOptions: ResubscribeOptions = DEFAULT_RESUBSCRIBE_OPTIONS
): void {
  const listener = listenerRef.current;

  if (listener.isActive) {
    if (!resubscribeOptions.forceResubscribe) return;
    listener.unsubscribe();
  }

  const options = buildOptionsObject(listener.options);
  const equalityFn = options.equalityFn ?? Object.is;

  let selected = listener.selector(store.getState());
  let unsubscribe = noop;

  function check(state: S): void {
    if (!listener.isActive) return;
    const next = listener.selector(state);
    if (equalityFn(selected, next)) return;
    const previous = selected;
    selected = next;
    listener.react(next, previous, store.getState, listener.unsubscribe);
  }

  listener.isActive = true;
  listener.resubscribe = (options = DEFAULT_RESUBSCRIBE_OPTIONS) => attachListener(store, listenerRef, options);
  listener.refresh = () => check(store.getState());
  listener.unsubscribe = () => {
    if (!listener.isActive) return;
    listener.isActive = false;
    listener.refresh = noop;
    unsubscribe();
  };

  unsubscribe = store.subscribe(check);

  if (!listener.isActive) {
    unsubscribe();
    return;
  }

  if (IS_DEV && options.debugMode) console.log('[📡 useListen 📡] Attached listener');

  if (resubscribeOptions.fireImmediately || options.fireImmediately) {
    listener.react(selected, selected, store.getState, listener.unsubscribe);
  }
}

function detachListener<S, Selected>(listenerRef: RefObject<ListenerRef<S, Selected>>): void {
  const listener = listenerRef.current;
  listener.resubscribe = noop;
  listener.unsubscribe();
  listener.unsubscribe = noop;
  listener.isActive = false;

  if (!IS_DEV || typeof listener.options === 'function') return;
  if (listener.options?.debugMode) console.log('[🗑️ useListen 🗑️] Detached listener');
}

function createListenerRef<S, Selected>(
  selector: Selector<S, Selected>,
  react: Reaction<S, Selected>,
  optionsOrEqualityFn: UseListenOptions<Selected> | EqualityFn<Selected>
): ListenerRef<S, Selected> {
  return {
    selector,
    react,
    isActive: false,
    options: optionsOrEqualityFn,
    refresh: noop,
    resubscribe: noop,
    unsubscribe: noop,
  };
}

// ============ Utilities ====================================================== //

function buildOptionsObject<Selected>(optionsOrEqualityFn: UseListenOptions<Selected> | EqualityFn<Selected>): UseListenOptions<Selected> {
  if (typeof optionsOrEqualityFn === 'function') return { equalityFn: optionsOrEqualityFn };
  return optionsOrEqualityFn ?? DEFAULT_OPTIONS;
}

function getEnabledOption<Selected>(optionsOrEqualityFn: UseListenOptions<Selected> | EqualityFn<Selected>): boolean {
  if (typeof optionsOrEqualityFn === 'function') return DEFAULT_OPTIONS.enabled;
  return optionsOrEqualityFn?.enabled ?? DEFAULT_OPTIONS.enabled;
}

function setListenerRef<S, Selected>(
  listenerRef: RefObject<ListenerRef<S, Selected>>,
  selector: Selector<S, Selected>,
  react: Reaction<S, Selected>,
  optionsOrEqualityFn: UseListenOptions<Selected> | EqualityFn<Selected>
): void {
  const listener = listenerRef.current;
  listener.selector = selector;
  listener.react = react;
  listener.options = optionsOrEqualityFn;
}
