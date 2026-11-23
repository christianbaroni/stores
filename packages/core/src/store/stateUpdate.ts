import type { SetPartial, SetStateArgs, SetStateOverloads } from '../types';
import { isFunction, isRecordLike } from '../types/utils';

/**
 * Calls a `setState` function with captured `setState` arguments.
 */
export function applySetState<S, SetReturn extends Promise<void> | void>(
  set: SetStateOverloads<S, SetReturn>,
  args: SetStateArgs<S>
): SetReturn {
  if (args[1] === true) return set(args[0], true);
  return set(args[0]);
}

/**
 * Applies a `setState` payload to the current state.
 */
export function applyStateUpdate<S>(state: S, update: SetPartial<S>, replace?: boolean): S;
export function applyStateUpdate<S>(state: S, update: SetPartial<S>, replace?: boolean): unknown {
  if (replace === true) return isFunction(update) ? update(state) : update;

  const partial = isFunction(update) ? update(state) : update;
  if (Object.is(partial, state)) return state;
  if (!isRecordLike(state) || !isRecordLike(partial)) return partial;

  return { ...state, ...partial };
}
