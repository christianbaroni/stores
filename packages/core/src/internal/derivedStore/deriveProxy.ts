import type { StoreApi } from '../../store/types';
import { hasOwn, isArrayIndex, isPlainObject } from '../../types/utils';
import { trackChild, trackInvocation, trackLeaf, type PathFinder, type TrieNode } from './pathFinder';

// ============ Constants ====================================================== //

const TRACKING_PROXY_UNWRAP = Symbol('stores.deriveProxy.unwrap');

// ============ Proxy Creator ================================================== //

/**
 * Returns a store snapshot with automatic dependency tracking.
 */
export function getOrCreateProxy<S>(store: StoreApi<S>, snapshot: S, rootProxyCache: WeakMap<object, unknown>, pathFinder: PathFinder): S {
  const cachedProxy = rootProxyCache.get(store);
  if (isCachedProxy<S>(cachedProxy)) return cachedProxy;

  const proxy = createTrackingProxy(snapshot, () => pathFinder.root(store, snapshot));
  rootProxyCache.set(store, proxy);
  return proxy;
}

function createTrackingProxy<S>(snapshot: S, root: () => TrieNode): S {
  // -- If the store state is a primitive or nullish, track as a leaf and return directly
  if (!snapshot || typeof snapshot !== 'object') {
    trackLeaf(root());
    return snapshot;
  }

  return new Proxy(snapshot, new TrackingHandler(root));
}

class TrackingHandler<T extends object> implements ProxyHandler<T> {
  constructor(
    private readonly node: TrieNode | (() => TrieNode),
    private context?: { proxies?: WeakMap<object, object>; bailedOutObjects?: WeakSet<object> }
  ) {}

  get(target: T, propKey: string | symbol, receiver: unknown): unknown {
    if (propKey === TRACKING_PROXY_UNWRAP) {
      trackLeaf(this.getNode());
      return target;
    }

    // -- If we've already bailed out on this object, no further sub-proxies
    if (this.context?.bailedOutObjects?.has(target)) {
      return Reflect.get(target, propKey, receiver);
    }

    // -- If it's a symbol or __proto__, handle normally (and bail out on iteration)
    if (propKey === '__proto__' || typeof propKey === 'symbol') {
      // If enumerating or iterating, treat that as a leaf usage on the parent
      if (propKey === Symbol.iterator) this.bailOut(target);
      return Reflect.get(target, propKey, receiver);
    }

    // -- Array elements depend on the full array
    if (Array.isArray(target) && isArrayIndex(propKey)) {
      this.bailOut(target);
      return Reflect.get(target, propKey, receiver);
    }

    // -- Get the property value
    const childValue = Reflect.get(target, propKey, target);

    // -- Handle functions
    if (typeof childValue === 'function') {
      if (hasOwn(target, propKey)) {
        // Return a wrapped function that tracks invocation when called. This allows
        // building a selector that points to the value *returned* by the method call.
        return (...args: unknown[]) => {
          const value = Reflect.apply(childValue, target, args);
          trackInvocation(trackChild(this.getNode(), propKey, childValue), args, value);
          return value;
        };
      }

      // Built-in prototype function (e.g. .toString), track as final usage (a leaf)
      trackLeaf(this.getNode());
      return childValue.bind(target);
    }

    // -- Handle non-function property tracking
    // Primitives or nullish values: track as a leaf
    // Objects: track as ancestor usage and return a sub-proxy
    const childNode = trackChild(this.getNode(), propKey, childValue);
    if (!childValue || typeof childValue !== 'object') {
      trackLeaf(childNode);
      return childValue;
    }

    const context = (this.context ??= {});
    const proxies = (context.proxies ??= new WeakMap());
    let proxy = proxies.get(childValue);

    if (!proxy) {
      proxy = new Proxy(childValue, new TrackingHandler(childNode, context));
      proxies.set(childValue, proxy);
    }

    return proxy;
  }

  getOwnPropertyDescriptor(target: T, prop: string | symbol): PropertyDescriptor | undefined {
    // Bail out on reflection and track as a leaf
    this.bailOut(target);
    return Reflect.getOwnPropertyDescriptor(target, prop);
  }

  has(target: T, prop: string | symbol): boolean {
    // Track `in` operator usage as a leaf
    trackLeaf(this.getNode());
    return Reflect.has(target, prop);
  }

  ownKeys(target: T): (string | symbol)[] {
    // Bail out on enumeration and track as a leaf
    this.bailOut(target);
    return Reflect.ownKeys(target);
  }

  private getNode(): TrieNode {
    return typeof this.node === 'function' ? this.node() : this.node;
  }

  private bailOut(target: object): void {
    trackLeaf(this.getNode());
    ((this.context ??= {}).bailedOutObjects ??= new WeakSet()).add(target);
  }
}

// ============ Proxy Stripping ================================================= //

/**
 * Strips tracking proxies from published values to ensure
 * proxies remain confined to internal tracking contexts.
 */
export function stripProxies<T>(value: T): T;
export function stripProxies(value: unknown): unknown {
  return value && typeof value === 'object' ? stripProxyValues(value) : value;
}

function stripProxyValues(value: object, seen?: WeakSet<object>): object {
  const target: unknown = Reflect.get(value, TRACKING_PROXY_UNWRAP);
  if (target && typeof target === 'object') return target;

  const isArray = Array.isArray(value);
  if (!isArray && !isPlainObject(value)) return value;

  const visited = seen ?? new WeakSet<object>();
  if (visited.has(value)) return value;

  visited.add(value);
  if (isArray) for (let i = 0; i < value.length; i++) stripPropertyValue(value, String(i), visited);
  else for (const key of Reflect.ownKeys(value)) stripPropertyValue(value, key, visited);

  return value;
}

function stripPropertyValue(target: object, key: PropertyKey, seen: WeakSet<object>): void {
  const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
  if (!descriptor || !('value' in descriptor)) return;

  const value: unknown = descriptor.value;
  if (!value || typeof value !== 'object') return;

  const nextValue = stripProxyValues(value, seen);
  if (nextValue === value) return;

  descriptor.value = nextValue;
  Reflect.defineProperty(target, key, descriptor);
}

// ============ Type Guards ==================================================== //

function isCachedProxy<S>(cachedProxy: unknown): cachedProxy is S {
  return cachedProxy !== undefined;
}
