// ============ Throttle ======================================================= //

/**
 * ### `throttle`
 *
 * Creates a throttled function that only invokes `func` at most once per
 * every `wait` milliseconds.
 *
 * @param func - The function to throttle.
 * @param wait - The number of milliseconds to throttle invocations to.
 * @returns The throttled function.
 */
export function throttle<Args extends unknown[]>(func: (...args: Args) => void, wait: number): (...args: Args) => void {
  let lastCall = 0;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function throttled(...args: Args): void {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;

    if (timeSinceLastCall >= wait) {
      lastCall = now;
      func(...args);
    } else {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        lastCall = Date.now();
        func(...args);
      }, wait - timeSinceLastCall);
    }
  };
}
