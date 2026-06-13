import { IS_DEV } from '@/env';
import type { StoreApi } from '../store/types';
import type { InferStoreState, StoreActions } from '../types';
import type { FunctionKeys, FunctionRecord, UnknownFunction } from '../types/functions';
import type { NoOverlap } from '../types/objects';
import { nullObject } from '../utils/core';
import { isVirtualStore } from './storeUtils';

/**
 * Given a store instance, produces a new object containing only its actions.
 *
 * Intended for export alongside the associated store.
 *
 * @param store - The store to create actions for.
 * @param bundledMethods - Optional extra methods to bundle into the actions object.
 *
 * @example
 * export const useCounterStore = createRainbowStore(set => ({
 *   count: 0,
 *   increment: () => set(state => ({ count: state.count + 1 })),
 * }));
 *
 * export const exampleActions = createStoreActions(useExampleStore);
 * exampleActions.increment();
 */
export function createStoreActions<Store extends StoreApi<unknown>>(store: Store): StoreActions<Store>;

export function createStoreActions<Store extends StoreApi<unknown>, Bundled extends FunctionRecord>(
  store: Store,
  bundledMethods: NoOverlap<InferStoreState<Store>, Bundled>
): StoreActions<Store> & Bundled;

export function createStoreActions<Store extends StoreApi<unknown>, Bundled extends FunctionRecord>(
  store: Store,
  bundledMethods?: NoOverlap<InferStoreState<Store>, Bundled>
): StoreActions<Store> | (StoreActions<Store> & Bundled) {
  const storeActions = extractFunctionProperties(store);
  if (!bundledMethods) return storeActions;
  return Object.assign(storeActions, bundledMethods);
}

function extractFunctionProperties<Store extends StoreApi<State>, State>(store: Store): StoreActions<Store> {
  const state = store.getState();
  const result: StoreActions<Store> = nullObject();
  const editableResult: Record<string, unknown> = result;

  if (IS_DEV) {
    const isObject = typeof state === 'object' && state !== null;
    if (!isObject) throw new Error('[createStoreActions]: State is not an object');
  }

  if (isVirtualStore(store)) {
    for (const key in state) {
      if (isFunctionKey(state, key)) editableResult[key] = createVirtualStoreAction(store, key);
    }
  } else {
    for (const key in state) {
      if (isFunctionKey(state, key)) editableResult[key] = state[key];
    }
  }

  return result;
}

function createVirtualStoreAction<State, K extends keyof State>(store: StoreApi<State>, key: K): UnknownFunction {
  return function (...args: unknown[]): unknown {
    const method = store.getState()[key];
    if (typeof method === 'function') {
      return method(...args);
    }
    throw new Error(`[createVirtualStoreAction]: Method ${String(key)} is not a function`);
  };
}

function isFunctionKey<State, K extends keyof State>(state: State, key: K): key is K & FunctionKeys<State> {
  return typeof state[key] === 'function';
}
