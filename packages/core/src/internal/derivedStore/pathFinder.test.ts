import { describe, expect, it } from 'vitest';
import { createBaseStore } from '../../createBaseStore';
import type { Selector, SubscribableStore } from '../../types';
import { getOrCreateProxy } from './deriveProxy';
import { PathFinder, trackChild, trackInvocation, trackLeaf } from './pathFinder';

function recordPath(
  pathFinder: PathFinder,
  store: SubscribableStore & { getState(): unknown },
  path: string[],
  isLeaf: boolean,
  invocation?: { args: unknown[] }
): void {
  let node = pathFinder.root(store, store.getState());
  for (const segment of path) node = trackChild(node, segment, undefined);
  if (isLeaf) trackLeaf(node);
  if (invocation) trackInvocation(node, invocation.args, undefined);
}

type Subscription = {
  path: string[];
  selector: Selector<unknown, unknown>;
  store: SubscribableStore;
};

function buildSubscriptions(pathFinder: PathFinder, minConsolidationDepth?: number): Subscription[] {
  const subscriptions: Subscription[] = [];
  pathFinder.buildProxySubscriptions(
    (store, selector, path) => subscriptions.push({ path: path.slice(), selector, store }),
    false,
    undefined,
    minConsolidationDepth
  );
  return subscriptions;
}

function paths(pathFinder: PathFinder, minConsolidationDepth?: number): string[] {
  return buildSubscriptions(pathFinder, minConsolidationDepth).map(subscription => subscription.path.join('.'));
}

describe('path finder', () => {
  it('subscribes to the deepest leaf of an unbranched path', () => {
    const store = createBaseStore(() => ({ user: { name: 'Ada' } }));
    const pathFinder = new PathFinder();

    recordPath(pathFinder, store, ['user'], false);
    recordPath(pathFinder, store, ['user', 'name'], true);

    const subscriptions = buildSubscriptions(pathFinder);
    expect(subscriptions.map(subscription => subscription.path)).toEqual([['user', 'name']]);
    expect(subscriptions[0].selector(store.getState())).toBe('Ada');
  });

  it('lets a root leaf subsume unrelated descendant reads', () => {
    const store = createBaseStore(() => ({ first: 1, nested: { value: 2 } }));
    const pathFinder = new PathFinder();

    recordPath(pathFinder, store, ['first'], true);
    recordPath(pathFinder, store, ['nested', 'value'], true);
    recordPath(pathFinder, store, [], true);

    const subscriptions = buildSubscriptions(pathFinder);
    expect(subscriptions.map(subscription => subscription.path)).toEqual([[]]);
    expect(subscriptions[0].selector(store.getState())).toEqual(store.getState());
  });

  it('preserves leaf subsumption without losing descendant invocations', () => {
    const store = createBaseStore(() => ({
      user: {
        label: 'Ada',
        lookup(value: number) {
          return `${this.label}:${value}`;
        },
      },
    }));
    const pathFinder = new PathFinder();

    recordPath(pathFinder, store, ['user'], true);
    recordPath(pathFinder, store, ['user', 'label'], true);
    recordPath(pathFinder, store, ['user', 'lookup'], false, { args: [2] });

    const subscriptions = buildSubscriptions(pathFinder);
    expect(subscriptions.map(subscription => subscription.path)).toEqual([['user'], ['user', 'lookup']]);
    expect(subscriptions[0].selector(store.getState())).toEqual(store.getState().user);
    expect(subscriptions[1].selector(store.getState())).toBe('Ada:2');
  });

  it('preserves invocation ownership when a leaf and invocation share one path', () => {
    const store = createBaseStore(() => ({
      value() {
        return 7;
      },
    }));
    const pathFinder = new PathFinder();

    recordPath(pathFinder, store, ['value'], true);
    recordPath(pathFinder, store, ['value'], false, { args: [] });

    const subscriptions = buildSubscriptions(pathFinder);
    expect(subscriptions.map(subscription => subscription.path)).toEqual([['value']]);
    expect(subscriptions[0].selector(store.getState())).toBe(7);
  });

  it('keeps independent top-level paths separate', () => {
    const store = createBaseStore(() => ({ first: 1, second: 2 }));
    const pathFinder = new PathFinder();

    recordPath(pathFinder, store, ['first'], true);
    recordPath(pathFinder, store, ['second'], true);

    expect(paths(pathFinder)).toEqual(['first', 'second']);
  });

  it('keeps separate leaf paths and discards them on reset', () => {
    const store = createBaseStore(() => ({ left: { value: 1 }, right: { value: 2 } }));
    const pathFinder = new PathFinder();

    recordPath(pathFinder, store, ['left'], false);
    recordPath(pathFinder, store, ['left', 'value'], true);
    recordPath(pathFinder, store, ['right'], false);
    recordPath(pathFinder, store, ['right', 'value'], true);

    expect(paths(pathFinder)).toEqual(['left.value', 'right.value']);

    pathFinder.reset();
    recordPath(pathFinder, store, ['right'], false);
    recordPath(pathFinder, store, ['right', 'value'], true);
    expect(paths(pathFinder)).toEqual(['right.value']);
  });

  it('consolidates sibling paths only at the configured depth', () => {
    const store = createBaseStore(() => ({ root: { branch: { first: 1, second: 2 } } }));
    const pathFinder = new PathFinder();

    recordPath(pathFinder, store, ['root', 'branch', 'first'], true);
    recordPath(pathFinder, store, ['root', 'branch', 'second'], true);

    expect(paths(pathFinder, 2)).toEqual(['root.branch']);
    expect(paths(pathFinder, Number.POSITIVE_INFINITY)).toEqual(['root.branch.first', 'root.branch.second']);
  });

  it('preserves paths for multiple stores and discards them on reset', () => {
    const first = createBaseStore(() => ({ first: 1, second: 2, third: 3 }));
    const second = createBaseStore(() => ({ fourth: 4 }));
    const pathFinder = new PathFinder();

    recordPath(pathFinder, first, ['first'], true);
    recordPath(pathFinder, first, ['second'], true);
    recordPath(pathFinder, first, ['third'], true);
    recordPath(pathFinder, second, ['fourth'], true);

    const subscriptions = buildSubscriptions(pathFinder);
    expect(subscriptions.map(subscription => subscription.store)).toEqual([first, first, first, second]);
    expect(subscriptions.map(subscription => subscription.path)).toEqual([['first'], ['second'], ['third'], ['fourth']]);
    expect([
      subscriptions[0].selector(first.getState()),
      subscriptions[1].selector(first.getState()),
      subscriptions[2].selector(first.getState()),
      subscriptions[3].selector(second.getState()),
    ]).toEqual([1, 2, 3, 4]);

    pathFinder.reset();
    recordPath(pathFinder, second, ['fourth'], true);

    const resetSubscriptions = buildSubscriptions(pathFinder);
    expect(resetSubscriptions.map(subscription => subscription.store)).toEqual([second]);
    expect(resetSubscriptions.map(subscription => subscription.path)).toEqual([['fourth']]);
  });

  it('promotes unary edges without confusing path keys with trie state', () => {
    const store = createBaseStore(() => ({}));
    const pathFinder = new PathFinder();

    recordPath(pathFinder, store, ['root', '__proto__'], true);
    recordPath(pathFinder, store, ['root', 'child'], true);
    recordPath(pathFinder, store, ['root', 'child'], true);
    recordPath(pathFinder, store, ['root', 'childKey'], true);
    recordPath(pathFinder, store, ['root', 'children'], true);
    recordPath(pathFinder, store, ['root', 'constructor'], true);

    const subscriptions = buildSubscriptions(pathFinder, Number.POSITIVE_INFINITY);
    expect(subscriptions.map(subscription => subscription.path)).toEqual([
      ['root', '__proto__'],
      ['root', 'child'],
      ['root', 'childKey'],
      ['root', 'children'],
      ['root', 'constructor'],
    ]);
  });

  it('keeps single-property selectors stable across traversal and non-object snapshots', () => {
    const store = createBaseStore(() => ({ first: 1, second: 2 }));
    const tracker = new PathFinder();
    recordPath(tracker, store, ['first'], true);
    recordPath(tracker, store, ['second'], true);
    const subscriptions = buildSubscriptions(tracker);
    expect(subscriptions.map(subscription => subscription.selector(store.getState()))).toEqual([1, 2]);
    expect(subscriptions[0].selector({ first: 3 })).toBe(3);
    for (const snapshot of [null, undefined, 0, false, 'value', () => 1]) {
      expect(subscriptions[0].selector(snapshot)).toBe(snapshot);
    }
  });

  it('builds a complete snapshot before subscription callbacks run', () => {
    const first = createBaseStore(() => ({ first: 1, second: 2 }));
    const replacement = createBaseStore(() => ({ replacement: 3 }));
    const pathFinder = new PathFinder();
    const trackedPaths: string[][] = [];

    recordPath(pathFinder, first, ['first'], true);
    recordPath(pathFinder, first, ['second'], true);
    pathFinder.buildProxySubscriptions((_store, _selector, path) => {
      trackedPaths.push(path.slice());
      if (trackedPaths.length !== 1) return;
      pathFinder.reset();
      recordPath(pathFinder, replacement, ['replacement'], true);
    }, false);

    expect(trackedPaths).toEqual([['first'], ['second']]);
    expect(buildSubscriptions(pathFinder).map(subscription => subscription.path)).toEqual([['replacement']]);
  });
});

describe('attachment validation', () => {
  it('checks the method result observed before attachment', () => {
    const store = createBaseStore<{ value: number; read(): number }>((_set, get) => ({
      value: 1,
      read: () => get().value,
    }));
    const snapshot = store.getState();
    const pathFinder = new PathFinder();
    const tracked = getOrCreateProxy(store, snapshot, new WeakMap(), pathFinder);
    expect(tracked.read()).toBe(1);

    const changed = pathFinder.buildProxySubscriptions(
      () => store.setState({ value: 2 }),
      false,
      source => source.getState()
    );
    expect(changed).toBe(true);
    expect(snapshot.read()).toBe(2);
  });
});
