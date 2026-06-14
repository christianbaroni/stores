import { BaseStore } from '../../types';
import { isPlainObject } from '../../types/utils';
import { hasGetSnapshot } from '../storeUtils';
import { TrackPathFn } from './pathFinder';

// ============ Constants ====================================================== //

const TRACKING_PROXY_UNWRAP = Symbol('stores.deriveProxy.unwrap');

// ============ Proxy Creator ================================================== //

/**
 * Gets or creates a lightweight tracking proxy that records path access and store
 * method invocations via proxy traps. Used to auto-generate selectors that point
 * to either the accessed path or the value returned by an invoked store method.
 */
export function getOrCreateProxy<S>(store: BaseStore<S>, rootProxyCache: WeakMap<object, unknown>, trackPath: TrackPathFn): S {
  const cachedProxy = rootProxyCache.get(store);
  if (isCachedProxy<S>(cachedProxy)) return cachedProxy;

  const snapshot = hasGetSnapshot(store) ? store.getSnapshot() : store.getState();
  const newProxy = createTrackingProxy(snapshot, store, trackPath);
  rootProxyCache.set(store, newProxy);
  return newProxy;
}

function createTrackingProxy<S>(snapshot: S, store: BaseStore<S>, trackPath: TrackPathFn, path: string[] = []): S {
  // -- If the store state is a primitive or nullish, track as a leaf and return directly
  if (!snapshot || typeof snapshot !== 'object') {
    trackPath(store, path, true);
    return snapshot;
  }

  const bailedOutObjects = new WeakSet<object>();
  const subProxyCache = new WeakMap<object, object>();
  return buildProxy(snapshot, path, store, trackPath, bailedOutObjects, subProxyCache);
}

function buildProxy<T extends object, S>(
  value: T,
  path: string[],
  store: BaseStore<S>,
  trackPath: TrackPathFn,
  bailedOutObjects: WeakSet<object>,
  subProxyCache: WeakMap<object, object>
): T {
  return new Proxy<T>(value, {
    get(target, propKey, receiver) {
      if (propKey === TRACKING_PROXY_UNWRAP) {
        trackPath(store, path, true);
        return target;
      }

      // -- If we've already bailed out on this object, no further sub-proxies
      if (bailedOutObjects.has(target)) {
        return Reflect.get(target, propKey, receiver);
      }

      // -- If it's a symbol or __proto__, handle normally (and bail out on iteration)
      if (propKey === '__proto__' || typeof propKey === 'symbol') {
        // If enumerating or iterating, treat that as a leaf usage on the parent
        if (propKey === Symbol.iterator) {
          trackPath(store, path, true);
          bailedOutObjects.add(target);
        }
        return Reflect.get(target, propKey, receiver);
      }

      // -- Get the property value
      const childValue = Reflect.get(target, propKey, target);
      const propKeyString = String(propKey);
      const newPath = path.concat(propKeyString);

      // -- Handle functions
      if (typeof childValue === 'function') {
        const isStoreMethod = Object.prototype.hasOwnProperty.call(target, propKey);

        if (isStoreMethod) {
          // Return a wrapped function that tracks invocation when called. This allows
          // building a selector that points to the value *returned* by the method call.
          return function (...args: unknown[]) {
            trackPath(store, newPath, true, { args: args.length ? args : undefined });
            return Reflect.apply(childValue, target, args);
          };
        }

        // Built-in prototype function (e.g. .toString), track as final usage (a leaf)
        trackPath(store, path, true);
        return childValue.bind(value);
      }

      // -- Handle non-function property tracking
      // Primitives or nullish values: track as a leaf
      // Objects: track as ancestor usage
      const isObject = !!childValue && typeof childValue === 'object';
      trackPath(store, newPath, !isObject);

      // -- For objects, return a sub-proxy
      if (isObject) {
        if (!subProxyCache.has(childValue)) {
          subProxyCache.set(childValue, buildProxy(childValue, newPath, store, trackPath, bailedOutObjects, subProxyCache));
        }
        return subProxyCache.get(childValue);
      }

      // -- Otherwise it's a primitive or nullish, so return directly
      return childValue;
    },

    getOwnPropertyDescriptor(target, prop) {
      // Bail out on reflection and track as a leaf
      trackPath(store, path, true);
      bailedOutObjects.add(target);
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },

    has(target, prop) {
      // Track `in` operator usage as a leaf
      trackPath(store, path, true);
      return Reflect.has(target, prop);
    },

    ownKeys(target) {
      // Bail out on enumeration and track as a leaf
      trackPath(store, path, true);
      bailedOutObjects.add(target);
      return Reflect.ownKeys(target);
    },
  });
}

// ============ Proxy Stripping ================================================= //

/**
 * Strips tracking proxies from published values to ensure
 * proxies remain confined to internal tracking contexts.
 */
export function stripProxies<T>(value: T): T;
export function stripProxies(value: unknown, seen?: WeakSet<object>): unknown;
export function stripProxies(value: unknown, seen?: WeakSet<object>): unknown {
  if (!value || typeof value !== 'object') return value;

  const target = unwrapTrackingProxy(value);
  if (target) return target;

  if (Array.isArray(value)) stripArrayProxyValues(value, seen);
  else if (isPlainObject(value)) stripOwnProxyValues(value, seen);

  return value;
}

function stripArrayProxyValues(value: unknown[], seen?: WeakSet<object>): void {
  const visited = enterContainer(value, seen);
  if (!visited) return;

  for (let i = 0; i < value.length; i++) {
    stripPropertyValue(value, String(i), visited);
  }
}

function stripOwnProxyValues(value: object, seen?: WeakSet<object>): void {
  const visited = enterContainer(value, seen);
  if (!visited) return;

  for (const key of Reflect.ownKeys(value)) stripPropertyValue(value, key, visited);
}

function stripPropertyValue(target: object, key: PropertyKey, seen: WeakSet<object>): void {
  const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
  if (!descriptor || !('value' in descriptor)) return;

  const nextValue = stripProxies(descriptor.value, seen);
  if (nextValue === descriptor.value) return;

  descriptor.value = nextValue;
  Reflect.defineProperty(target, key, descriptor);
}

// ============ Helpers ======================================================== //

function unwrapTrackingProxy(value: object): object | undefined {
  const target = Reflect.get(value, TRACKING_PROXY_UNWRAP);
  return target && typeof target === 'object' ? target : undefined;
}

function enterContainer(value: object, seen?: WeakSet<object>): WeakSet<object> | null {
  const visited = seen ?? new WeakSet<object>();
  if (visited.has(value)) return null;
  visited.add(value);
  return visited;
}

// ============ Type Guards ==================================================== //

function isCachedProxy<S>(cachedProxyState: unknown | undefined): cachedProxyState is S {
  return cachedProxyState !== undefined;
}
