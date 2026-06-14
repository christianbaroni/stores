import type { BivariantMethod } from './functions';

// ============ Set State Types ================================================= //

export type SetPartial<S> = S | Partial<S> | BivariantMethod<{ updater(state: S): S | Partial<S> }>;
export type SetFull<S> = S | BivariantMethod<{ updater(state: S): S }>;

export type SetStateReplaceArgs<S, ExtraArgs extends unknown[] = []> = [update: SetFull<S>, replace: true, ...extraArgs: ExtraArgs];
export type SetStatePartialArgs<S, ExtraArgs extends unknown[] = []> = [update: SetPartial<S>, replace?: false, ...extraArgs: ExtraArgs];

export type SetStateArgs<S, ExtraArgs extends unknown[] = []> = SetStatePartialArgs<S, ExtraArgs> | SetStateReplaceArgs<S, ExtraArgs>;

/**
 * Rest-argument form of `setState`, used when forwarding calls.
 */
export type SetState<S, ExtraArgs extends unknown[] = [], PersistReturn extends Promise<void> | void = void> = (
  ...args: SetStateArgs<S, ExtraArgs>
) => PersistReturn;

/**
 * Store `setState` method overloads for partial updates and full replacement.
 */
export type SetStateOverloads<S, PersistReturn extends Promise<void> | void = void> = BivariantMethod<{
  setState(update: SetPartial<S>, replace?: false): PersistReturn;
  setState(update: SetFull<S>, replace: true): PersistReturn;
}>;
