import type { QueryParam, QueryParamKey, ReactiveParam } from '../../queryStore/queryParam';
import { isQueryParamConfig } from '../../queryStore/queryParam';
import { getQueryKey } from '../../queryStore/queryKey';
import type { StoreApi } from '../../store/types';
import type { EqualityFn, Selector } from '../../types';
import type { InternalSubscribeOptions, InternalUnsubscribeFn } from '../types/internalSubscribeTypes';
import type { NonFunction } from '../../types/functions';
import { hasOwn } from '../../types/utils';
import { identity, noop, nullObject } from '../../utils/core';
import { dequal } from '../../utils/equality';
import { getOrCreateProxy, stripProxies } from '../derivedStore/deriveProxy';
import type { PathFinder } from '../derivedStore/pathFinder';
import { createPathFinder } from '../derivedStore/pathFinder';
import { hasGetSnapshot } from '../storeUtils';

// ============ Types ========================================================== //

export type TrackedValue<T> = {
  readonly initialValue: T;
  subscribe(listener: (value: T) => void): InternalUnsubscribeFn;
};

export type QueryParams<TParams extends Record<string, unknown>> = {
  buildKey(params?: TParams): string;
  complete(params: Partial<TParams> | undefined): TParams;
  get(): TParams;
  subscribe(onChange: (key: keyof TParams, oldValue: unknown, newValue: unknown) => void): InternalUnsubscribeFn;
};

type Entry<T> = { key?: QueryParamKey<T>; tracked?: TrackedValue<T> };

type Entries<TParams extends Record<string, unknown>> = {
  [K in keyof TParams]?: Entry<TParams[K]>;
};

type SubscribeDependency = (listener: () => void) => InternalUnsubscribeFn;

// ============ Constants ====================================================== //

const CASCADE_PARTICIPANT_SUBSCRIBE_OPTIONS = Object.freeze({ equalityFn: Object.is, isCascadeParticipant: true });

// ============ Resolution ===================================================== //

export function createQueryParams<TParams extends Record<string, unknown>, State>(
  params: { [K in keyof TParams]: QueryParam<TParams[K], State> } | undefined,
  store: StoreApi<State>,
  requiredKeys: (keyof TParams)[]
): QueryParams<TParams> {
  const current = nullObject<TParams>();
  let entries: Entries<TParams> | null = null;
  let hasCustomKeys = false;

  if (params) {
    for (const key in params) {
      if (!hasOwn(params, key)) continue;
      const entry = resolveQueryParam<TParams, State, typeof key>(current, params[key], key, store);
      if (entry) {
        (entries ??= nullObject<Entries<TParams>>())[key] = entry;
        if (entry.key !== undefined) hasCustomKeys = true;
      }
    }
  }

  return {
    buildKey(params = current) {
      return getQueryKey(hasCustomKeys ? buildKeyParams(entries, params) : params);
    },
    complete(params) {
      if (!params) return copyCurrent(current);
      if (hasAllRequiredParams(params, requiredKeys)) return params;
      return { ...current, ...params };
    },
    get() {
      return copyCurrent(current);
    },
    subscribe(onChange) {
      return subscribeEntries(entries, current, onChange);
    },
  };
}

function resolveQueryParam<TParams extends Record<string, unknown>, State, K extends keyof TParams>(
  current: TParams,
  input: QueryParam<TParams[K], State>,
  key: K,
  store: StoreApi<State>
): Entry<TParams[K]> | null {
  if (isQueryParamConfig(input)) return resolveQueryParamValue(current, input.value, key, store, input.key);
  return resolveQueryParamValue(current, input, key, store);
}

export function trackQueryValue<T, State>(getValue: ReactiveParam<T, State>, ownerStore: StoreApi<State>): TrackedValue<T> {
  const selectorDependencies: SubscribeDependency[] = [];
  let proxyPaths: PathFinder | undefined;
  let rootProxyCache: WeakMap<object, unknown> | undefined;

  function trackingGetter<Source, Selected>(
    store: StoreApi<Source>,
    selector?: Selector<Source, Selected>,
    equalityFn?: EqualityFn<Selected>
  ): Source | Selected {
    if (!selector) {
      proxyPaths ??= createPathFinder();
      rootProxyCache ??= new WeakMap();
      return getOrCreateProxy(store, rootProxyCache, proxyPaths.trackPath);
    }

    selectorDependencies.push(listener => {
      return store.subscribe(selector, listener, getSubscribeOptions(equalityFn));
    });

    return selector(readStore(store));
  }

  function snapshotGetter<Source, Selected>(store: StoreApi<Source>, selector: Selector<Source, Selected> = identity): Source | Selected {
    return selector(readStore(store));
  }

  const trackedValue = getValue(trackingGetter, ownerStore);
  const initialValue = proxyPaths ? stripProxies(trackedValue) : trackedValue;

  if (proxyPaths) {
    proxyPaths.buildProxySubscriptions((store, selector) => {
      selectorDependencies.push(listener => {
        return store.subscribe(selector, listener, CASCADE_PARTICIPANT_SUBSCRIBE_OPTIONS);
      });
    }, false);
    proxyPaths.reset();
  }

  rootProxyCache = undefined;

  return {
    initialValue,
    subscribe(listener) {
      const notify = () => listener(getValue(snapshotGetter, ownerStore));
      const unsubscribes = selectorDependencies.map(subscribe => subscribe(notify));
      return skipAbortFetch => {
        for (const unsubscribe of unsubscribes) unsubscribe(skipAbortFetch);
      };
    },
  };
}

function resolveQueryParamValue<TParams extends Record<string, unknown>, State, K extends keyof TParams>(
  current: TParams,
  value: NonFunction<TParams[K]> | ReactiveParam<TParams[K], State>,
  key: K,
  store: StoreApi<State>,
  keyConfig?: QueryParamKey<TParams[K]>
): Entry<TParams[K]> | null {
  if (isReactiveParam(value)) {
    const tracked = trackQueryValue(value, store);
    current[key] = tracked.initialValue;
    return keyConfig === undefined ? { tracked } : { key: keyConfig, tracked };
  }

  current[key] = value;
  return keyConfig === undefined ? null : { key: keyConfig };
}

// ============ Current Values ================================================= //

function copyCurrent<TParams extends Record<string, unknown>>(current: TParams): TParams {
  const currentParams = nullObject<TParams>();
  for (const key in current) if (hasOwn(current, key)) currentParams[key] = current[key];
  return currentParams;
}

// ============ Subscriptions ================================================== //

function subscribeEntries<TParams extends Record<string, unknown>>(
  entries: Entries<TParams> | null,
  current: TParams,
  onChange: (key: keyof TParams, oldValue: unknown, newValue: unknown) => void
): InternalUnsubscribeFn {
  if (!entries) return noop;

  let unsubscribes: InternalUnsubscribeFn[] | undefined;
  for (const key in entries) {
    const tracked = entries[key]?.tracked;
    if (!tracked) continue;

    (unsubscribes ??= []).push(
      tracked.subscribe(nextValue => {
        const previousValue = current[key];
        if (dequal(previousValue, nextValue)) return;
        current[key] = nextValue;
        onChange(key, previousValue, nextValue);
      })
    );
  }

  if (!unsubscribes) return noop;

  return skipAbortFetch => {
    for (const unsubscribe of unsubscribes) unsubscribe(skipAbortFetch);
  };
}

// ============ Key Utilities ================================================== //

function buildKeyParams<TParams extends Record<string, unknown>>(
  entries: Entries<TParams> | null,
  params: TParams
): Record<string, unknown> {
  const keyParams = nullObject<Record<string, unknown>>();

  for (const key in params) {
    if (!hasOwn(params, key)) continue;
    const entry = entries?.[key];
    if (entry?.key === false) continue;

    const value = params[key];
    keyParams[key] = entry?.key ? entry.key(value) : value;
  }

  return keyParams;
}

function getSubscribeOptions<Selected>(equalityFn: EqualityFn<Selected> | undefined): InternalSubscribeOptions<Selected> {
  return equalityFn ? { equalityFn, isCascadeParticipant: true } : CASCADE_PARTICIPANT_SUBSCRIBE_OPTIONS;
}

function readStore<S>(store: StoreApi<S>): S {
  return hasGetSnapshot(store) ? store.getSnapshot() : store.getState();
}

// ============ Type Guards ==================================================== //

function hasAllRequiredParams<TParams extends Record<string, unknown>>(
  params: Partial<TParams>,
  requiredKeys: (keyof TParams)[]
): params is TParams {
  for (const key of requiredKeys) if (!(key in params)) return false;
  return true;
}

function isReactiveParam<T, S>(value: NonFunction<T> | ReactiveParam<T, S>): value is ReactiveParam<T, S> {
  return typeof value === 'function';
}
