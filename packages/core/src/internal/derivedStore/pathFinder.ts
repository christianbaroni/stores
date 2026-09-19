import type { Selector, SubscribableStore } from '../../types';
import { identity, nullObject } from '../../utils/core';
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

export type PathFinder = {
  buildProxySubscriptions(createSubscription: SubscriptionBuilder, shouldLog: boolean, minConsolidationDepth?: number): void;
  reset(): void;
  trackPath: TrackPathFn;
};

export type TrackPathFn = (store: SubscribableStore, path: string[], isLeaf: boolean, invocation?: TrackedInvocation) => void;

type TrackedInvocation = { args: unknown[] | undefined };
type SubscriptionBuilder = (store: SubscribableStore, selector: Selector<unknown, unknown>, path: string[]) => void;

type PathEntry = {
  path: string[];
  store: SubscribableStore;
  invocation?: TrackedInvocation;
};

// ============ Public API ===================================================== //

export function createPathFinder(): PathFinder {
  let singleStore: SubscribableStore | undefined;
  let singleRoot: TrieNode | undefined;
  let storeMap: Map<SubscribableStore, TrieNode> | undefined;

  return {
    buildProxySubscriptions(createSubscription: SubscriptionBuilder, shouldLog: boolean, minConsolidationDepth?: number) {
      const results: PathEntry[] = [];
      const root = singleRoot;
      const store = singleStore;

      if (root && store) collectMinimalPaths(root, store, [], 0, results, minConsolidationDepth);
      else if (storeMap) {
        for (const entry of storeMap) collectMinimalPaths(entry[1], entry[0], [], 0, results, minConsolidationDepth);
      }

      buildPathSubscriptions(results, createSubscription, shouldLog);
    },

    reset(): void {
      singleStore = undefined;
      singleRoot = undefined;
      storeMap = undefined;
    },

    trackPath(store, path, isLeaf, invocation) {
      let root = singleRoot;
      if (root) {
        const currentStore = singleStore;
        if (currentStore !== store) {
          if (!currentStore) singleStore = store;
          else {
            const map = (storeMap ??= new Map());
            map.set(currentStore, root);
            root = createTrieNode();
            map.set(store, root);
            singleStore = undefined;
            singleRoot = undefined;
          }
        }
      } else {
        const map = storeMap;
        if (map) {
          root = map.get(store);
          if (!root) {
            root = createTrieNode();
            map.set(store, root);
          }
        } else {
          root = createTrieNode();
          singleStore = store;
          singleRoot = root;
        }
      }
      insertPath(root, path, isLeaf, invocation);
    },
  };
}

// ============ Trie Utilities ================================================= //

/**
 * `child` and `childKey` are the unary edge; `children` is its promoted form.
 */
type TrieNode = {
  child?: TrieNode;
  childKey?: string;
  children?: Record<string, TrieNode>;
  extraInvocations?: TrackedInvocation[];
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
function insertPath(root: TrieNode, path: string[], isLeaf?: boolean, invocation?: TrackedInvocation): void {
  let node = root;

  for (let i = 0; i < path.length; i++) {
    const segment = path[i];
    const children = node.children;
    let child: TrieNode | undefined;

    if (children) {
      child = children[segment];
      if (!child) child = children[segment] = createTrieNode();
    } else {
      child = node.child;
      if (!child) {
        child = createTrieNode();
        node.child = child;
        node.childKey = segment;
      } else if (node.childKey !== segment) {
        const childKey = node.childKey;
        if (childKey === undefined) node.childKey = segment;
        else {
          const branches = createTrieNode<RootNode>();
          branches[childKey] = child;
          child = branches[segment] = createTrieNode();
          node.child = undefined;
          node.childKey = undefined;
          node.children = branches;
        }
      }
    }

    node = child;
  }

  if (isLeaf) node.isLeaf = true;
  if (invocation) addInvocation(node, invocation);
}

/**
 * Collects the minimal subscription paths using inline unary edges and a
 * mutable traversal stack. Only final subscription paths are copied.
 */
function collectMinimalPaths(
  node: TrieNode,
  store: SubscribableStore,
  path: string[],
  depth: number,
  results: PathEntry[],
  minConsolidationDepth = DEFAULT_MIN_CONSOLIDATION_DEPTH
): void {
  const child = node.child;
  if (child) {
    const childKey = node.childKey;
    if (node.isLeaf) {
      collectPathEntries(node, store, path, results);
      if (!child.invocation || childKey === undefined) return;
    } else if (childKey === undefined) {
      collectPathEntries(node, store, path, results);
      return;
    }

    path.push(childKey);
    collectMinimalPaths(child, store, path, depth + 1, results, minConsolidationDepth);
    path.pop();
    return;
  }

  const children = node.children;
  if (!children) {
    collectPathEntries(node, store, path, results);
    return;
  }

  if (node.isLeaf || depth >= minConsolidationDepth) {
    collectPathEntries(node, store, path, results);
    for (const key in children) {
      const branch = children[key];
      if (!branch.invocation) continue;
      path.push(key);
      collectMinimalPaths(branch, store, path, depth + 1, results, minConsolidationDepth);
      path.pop();
    }
    return;
  }

  for (const key in children) {
    path.push(key);
    collectMinimalPaths(children[key], store, path, depth + 1, results, minConsolidationDepth);
    path.pop();
  }
}

// ============ Invocation Tracking Utilities ================================== //

function addInvocation(node: TrieNode, invocation: TrackedInvocation): void {
  const current = node.invocation;
  if (!current) {
    node.invocation = invocation;
    return;
  }

  if (isSameInvocation(current, invocation)) return;

  const extraInvocations = node.extraInvocations;
  if (!extraInvocations) {
    node.extraInvocations = [invocation];
    return;
  }

  for (let i = 0; i < extraInvocations.length; i++) if (isSameInvocation(extraInvocations[i], invocation)) return;
  extraInvocations.push(invocation);
}

function isSameInvocation(left: TrackedInvocation, right: TrackedInvocation): boolean {
  const leftArgs = left.args;
  const rightArgs = right.args;
  const leftLength = leftArgs?.length ?? 0;

  if (leftLength !== (rightArgs?.length ?? 0)) return false;
  if (!leftArgs || !rightArgs) return true;

  for (let i = 0; i < leftLength; i++) if (!Object.is(leftArgs[i], rightArgs[i])) return false;
  return true;
}

function collectPathEntries(node: TrieNode, store: SubscribableStore, path: string[], results: PathEntry[]): void {
  const entryPath = path.slice();
  const invocation = node.invocation;

  if (!invocation) {
    results.push({ store, path: entryPath });
    return;
  }

  results.push({ store, path: entryPath, invocation });

  const extraInvocations = node.extraInvocations;
  if (!extraInvocations) return;

  for (let i = 0; i < extraInvocations.length; i++) {
    results.push({ store, path: entryPath, invocation: extraInvocations[i] });
  }
}

// ============ Proxy Subscription Utilities =================================== //

function buildPathSubscriptions(finalPaths: readonly PathEntry[], createSubscription: SubscriptionBuilder, shouldLog: boolean): void {
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
  if (!path.length) return identity;
  return state => getValueAtPath(state, path);
}

/**
 * Builds a selector that returns the value returned by invoking the
 * specified method on the parent object.
 */
function buildInvocationSelector(path: string[], invocation: TrackedInvocation): Selector<unknown, unknown> {
  const parentPath = path.slice(0, -1);
  const method = path[path.length - 1];
  return state => {
    const parentObject = getValueAtPath(state, parentPath);
    const fn = parentObject && typeof parentObject === 'object' ? Reflect.get(parentObject, method) : undefined;
    return typeof fn === 'function' ? Reflect.apply(fn, parentObject, invocation.args ?? EMPTY_INVOCATION_ARGS) : undefined;
  };
}

/** Reads a nested property path until the value no longer supports traversal. */
function getValueAtPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (let i = 0; i < path.length; i++) {
    if (!current || typeof current !== 'object') return current;
    current = Reflect.get(current, path[i]);
  }
  return current;
}

// ============ Debug Utilities ================================================ //

function logTrackedPaths(paths: readonly PathEntry[]): void {
  const count = paths.length;
  console.log(
    `[📡 ${count} ${pluralize('Proxy Subscription', count)} 📡]:`,
    JSON.stringify(
      paths.map(entry => {
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
