import { DependencyList, EffectCallback, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { dequal } from '../utils/equality';

type EqualityFn = <T>(a: T, b: T) => boolean;

/**
 * Memoizes a dependency list using a deep equality check by default (or a custom comparator if provided).
 *
 * @param deps - The dependency list to memoize.
 * @param equalityFn - Custom function to compare dependencies. Defaults to `deepEqual`.
 * @returns A memoized dependency list that updates only when dependencies differ according to the compare function.
 */
function useMemoize(deps: DependencyList, equalityFn: EqualityFn = dequal): DependencyList {
  const depsRef = useRef<DependencyList>(deps);
  const signalRef = useRef(0);

  if (!equalityFn(deps, depsRef.current)) {
    depsRef.current = deps;
    signalRef.current += 1;
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => depsRef.current, [signalRef.current]);
}

/**
 * A version of React's `useMemo` that uses deep comparison (or a custom comparator) for its dependencies.
 *
 * @param factory - Function that computes the memoized value.
 * @param deps - Dependency list to compare.
 * @param equalityFn - Custom function to compare dependencies. Defaults to deep equality.
 * @returns The memoized value.
 */
export function useDeepMemo<T>(factory: () => T, deps: DependencyList, equalityFn: EqualityFn = dequal): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(factory, useMemoize(deps, equalityFn));
}

/**
 * A version of React's `useEffect` that uses deep comparison (or a custom comparator) for its dependencies.
 *
 * @param effect - The effect callback.
 * @param deps - Dependency list to compare.
 * @param equalityFn - Custom function to compare dependencies. Defaults to deep equality.
 */
export function useDeepEffect(effect: EffectCallback, deps: DependencyList, equalityFn: EqualityFn = dequal): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, useMemoize(deps, equalityFn));
}

/**
 * A version of React's `useCallback` that uses deep comparison (or a custom comparator) for its dependencies.
 *
 * @param callback - The callback function to memoize.
 * @param deps - Dependency list to compare.
 * @param equalityFn - Custom function to compare dependencies. Defaults to deep equality.
 * @returns A memoized callback.
 */
export function useDeepCallback<T extends (...args: Parameters<T>) => ReturnType<T>>(
  callback: T,
  deps: DependencyList,
  equalityFn: EqualityFn = dequal
): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback(callback, useMemoize(deps, equalityFn));
}

/**
 * A version of React's `useLayoutEffect` that uses deep comparison (or a custom comparator) for its dependencies.
 *
 * @param effect - The effect callback.
 * @param deps - Dependency list to compare.
 * @param equalityFn - Custom function to compare dependencies. Defaults to deep equality.
 */
export function useDeepLayoutEffect(effect: EffectCallback, deps: DependencyList, equalityFn: EqualityFn = dequal): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(effect, useMemoize(deps, equalityFn));
}

/**
 * A JS-side equivalent of Reanimated's `useAnimatedReaction` hook.
 *
 * Runs a "prepare" function to compute a value, and then runs a "react" function
 * whenever the prepared value changes, providing both the current and previous prepared values.
 *
 * @param prepare - Function that computes the value to watch.
 * @param react - Function that reacts to changes in the prepared value, receiving (current, previous).
 * @param dependencies - Dependency array. Required for correct operation in React.
 * @param equalityFn - Custom function to compare dependencies. Defaults to `Object.is`.
 */
export function useCompareEffect<PreparedResult>(
  prepare: () => PreparedResult,
  react: (current: PreparedResult, previous: PreparedResult | null) => void,
  dependencies: DependencyList,
  equalityFn: EqualityFn = Object.is
): void {
  const previousRef = useRef<PreparedResult | null>(null);
  const firstRunRef = useRef(true);

  useDeepEffect(
    () => {
      const current = prepare();
      react(current, firstRunRef.current ? null : previousRef.current);
      previousRef.current = current;
      firstRunRef.current = false;
    },
    dependencies,
    equalityFn
  );
}
