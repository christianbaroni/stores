import { noop } from './core';

type DebouncedFunction<Args extends unknown[], Result, This = unknown> = {
  (this: This, ...args: Args): Result | undefined;
  cancel(): void;
  flush(): Result | undefined;
};

type DebounceOptions = {
  leading?: boolean;
  maxWait?: number;
  trailing?: boolean;
};

const EMPTY_OPTIONS = Object.freeze<DebounceOptions>({});
const NOOP_DEBOUNCED: DebouncedFunction<[], undefined> = Object.assign(() => undefined, { cancel: noop, flush: noop });

/**
 * Leaner reimplementation of the `lodash` debounce function.
 */
export function debounce<Args extends unknown[], Result, This = unknown>(
  fn: (this: This, ...args: Args) => Result,
  wait = 0,
  { leading = false, maxWait, trailing = true }: DebounceOptions = EMPTY_OPTIONS
): DebouncedFunction<Args, Result, This> {
  if (!leading && !trailing) return NOOP_DEBOUNCED;

  wait = Math.max(0, wait) || 0;
  const maxing = maxWait !== undefined;
  const limit = Math.max(wait, maxWait || 0);
  const hasPerformanceNow = typeof performance !== 'undefined' && typeof performance.now === 'function';
  const now = hasPerformanceNow ? performance.now.bind(performance) : Date.now;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let args: Args | undefined;
  let receiver: This | undefined;
  let calledAt: number | undefined;
  let invokedAt = 0;
  let result: Result | undefined;

  function invoke(time: number): Result {
    const a = args!;
    const self = receiver!;
    args = receiver = undefined;
    invokedAt = time;
    return (result = fn.apply(self, a));
  }

  function ready(time: number): boolean {
    const elapsed = time - calledAt!;
    return calledAt === undefined || elapsed >= wait || elapsed < 0 || (maxing && time - invokedAt >= limit);
  }

  function finish(time: number): Result | undefined {
    timer = undefined;
    if (trailing && args) return invoke(time);
    args = receiver = undefined;
    return result;
  }

  function expire(): void {
    const time = now();
    if (ready(time)) {
      finish(time);
    } else {
      const remaining = wait - (time - calledAt!);
      timer = setTimeout(expire, maxing ? Math.min(remaining, limit - (time - invokedAt)) : remaining);
    }
  }

  function debounced(this: This, ...latest: Args): Result | undefined {
    const time = now();
    const shouldRun = ready(time);
    args = latest;
    receiver = this;
    calledAt = time;

    if (shouldRun) {
      if (timer === undefined) {
        invokedAt = time;
        timer = setTimeout(expire, wait);
        return leading ? invoke(time) : result;
      }
      if (maxing) {
        clearTimeout(timer);
        timer = setTimeout(expire, wait);
        return invoke(time);
      }
    }

    if (timer === undefined) timer = setTimeout(expire, wait);
    return result;
  }

  debounced.cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = args = receiver = calledAt = undefined;
    invokedAt = 0;
  };

  debounced.flush = () => {
    if (timer === undefined) return result;
    clearTimeout(timer);
    return finish(now());
  };

  return debounced;
}
