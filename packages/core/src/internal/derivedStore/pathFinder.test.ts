import { describe, expect, it } from 'vitest';
import { createBaseStore } from '../../createBaseStore';
import type { Selector, SubscribableStore } from '../../types';
import { createPathFinder, type PathFinder } from './pathFinder';

type Subscription = {
  path: string[];
  selector: Selector<unknown, unknown>;
  store: SubscribableStore;
};

function buildSubscriptions(pathFinder: PathFinder, minConsolidationDepth?: number): Subscription[] {
  const subscriptions: Subscription[] = [];
  pathFinder.buildProxySubscriptions(
    (store, selector, path) => subscriptions.push({ path, selector, store }),
    false,
    minConsolidationDepth
  );
  return subscriptions;
}

function paths(pathFinder: PathFinder, minConsolidationDepth?: number): string[] {
  return buildSubscriptions(pathFinder, minConsolidationDepth).map(subscription => subscription.path.join('.'));
}

describe('path finder', () => {
  it('keeps one unary dependency minimal', () => {
    const store = createBaseStore(() => ({ user: { name: 'Ada' } }));
    const pathFinder = createPathFinder();

    pathFinder.trackPath(store, ['user'], false);
    pathFinder.trackPath(store, ['user', 'name'], true);

    const subscriptions = buildSubscriptions(pathFinder);
    expect(subscriptions.map(subscription => subscription.path)).toEqual([['user', 'name']]);
    expect(subscriptions[0].selector(store.getState())).toBe('Ada');
  });

  it('lets a root leaf subsume unrelated descendant reads', () => {
    const store = createBaseStore(() => ({ first: 1, nested: { value: 2 } }));
    const pathFinder = createPathFinder();

    pathFinder.trackPath(store, ['first'], true);
    pathFinder.trackPath(store, ['nested', 'value'], true);
    pathFinder.trackPath(store, [], true);

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
    const pathFinder = createPathFinder();

    pathFinder.trackPath(store, ['user'], true);
    pathFinder.trackPath(store, ['user', 'label'], true);
    pathFinder.trackPath(store, ['user', 'lookup'], false, { args: [2] });

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
    const pathFinder = createPathFinder();

    pathFinder.trackPath(store, ['value'], true);
    pathFinder.trackPath(store, ['value'], false, { args: [] });

    const subscriptions = buildSubscriptions(pathFinder);
    expect(subscriptions.map(subscription => subscription.path)).toEqual([['value']]);
    expect(subscriptions[0].selector(store.getState())).toBe(7);
  });

  it('keeps two independent dependencies without forcing trie promotion', () => {
    const store = createBaseStore(() => ({ first: 1, second: 2 }));
    const pathFinder = createPathFinder();

    pathFinder.trackPath(store, ['first'], true);
    pathFinder.trackPath(store, ['second'], true);

    expect(paths(pathFinder)).toEqual(['first', 'second']);
  });

  it('keeps two independent unary chains compact', () => {
    const store = createBaseStore(() => ({ left: { value: 1 }, right: { value: 2 } }));
    const pathFinder = createPathFinder();

    pathFinder.trackPath(store, ['left'], false);
    pathFinder.trackPath(store, ['left', 'value'], true);
    pathFinder.trackPath(store, ['right'], false);
    pathFinder.trackPath(store, ['right', 'value'], true);

    expect(paths(pathFinder)).toEqual(['left.value', 'right.value']);

    pathFinder.reset();
    pathFinder.trackPath(store, ['right'], false);
    pathFinder.trackPath(store, ['right', 'value'], true);
    expect(paths(pathFinder)).toEqual(['right.value']);
  });

  it('preserves deep consolidation for two compact dependencies', () => {
    const store = createBaseStore(() => ({ root: { branch: { first: 1, second: 2 } } }));
    const pathFinder = createPathFinder();

    pathFinder.trackPath(store, ['root', 'branch', 'first'], true);
    pathFinder.trackPath(store, ['root', 'branch', 'second'], true);

    expect(paths(pathFinder, 2)).toEqual(['root.branch']);
    expect(paths(pathFinder, Number.POSITIVE_INFINITY)).toEqual(['root.branch.first', 'root.branch.second']);
  });

  it('promotes a third dependency for one or many stores and resets to compact tracking', () => {
    const first = createBaseStore(() => ({ first: 1, second: 2, third: 3 }));
    const second = createBaseStore(() => ({ fourth: 4 }));
    const pathFinder = createPathFinder();

    pathFinder.trackPath(first, ['first'], true);
    pathFinder.trackPath(first, ['second'], true);
    pathFinder.trackPath(first, ['third'], true);
    pathFinder.trackPath(second, ['fourth'], true);

    const promoted = buildSubscriptions(pathFinder);
    expect(promoted.map(subscription => subscription.store)).toEqual([first, first, first, second]);
    expect(promoted.map(subscription => subscription.path)).toEqual([['first'], ['second'], ['third'], ['fourth']]);
    expect([
      promoted[0].selector(first.getState()),
      promoted[1].selector(first.getState()),
      promoted[2].selector(first.getState()),
      promoted[3].selector(second.getState()),
    ]).toEqual([1, 2, 3, 4]);

    pathFinder.reset();
    pathFinder.trackPath(second, ['fourth'], true);

    const reset = buildSubscriptions(pathFinder);
    expect(reset.map(subscription => subscription.store)).toEqual([second]);
    expect(reset.map(subscription => subscription.path)).toEqual([['fourth']]);
  });

  it('promotes unary edges without confusing path keys with trie state', () => {
    const store = createBaseStore(() => ({}));
    const pathFinder = createPathFinder();

    pathFinder.trackPath(store, ['root', '__proto__'], true);
    pathFinder.trackPath(store, ['root', 'child'], true);
    pathFinder.trackPath(store, ['root', 'child'], true);
    pathFinder.trackPath(store, ['root', 'childKey'], true);
    pathFinder.trackPath(store, ['root', 'children'], true);
    pathFinder.trackPath(store, ['root', 'constructor'], true);

    const subscriptions = buildSubscriptions(pathFinder, Number.POSITIVE_INFINITY);
    expect(subscriptions.map(subscription => subscription.path)).toEqual([
      ['root', '__proto__'],
      ['root', 'child'],
      ['root', 'childKey'],
      ['root', 'children'],
      ['root', 'constructor'],
    ]);
  });

  it('builds a complete snapshot before subscription callbacks run', () => {
    const first = createBaseStore(() => ({ first: 1, second: 2 }));
    const replacement = createBaseStore(() => ({ replacement: 3 }));
    const pathFinder = createPathFinder();
    const trackedPaths: string[][] = [];

    pathFinder.trackPath(first, ['first'], true);
    pathFinder.trackPath(first, ['second'], true);
    pathFinder.buildProxySubscriptions((_store, _selector, path) => {
      trackedPaths.push(path);
      if (trackedPaths.length !== 1) return;
      pathFinder.reset();
      pathFinder.trackPath(replacement, ['replacement'], true);
    }, false);

    expect(trackedPaths).toEqual([['first'], ['second']]);
    expect(buildSubscriptions(pathFinder).map(subscription => subscription.path)).toEqual([['replacement']]);
  });
});
