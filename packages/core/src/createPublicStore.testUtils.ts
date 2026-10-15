import { createBaseStore } from './createBaseStore';
import type { BaseStore, SubscribeArgs, UnsubscribeFn } from './types';

/**
 * Creates a test store that hides internal hooks and strips internal subscription options.
 */
export function createPublicStore<State>(initial: State): BaseStore<State> {
  const source = createBaseStore(() => initial);
  return Object.assign(source.bind(undefined), {
    getInitialState: source.getInitialState,
    getState: source.getState,
    setState: source.setState,
    subscribe,
  });

  function subscribe(...args: SubscribeArgs<State>): UnsubscribeFn {
    if (args.length === 1) return source.subscribe(args[0]);
    const [selector, listener, options] = args;
    return source.subscribe(selector, listener, { equalityFn: options?.equalityFn, fireImmediately: options?.fireImmediately });
  }
}
