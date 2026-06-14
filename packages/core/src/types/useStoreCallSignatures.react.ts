import type { EqualityFn, Selector } from './subscribe';

export type UseStoreCallSignatures<State> = {
  (): State;
  <Selected>(selector: Selector<State, Selected>, equalityFn?: EqualityFn<Selected>): Selected;
};
