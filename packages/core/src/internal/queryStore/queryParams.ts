import type { QueryParam, QueryParamKey, ReactiveParam } from '../../queryStore/queryParam';
import { isQueryParamConfig } from '../../queryStore/queryParam';
import { getQueryKey } from '../../queryStore/queryKey';
import type { StoreApi } from '../../store/types';
import type { EqualityFn, Selector } from '../../types';
import type { InternalSubscribeOptions, InternalUnsubscribeFn } from '../internalSubscriptions';
import type { NonFunction } from '../../types/functions';
import { hasOwn, isFunction } from '../../types/utils';
import { identity, noop, nullObject } from '../../utils/core';
import { dequal } from '../../utils/equality';
import { getOrCreateProxy, stripProxies } from '../derivedStore/deriveProxy';
import { PathFinder } from '../derivedStore/pathFinder';
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

type Subscriptions<TParams extends Record<string, unknown>> = {
  [K in keyof TParams]?: TrackedValue<TParams[K]>['subscribe'];
};

type KeyConfigs<TParams extends Record<string, unknown>> = {
  [K in keyof TParams]?: QueryParamKey<TParams[K]>;
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
  let subscriptions: Subscriptions<TParams> | null = null;
  let keyConfigs: KeyConfigs<TParams> | null = null;

  function resolve<K extends keyof TParams>(key: K, input: QueryParam<TParams[K], State>): void {
    let value: NonFunction<TParams[K]> | ReactiveParam<TParams[K], State>;

    if (!isQueryParamConfig(input)) value = input;
    else {
      value = input.value;
      (keyConfigs ??= nullObject<KeyConfigs<TParams>>())[key] = input.key;
    }

    if (isFunction(value)) {
      const { initialValue, subscribe } = trackQueryValue(value, store);
      current[key] = initialValue;
      (subscriptions ??= nullObject<Subscriptions<TParams>>())[key] = subscribe;
    } else {
      current[key] = value;
    }
  }

  if (params) for (const key in params) if (hasOwn(params, key)) resolve(key, params[key]);

  return {
    buildKey(params = current) {
      return getQueryKey(keyConfigs ? buildKeyParams(keyConfigs, params) : params);
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
      return subscriptions ? subscribeAll(subscriptions, current, onChange) : noop;
    },
  };
}

/**
 * Evaluates a reactive query value and records the dependencies needed to observe changes.
 */
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
      proxyPaths ??= new PathFinder();
      rootProxyCache ??= new WeakMap();
      return getOrCreateProxy(store, readStore(store), rootProxyCache, proxyPaths);
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
    proxyPaths = undefined;
  }

  rootProxyCache = undefined;

  return {
    initialValue,
    subscribe(listener) {
      let revision = 0;

      function notify(): void {
        const currentRevision = ++revision;
        const value = getValue(snapshotGetter, ownerStore);
        if (currentRevision === revision) listener(value);
      }

      const unsubscribes = selectorDependencies.map(subscribe => subscribe(notify));
      notify();

      return skipAbortFetch => {
        for (const unsubscribe of unsubscribes) unsubscribe(skipAbortFetch);
      };
    },
  };
}

// ============ Current Values ================================================= //

function copyCurrent<TParams extends Record<string, unknown>>(current: TParams): TParams {
  const currentParams = nullObject<TParams>();
  for (const key in current) currentParams[key] = current[key];
  return currentParams;
}

// ============ Subscriptions ================================================== //

function subscribeAll<TParams extends Record<string, unknown>>(
  subscriptions: Subscriptions<TParams>,
  current: TParams,
  onChange: (key: keyof TParams, oldValue: unknown, newValue: unknown) => void
): InternalUnsubscribeFn {
  const unsubscribes: InternalUnsubscribeFn[] = [];

  for (const key in subscriptions) {
    const subscribe = subscriptions[key];
    if (!subscribe) continue;

    unsubscribes.push(
      subscribe(nextValue => {
        const previousValue = current[key];
        if (dequal(previousValue, nextValue)) return;
        current[key] = nextValue;
        onChange(key, previousValue, nextValue);
      })
    );
  }

  return skipAbortFetch => {
    for (const unsubscribe of unsubscribes) unsubscribe(skipAbortFetch);
  };
}

// ============ Key Utilities ================================================== //

function buildKeyParams<TParams extends Record<string, unknown>>(
  keyConfigs: KeyConfigs<TParams>,
  params: TParams
): Record<string, unknown> {
  const keyParams = nullObject<Record<string, unknown>>();

  for (const key in params) {
    if (!hasOwn(params, key)) continue;
    const keyConfig = keyConfigs[key];
    if (keyConfig === false) continue;

    const value = params[key];
    keyParams[key] = keyConfig ? keyConfig(value) : value;
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
