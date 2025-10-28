// ============ Hydration Coordinator ========================================== //

export type HydrationCoordinator = {
  readonly complete: () => void;
  readonly fail: (error: Error) => void;
  readonly isHydrated: () => boolean;
  readonly promise: Promise<void>;
};

/**
 * Creates a coordinator for tracking async storage hydration lifecycle.
 * Provides a promise that resolves once hydration completes and methods
 * to signal completion or failure.
 */
export function createHydrationCoordinator(): HydrationCoordinator {
  let isHydrated = false;
  let resolve: (() => void) | undefined;
  let reject: ((error: Error) => void) | undefined;

  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  function complete(): void {
    if (isHydrated || !resolve) return;
    isHydrated = true;
    resolve();
    resolve = undefined;
    reject = undefined;
  }

  function fail(error: Error): void {
    if (isHydrated || !reject) return;
    isHydrated = true;
    reject(error);
    reject = undefined;
    resolve = undefined;
  }

  function getIsHydrated(): boolean {
    return isHydrated;
  }

  return {
    complete,
    isHydrated: getIsHydrated,
    fail,
    promise,
  };
}
