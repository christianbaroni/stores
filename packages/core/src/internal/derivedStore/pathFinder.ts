import { Selector, SubscribableStore } from '../../types';
import { nullObject } from '../../utils/core';
import { pluralize } from '../../utils/stringUtils';

// ============ Settings ======================================================= //

/**
 * Minimum object depth at which subscription consolidation is allowed.
 *  - `1`: Never consolidate at root — top-level fields get individual subscriptions.
 *  - `2`: Never consolidate at root or depth 1, etc.
 */
const DEFAULT_MIN_CONSOLIDATION_DEPTH = 2;

// ============ Constants ====================================================== //

const EMPTY_INVOCATION_ARGS = Object.freeze<unknown[]>([]);

// ============ Types ========================================================== //

type TrackedInvocation = { args: unknown[] | undefined; method: string };

type PathEntry = {
  path: string[];
  store: SubscribableStore;
  invocation?: TrackedInvocation;
  isLeaf: boolean;
};

type SubscriptionBuilder = (store: SubscribableStore, selector: Selector<unknown, unknown>, path: string[]) => void;

// ============ Public API ============================================ //

export type PathFinder = {
  buildProxySubscriptions(
    createSubscription: SubscriptionBuilder,
    shouldLog: boolean,
    minConsolidationDepth?: number,
    shouldBuild?: (paths: Set<PathEntry>) => boolean
  ): void;
  reset(): void;
  trackPath: TrackPathFn;
};

export type TrackPathFn = (store: SubscribableStore, path: string[], isLeaf: boolean, invocation?: TrackedInvocation) => void;

/**
 * A factory that returns a proxy path-tracking object with three methods:
 *  - `buildProxySubscriptions()`: builds subscriptions to the final paths
 *  - `reset()`: clears all tracked paths
 *  - `trackPath()`: records usage of a store path
 */
export function createPathFinder(): PathFinder {
  const storeMap = new Map<SubscribableStore, TrieNode>();

  return {
    buildProxySubscriptions(
      createSubscription: SubscriptionBuilder,
      shouldLog: boolean,
      minConsolidationDepth?: number,
      shouldBuild?: (paths: Set<PathEntry>) => boolean
    ) {
      const results = new Set<PathEntry>();
      for (const entry of storeMap) {
        collectMinimalPaths(entry[1], entry[0], [], 0, results, minConsolidationDepth);
      }
      if (shouldBuild?.(results) === false) return;

      buildProxySubscriptions(results, createSubscription, shouldLog);
    },

    reset(): void {
      storeMap.clear();
    },

    trackPath(store, path, isLeaf, invocation) {
      let root = storeMap.get(store);
      if (!root) {
        root = createTrieNode();
        storeMap.set(store, root);
      }
      insertPath(root, path, 0, isLeaf, invocation);
    },
  };
}

// ============ Trie Utilities ================================================= //

type TrieNode = {
  children?: Record<string, TrieNode>;
  invocation?: TrackedInvocation;
  isLeaf?: boolean;
};

type RootNode = Record<string, TrieNode>;

/**
 * Creates a prototype-free trie node object.
 */
function createTrieNode<T extends TrieNode | RootNode = TrieNode>(): T {
  return nullObject();
}

/**
 * Inserts a path into the trie, creating nodes to represent the path.
 */
function insertPath(node: TrieNode, path: string[], index: number, isLeaf?: boolean, invocation?: TrackedInvocation): void {
  if (index === path.length) {
    if (isLeaf) node.isLeaf = true;
    if (invocation) node.invocation = invocation;
    return;
  }
  if (!node.children) {
    node.children = createTrieNode<RootNode>();
  }
  const segment = path[index];
  let child = node.children?.[segment];
  if (!child) {
    child = createTrieNode();
    node.children[segment] = child;
  }
  insertPath(child, path, index + 1, isLeaf, invocation);
}

/**
 * Determines and collects the final paths to build selectors for.
 */
function collectMinimalPaths(
  node: TrieNode,
  store: SubscribableStore,
  path: string[],
  depth: number,
  results: Set<PathEntry>,
  minConsolidationDepth = DEFAULT_MIN_CONSOLIDATION_DEPTH
): void {
  const children = node.children;
  if (!children) {
    // Leaf node
    results.add({ store, path, invocation: node.invocation, isLeaf: node.isLeaf ?? false });
    return;
  }
  const childKeys = Object.keys(children);
  const childCount = childKeys.length;

  // -- 1) No children => leaf
  if (childCount === 0) {
    results.add({ store, path, invocation: node.invocation, isLeaf: node.isLeaf ?? false });
    return;
  }

  // -- 2) Is a leaf (or at/beyond min depth with multiple children) => subscribe here
  if (node.isLeaf || (depth >= minConsolidationDepth && childCount > 1)) {
    results.add({ store, path, invocation: node.invocation, isLeaf: node.isLeaf ?? false });
    // Only recurse into children that have an invocation
    for (const key of childKeys) {
      const child = children[key];
      if (child.invocation) collectMinimalPaths(child, store, [...path, key], depth + 1, results, minConsolidationDepth);
    }
    return;
  }

  // -- 3) Below min consolidation depth with multiple children => skip this node, recurse each child
  if (depth < minConsolidationDepth && childCount > 1 && !node.isLeaf) {
    for (const key of childKeys) {
      collectMinimalPaths(children[key], store, [...path, key], depth + 1, results, minConsolidationDepth);
    }
    return;
  }

  // -- 4) Exactly one child, not a leaf => merge downward
  if (childCount === 1) {
    const onlyKey = childKeys[0];
    collectMinimalPaths(children[onlyKey], store, [...path, onlyKey], depth + 1, results, minConsolidationDepth);
    return;
  }

  // If no prior conditions met, subscribe here
  results.add({ store, path, invocation: node.invocation, isLeaf: node.isLeaf ?? false });
}

// ============ Proxy Subscription Utilities =================================== //

function buildProxySubscriptions(finalPaths: Set<PathEntry>, createSubscription: SubscriptionBuilder, shouldLog: boolean): void {
  for (const entry of finalPaths) {
    const selector = entry.invocation ? buildInvocationSelector(entry.path, entry.invocation) : buildPathSelector(entry.path);
    createSubscription(entry.store, selector, entry.path);
  }
  if (shouldLog) logTrackedPaths(finalPaths);
}

/**
 * Builds a selector that returns the value at the specified path.
 */
function buildPathSelector(path: string[]): Selector<unknown, unknown> {
  return state => getValueAtPath(state, path);
}

/**
 * Builds a selector that returns the value returned by invoking the
 * specified method on the parent object.
 */
function buildInvocationSelector(path: string[], invocation: TrackedInvocation): Selector<unknown, unknown> {
  const parentPath = path.slice(0, -1);
  return state => {
    const parentObject = getValueAtPath(state, parentPath);
    const fn = parentObject && typeof parentObject === 'object' ? Reflect.get(parentObject, invocation.method) : undefined;
    return typeof fn === 'function' ? Reflect.apply(fn, parentObject, invocation.args ?? EMPTY_INVOCATION_ARGS) : undefined;
  };
}

/**
 * Gets the value at the specified path in an object.
 *
 * `path` is an array of keys used to traverse the object.
 *
 * @example
 * ```ts
 * const obj = { a: { b: { c: 1 } } };
 * getValueAtPath(obj, ['a', 'b', 'c']); // 1
 * ```
 */
function getValueAtPath(obj: unknown, path: string[]): unknown {
  let current = obj;
  for (const p of path) {
    if (!current || typeof current !== 'object') return current;
    current = Reflect.get(current, p);
  }
  return current;
}

// ============ Debug Utilities ================================================ //

function logTrackedPaths(paths: Set<PathEntry>): void {
  const count = paths.size;
  console.log(
    `[📡 ${count} ${pluralize('Proxy Subscription', count)} 📡]:`,
    JSON.stringify(
      Array.from(paths).map(entry => {
        const storeName = extractStoreName(entry.store);
        const pathKey = entry.path.join('.');
        if (!entry.invocation) return pathKey ? `$(${storeName}).${pathKey}` : `$(${storeName})`;

        const argsCount = entry.invocation.args?.length ?? 0;
        const argsSuffix = argsCount ? `(${argsCount}_${pluralize('arg', argsCount)})` : '()';
        return `$(${storeName}).${pathKey}${argsSuffix}`;
      }),
      null,
      2
    )
  );
}

function extractStoreName(store: SubscribableStore): string {
  return 'name' in store && typeof store.name === 'string' ? store.name : 'store';
}
