import type { BivariantMethod } from '../types/functions';
import type { SetFull, SetPartial, SetStateOverloads } from '../types/setState';
import type { StoreApi, StoreMutators } from './types';

export const RETURN_STATE_CHANGE: unique symbol = Symbol();
export const STATE_UNCHANGED: unique symbol = Symbol();

export type RootStateCreator<S, StoreMutatorOutput extends StoreMutators = [], U = S> = ((
  setState: SetStateWithChangeResult<S>,
  getState: StoreApi<S>['getState'],
  store: StoreApi<S>
) => U) & {
  $$storeMutators?: StoreMutatorOutput;
};

type SetStateWithChangeResult<S> = SetStateOverloads<S> &
  BivariantMethod<{
    setState(update: SetPartial<S>, replace: false, result: typeof RETURN_STATE_CHANGE): typeof STATE_UNCHANGED | void;
    setState(update: SetFull<S>, replace: true, result: typeof RETURN_STATE_CHANGE): typeof STATE_UNCHANGED | void;
  }>;
