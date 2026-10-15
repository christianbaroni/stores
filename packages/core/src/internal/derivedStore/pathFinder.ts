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

const EMPTY_ARRAY = Object.freeze([]);

// ============ Types ========================================================== //

type SnapshotStore = SubscribableStore & { getState(): unknown };
type StoreRoot = TrieNode & { readonly store: SnapshotStore };

type TrackedInvocation = { args: unknown[] | undefined; value: unknown };
type SubscriptionBuilder = (store: SnapshotStore, selector: Selector<unknown, unknown>, path: readonly string[]) => void;

type SubscriptionBuild = {
  readonly createSubscription: SubscriptionBuilder;
  readonly readState: ((store: SnapshotStore) => unknown) | undefined;
  readonly paths: PathEntry[] | undefined;
  readonly minDepth: number;
  changed: boolean;
};

type PathEntry = {
  path: string[];
  root: StoreRoot;
  invocation?: TrackedInvocation;
};

// ============ Path Finder ==================================================== //

/**
 * Records property reads and method calls by source store, then builds
 * the corresponding dependency subscriptions.
 */
export class PathFinder {
  private singleRoot: StoreRoot | undefined;
  private storeMap: Map<SnapshotStore, StoreRoot> | undefined;

  /**
   * Builds selectors for tracked reads. When `readState` is supplied,
   * reports whether attachment changed a recorded value.
   * The callback borrows its path; copy it if retaining it.
   */
  buildProxySubscriptions(
    createSubscription: SubscriptionBuilder,
    shouldLog: boolean,
    readState?: (store: SnapshotStore) => unknown,
    minConsolidationDepth = DEFAULT_MIN_CONSOLIDATION_DEPTH
  ): boolean {
    const build: SubscriptionBuild = {
      createSubscription,
      readState,
      paths: shouldLog ? [] : undefined,
      minDepth: minConsolidationDepth,
      changed: false,
    };

    const root = this.singleRoot;
    if (root) visitSubscriptionPaths(root, root, [], 0, build);
    else if (this.storeMap) this.storeMap.forEach(visitRoot, build);

    if (build.paths) logTrackedPaths(build.paths);
    return build.changed;
  }

  reset(): void {
    this.singleRoot = undefined;
    this.storeMap = undefined;
  }

  /**
   * Returns the store's tracking root, creating it if needed.
   */
  root(store: SnapshotStore, snapshot: unknown): TrieNode {
    let root = this.singleRoot;
    if (root) {
      if (root.store === store) return root;
      const map = (this.storeMap = new Map());
      map.set(root.store, root);
      root = { store, value: snapshot };
      map.set(store, root);
      this.singleRoot = undefined;
      return root;
    }

    const map = this.storeMap;
    if (map) {
      root = map.get(store);
      if (!root) map.set(store, (root = { store, value: snapshot }));
      return root;
    }

    this.singleRoot = { store, value: snapshot };
    return this.singleRoot;
  }
}

// ============ Trie Utilities ================================================= //

/**
 * A node in a store's tree of tracked property reads and method calls.
 */
export type TrieNode = {
  value: unknown;
  child?: TrieNode;
  childKey?: string;
  children?: Record<string, TrieNode>;
  extraInvocations?: TrackedInvocation[];
  invocation?: TrackedInvocation;
  isLeaf?: boolean;
};

type RootNode = Record<string, TrieNode>;

/**
 * Returns a property’s tracking node, recording its value when first observed.
 */
export function trackChild(node: TrieNode, segment: string, value: unknown): TrieNode {
  const children = node.children;
  if (children) return (children[segment] ??= { value });

  const child = node.child;
  if (!child) {
    const created = { value };
    node.child = created;
    node.childKey = segment;
    return created;
  }

  const childKey = node.childKey;
  if (childKey === segment) return child;
  if (childKey === undefined) {
    node.childKey = segment;
    return child;
  }

  const branches = nullObject<RootNode>();
  branches[childKey] = child;

  const created = (branches[segment] = { value });
  node.child = undefined;
  node.childKey = undefined;
  node.children = branches;

  return created;
}

/**
 * Records that the value at `node` was read as a whole.
 */
export function trackLeaf(node: TrieNode): void {
  node.isLeaf = true;
}

/**
 * Records a method call and the value it returned.
 */
export function trackInvocation(node: TrieNode, args: unknown[], value: unknown): void {
  node.isLeaf = true;
  addInvocation(node, { args: args.length ? args : undefined, value });
}

function visitRoot(this: SubscriptionBuild, root: StoreRoot): void {
  visitSubscriptionPaths(root, root, [], 0, this);
}

function visitSubscriptionPaths(node: TrieNode, root: StoreRoot, path: string[], depth: number, build: SubscriptionBuild): void {
  const child = node.child;
  if (child) {
    const childKey = node.childKey;
    if (node.isLeaf) {
      visitPath(node, root, path, build);
      if (!child.invocation || childKey === undefined) return;
    } else if (childKey === undefined) {
      visitPath(node, root, path, build);
      return;
    }

    path.push(childKey);
    visitSubscriptionPaths(child, root, path, depth + 1, build);
    path.pop();
    return;
  }

  const children = node.children;
  if (!children) {
    if (depth || node.isLeaf) visitPath(node, root, path, build);
    return;
  }

  if (node.isLeaf || depth >= build.minDepth) {
    visitPath(node, root, path, build);
    for (const key in children) {
      const branch = children[key];
      if (!branch.invocation) continue;
      path.push(key);
      visitSubscriptionPaths(branch, root, path, depth + 1, build);
      path.pop();
    }
    return;
  }

  for (const key in children) {
    path.push(key);
    visitSubscriptionPaths(children[key], root, path, depth + 1, build);
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

function visitPath(node: TrieNode, root: StoreRoot, path: string[], build: SubscriptionBuild): void {
  const invocation = node.invocation;
  if (!invocation) {
    buildSubscription(build, root, path, node.value);
    return;
  }

  buildSubscription(build, root, path, invocation.value, invocation);
  const extraInvocations = node.extraInvocations;
  if (!extraInvocations) return;

  for (let i = 0; i < extraInvocations.length; i++) {
    const invocation = extraInvocations[i];
    buildSubscription(build, root, path, invocation.value, invocation);
  }
}

function buildSubscription(
  build: SubscriptionBuild,
  root: StoreRoot,
  path: readonly string[],
  value: unknown,
  invocation?: TrackedInvocation
): void {
  let selector: Selector<unknown, unknown>;

  if (invocation) selector = buildInvocationSelector(path, invocation.args);
  else if (!path.length) selector = identity;
  else if (path.length === 1) selector = buildKeySelector(path[0]);
  else selector = buildPathSelector(path.slice());

  build.createSubscription(root.store, selector, path);
  build.paths?.push({ root, path: path.slice(), invocation });

  const readState = build.readState;
  if (!readState || build.changed) return;

  const state = readState(root.store);
  if (!Object.is(root.value, state) && !Object.is(value, selector(state))) build.changed = true;
}

// ============ Proxy Subscription Utilities =================================== //

/**
 * Builds a selector that returns the value at the specified path.
 */
function buildPathSelector(path: readonly string[]): Selector<unknown, unknown> {
  return state => getValueAtPath(state, path);
}

function buildKeySelector(key: string): Selector<unknown, unknown> {
  return state => (state !== null && typeof state === 'object' ? Reflect.get(state, key) : state);
}

/**
 * Builds a selector that returns the value returned by invoking the
 * specified method on the parent object.
 */
function buildInvocationSelector(path: readonly string[], args: readonly unknown[] = EMPTY_ARRAY): Selector<unknown, unknown> {
  const parentPath = path.length > 1 ? path.slice(0, -1) : EMPTY_ARRAY;
  const method = path[path.length - 1];
  return state => {
    const parentObject = getValueAtPath(state, parentPath);
    const fn = parentObject && typeof parentObject === 'object' ? Reflect.get(parentObject, method) : undefined;
    return typeof fn === 'function' ? Reflect.apply(fn, parentObject, args) : undefined;
  };
}

/**
 * Reads a nested property path until the value no longer supports traversal.
 */
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
        const storeName = extractStoreName(entry.root.store);
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

function extractStoreName(store: SnapshotStore): string {
  return 'name' in store && typeof store.name === 'string' ? store.name : 'store';
}
