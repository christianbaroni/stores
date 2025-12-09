import { FunctionKeys, UnknownFunction } from './functions';

export type NoOverlap<State, Bundled extends ObjectMethods> = Extract<keyof Bundled, FunctionKeys<State>> extends never ? Bundled : never;

export type ObjectMethods = Record<string, UnknownFunction>;
