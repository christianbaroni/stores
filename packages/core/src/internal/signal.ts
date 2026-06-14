/* eslint-disable @typescript-eslint/consistent-type-assertions */
import type { AttachValue } from '../queryStore/signalTypes';
import type { StoreApi } from '../store/types';
import type { EqualityFn, Selector, UnsubscribeFn } from '../types/subscribe';
import { nullObject } from '../utils/core';
import { dequal } from '../utils/equality';
import { hasGetSnapshot } from './storeUtils';

const ENABLE_LOGS = false;

/* Store subscribe function so we can handle param changes on any attachVal (root or nested) */
export const attachValueSubscriptionMap = new WeakMap<AttachValue<unknown>, Subscribe>();

/* Global caching for top-level attachValues */
const storeSignalCache = new WeakMap<object, Map<Selector<unknown, unknown>, Map<EqualityFn<unknown>, AttachValue<unknown>>>>();

export type Subscribe = (callback: () => void) => UnsubscribeFn;
export type GetValue = () => unknown;
export type SetValue = (path: unknown[], value: unknown) => void;

export function $<T>(store: StoreApi<T>): AttachValue<T>;
export function $<T, S>(store: StoreApi<T>, selector: Selector<T, S>, equalityFn?: EqualityFn<S>): AttachValue<S>;
export function $(store: StoreApi<unknown>, selector: Selector<unknown, unknown> = identity, equalityFn: EqualityFn<unknown> = dequal) {
  return getOrCreateAttachValue(store, selector, equalityFn);
}

const identity = <T>(x: T): T => x;

const updateValue = <T>(obj: T, path: unknown[], value: unknown): T => {
  if (!path.length) {
    return value as T;
  }
  const [first, ...rest] = path;
  const prevValue = (obj as Record<string, unknown>)[first as string];
  const nextValue = updateValue(prevValue, rest, value);
  if (dequal(prevValue, nextValue)) {
    return obj;
  }
  const copied = Array.isArray(obj) ? obj.slice() : { ...obj };
  (copied as Record<string, unknown>)[first as string] = nextValue;
  return copied as T;
};

export const createSignal = <T, S>(
  store: StoreApi<T>,
  selector: Selector<T, S>,
  equalityFn: EqualityFn<S>
): [Subscribe, GetValue, SetValue] => {
  const listeners = new Set<() => void>();
  const isDerivedStore = hasGetSnapshot(store);

  let selected = selector(isDerivedStore ? store.getSnapshot() : store.getState());
  let unsubscribe: UnsubscribeFn | undefined;

  const sub: Subscribe = callback => {
    if (!listeners.size) {
      unsubscribe = store.subscribe(
        selector,
        next => {
          selected = next;
          listeners.forEach(listener => listener());
        },
        { equalityFn, isDerivedStore }
      );
    }

    listeners.add(callback);

    return () => {
      listeners.delete(callback);
      if (!listeners.size && unsubscribe) {
        unsubscribe();
        unsubscribe = undefined;
      }
    };
  };

  const get: GetValue = () => {
    if (!listeners.size) {
      selected = selector(store.getState());
    }
    return selected;
  };

  const set: SetValue = (path, value) => {
    if (selector !== identity) {
      throw new Error('Cannot set a value with a selector');
    }
    store.setState(prev => updateValue(prev, path, value), true);
  };

  return [sub, get, set];
};

function getOrCreateAttachValue<T, S>(store: StoreApi<T>, selector: Selector<T, S>, equalityFn: EqualityFn<S>): AttachValue<S> {
  let bySelector = storeSignalCache.get(store);
  if (!bySelector) {
    bySelector = new Map();
    storeSignalCache.set(store, bySelector);
  }

  let byEqFn = bySelector.get(selector as Selector<unknown, unknown>);
  if (!byEqFn) {
    byEqFn = new Map();
    bySelector.set(selector as Selector<unknown, unknown>, byEqFn);
  }

  const existing = byEqFn.get(equalityFn as EqualityFn<unknown>);
  if (existing) {
    return existing as AttachValue<S>;
  }

  const [subscribe, getVal, setVal] = createSignal(store, selector, equalityFn);

  const localCache = new Map<string, AttachValue<unknown>>();

  const createAttachValue = (fullPath: string): AttachValue<unknown> => {
    const handler: ProxyHandler<object> = {
      get(_, key) {
        if (key === 'value') {
          let v = getVal();
          const parts = fullPath.split('.');
          for (const p of parts) {
            if (p) v = (v as Record<string, unknown>)[p];
          }
          return v;
        }
        const keyString = typeof key === 'string' ? key : key.toString();
        const pathKey = fullPath ? `${fullPath}.${keyString}` : keyString;
        const cached = localCache.get(pathKey);
        if (cached) {
          if (ENABLE_LOGS) console.log('[🌀 AttachValue 🌀] Cache hit for:', pathKey);
          return cached;
        } else if (ENABLE_LOGS) {
          console.log('[🌀 AttachValue 🌀] Created root attachValue:', pathKey);
        }
        const val = createAttachValue(pathKey);
        attachValueSubscriptionMap.set(val, subscribe);
        localCache.set(pathKey, val);
        return val;
      },
      set(_, __, value) {
        const path = fullPath.split('.');
        if (path[0] === '') path.shift();
        setVal(path, value);
        return true;
      },
    };

    return new Proxy(nullObject(), handler) as AttachValue<unknown>;
  };

  const rootVal = createAttachValue('');
  subscribe(() => {
    return;
  });
  attachValueSubscriptionMap.set(rootVal, subscribe);
  byEqFn.set(equalityFn as EqualityFn<unknown>, rootVal);
  return rootVal as AttachValue<S>;
}

export function getAttachValueSubscribeFn<AttachVal extends AttachValue<unknown>>(attachVal: AttachVal): Subscribe | undefined {
  return attachValueSubscriptionMap.get(attachVal);
}
