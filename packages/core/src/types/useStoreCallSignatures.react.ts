import type { EqualityFn, Selector } from './selection';

export type UseStoreCallSignatures<State> = {
  (): State;
  <Selected>(selector: Selector<State, Selected>, equalityFn?: EqualityFn<Selected>): Selected;
};
