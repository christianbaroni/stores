import { applySetState } from '../../store/stateUpdate';
import { SetStateArgs, StateCreator } from '../../types';
import { noop } from '../../utils/core';
import { HydrationCoordinator, createHydrationCoordinator } from '../../utils/hydrationCoordinator';
import { ensureError } from '../errors';
import { SyncContext } from '../sync/syncEnhancer';

type WrappedOnRehydrateStorage<S> = (
  userCallback: ((state: S) => ((finalState?: S, error?: unknown) => void) | void) | undefined,
  syncContext: SyncContext | undefined
) => (state: S) => (finalState?: S, error?: unknown) => void;

/**
 * Creates hydration-gating middleware that queues state updates until rehydration completes.
 *
 * **Before hydration**: Queues `set()` calls in order and forwards each applied setter's result,
 * including persistence-attempt completion. An application error rejects only that update's promise.
 *
 * **After hydration**: Passes `set()` calls through synchronously without batching.
 *
 * This ensures persistence sees a fully rehydrated base state before applying queued updates,
 * while keeping in-memory state changes synchronous post-hydration.
 */
export function createHydrationGate<S>(stateCreator: StateCreator<S>): {
  hydrationPromise: () => Promise<void>;
  stateCreator: StateCreator<S>;
  wrapOnRehydrateStorage: WrappedOnRehydrateStorage<S>;
} {
  let coordinator: HydrationCoordinator | undefined = undefined;
  let isHydrated = false;
  let resolvedPromise: Promise<void> | undefined = undefined;
  let flushPendingSetCalls: (() => void) | undefined = undefined;

  const wrappedStateCreator: StateCreator<S> = (set, get, api) => {
    let pendingSetCalls: Array<() => void> | undefined = undefined;

    function deferredSet(...args: SetStateArgs<S>): Promise<void> | void {
      // -- Hydrating: defer set() calls to be flushed after hydration
      if (!isHydrated) {
        return new Promise<void>((resolve, reject) => {
          (pendingSetCalls ??= []).push(() => {
            try {
              resolve(applySetState(api.setState, args));
            } catch (error) {
              reject(error);
            }
          });
        });
      }
      // -- Hydrated: let synchronous calls pass through
      return applySetState(set, args);
    }

    flushPendingSetCalls = () => {
      if (!pendingSetCalls?.length) return;
      const pending = pendingSetCalls;
      pendingSetCalls = undefined;
      for (const apply of pending) apply();
    };

    return stateCreator(deferredSet, get, api);
  };

  const hydrationPromise: () => Promise<void> = () => {
    if (isHydrated) return coordinator?.promise ?? (resolvedPromise ??= Promise.resolve());
    if (!coordinator) coordinator = createHydrationCoordinator();
    return coordinator.promise;
  };

  /**
   * Wraps `onRehydrateStorage` to coordinate the hydration lifecycle.
   */
  const wrapOnRehydrateStorage: WrappedOnRehydrateStorage<S> = (userCallback, syncContext) => {
    return state => {
      const userRehydrateCallback = userCallback?.(state);
      return (finalState, error) => {
        const wasHydrated = isHydrated;
        isHydrated = true;

        // This allows the sync enhancer to flush before processing queued set() calls.
        syncContext?.onHydrationComplete?.();
        if (flushPendingSetCalls) flushPendingSetCalls();
        syncContext?.onHydrationFlushEnd?.();

        if (error) {
          if (!coordinator && !wasHydrated) {
            coordinator = createHydrationCoordinator();
            void coordinator.promise.catch(noop);
          }
          coordinator?.fail(ensureError(error));
        } else coordinator?.complete();

        userRehydrateCallback?.(finalState, error);
      };
    };
  };

  return {
    hydrationPromise,
    stateCreator: wrappedStateCreator,
    wrapOnRehydrateStorage,
  };
}
