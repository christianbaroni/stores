import { flushMicrotasks } from '../../async.testUtils';
import { createBaseStore } from '../../createBaseStore';
import { createDerivedStore } from '../../createDerivedStore';
import type { StoreApi } from '../../store/types';
import { getOrCreateProxy } from './deriveProxy';
import { createPathFinder } from './pathFinder';

function collectTrackedPaths<State>(store: StoreApi<State>, read: (state: State) => void): string[][] {
  const pathFinder = createPathFinder();
  const state = getOrCreateProxy(store, store.getState(), new WeakMap(), pathFinder.trackPath);
  const paths: string[][] = [];

  read(state);
  pathFinder.buildProxySubscriptions((_store, _selector, path) => paths.push(path), false);

  return paths;
}

function expectDefined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected value to be defined');
  return value;
}

describe('derive proxy stripping', () => {
  it('strips a directly escaped root tracking proxy from derived output', async () => {
    const sourceStore = createBaseStore(() => ({
      count: 1,
    }));

    const useDerived = createDerivedStore($ => {
      const source = $(sourceStore);
      return { source };
    });

    const unsubscribe = useDerived.subscribe(() => {});
    await flushMicrotasks();

    expect(useDerived.getState().source).toBe(sourceStore.getState());

    unsubscribe();
  });

  it('strips nested escaped tracking proxies after object paths were observed', async () => {
    const profile = { name: 'Alice' };
    const sourceStore = createBaseStore(() => ({
      count: 1,
      profile,
    }));

    const useDerived = createDerivedStore($ => {
      const source = $(sourceStore);
      return {
        nested: {
          source,
        },
        profile: source.profile,
      };
    });

    const unsubscribe = useDerived.subscribe(() => {});
    await flushMicrotasks();

    const state = useDerived.getState();
    expect(state.nested.source).toBe(sourceStore.getState());
    expect(state.profile).toBe(profile);

    unsubscribe();
  });

  it('does not wrap returned containers while stripping nested tracking proxies', async () => {
    const profile = { name: 'Alice' };
    const sourceStore = createBaseStore(() => ({
      count: 1,
      profile,
    }));

    type PublishedState = {
      nested: {
        source: ReturnType<typeof sourceStore.getState>;
      };
      profile: typeof profile;
    };

    let returnedState: PublishedState | undefined;
    const useDerived = createDerivedStore($ => {
      const source = $(sourceStore);
      const nextState = {
        nested: {
          source,
        },
        profile: source.profile,
      };

      returnedState = nextState;
      return nextState;
    });

    const unsubscribe = useDerived.subscribe(() => {});
    await flushMicrotasks();

    const state = useDerived.getState();
    const returned = expectDefined(returnedState);
    expect(state).toBe(returned);
    expect(state.nested).toBe(returned.nested);
    expect(state.nested.source).toBe(sourceStore.getState());
    expect(state.profile).toBe(profile);

    unsubscribe();
  });

  it('does not use has traps to identify tracking proxies during stripping', async () => {
    const sourceStore = createBaseStore(() => ({
      count: 1,
    }));

    let hasReads = 0;
    const foreignProxy = new Proxy(new Date('2026-05-18T00:00:00.000Z'), {
      has(target, key) {
        hasReads += 1;
        return Reflect.has(target, key);
      },
    });

    const useDerived = createDerivedStore($ => {
      void $(sourceStore).count;
      return { foreignProxy };
    });

    const unsubscribe = useDerived.subscribe(() => {});
    await flushMicrotasks();

    expect(useDerived.getState().foreignProxy).toBe(foreignProxy);
    expect(hasReads).toBe(0);

    unsubscribe();
  });
});

describe('derive proxy array tracking', () => {
  it('tracks a direct array item read at the array path and returns the raw item', () => {
    const row = { value: 1 };
    const sourceStore = createBaseStore(() => ({ rows: [row] }));
    const pathFinder = createPathFinder();
    const state = getOrCreateProxy(sourceStore, sourceStore.getState(), new WeakMap(), pathFinder.trackPath);
    const paths: string[][] = [];

    expect(state.rows[0]).toBe(row);
    pathFinder.buildProxySubscriptions((_store, _selector, path) => paths.push(path), false);

    expect(paths).toEqual([['rows']]);
  });

  it('keeps array length reads granular', () => {
    const sourceStore = createBaseStore(() => ({ rows: [{ value: 1 }] }));

    const paths = collectTrackedPaths(sourceStore, state => {
      void state.rows.length;
    });

    expect(paths).toEqual([['rows', 'length']]);
  });

  it('does not treat non-canonical numeric properties as array indexes', () => {
    const rows = [{ value: 1 }];
    Object.defineProperty(rows, '01', { value: 'custom' });
    const sourceStore = createBaseStore(() => ({ rows }));

    const paths = collectTrackedPaths(sourceStore, state => {
      void Reflect.get(state.rows, '01');
    });

    expect(paths).toEqual([['rows', '01']]);
  });

  it('retains one array dependency for a large indexed traversal', () => {
    const rows = Array.from({ length: 1_000 }, (_, value) => ({ value }));
    const sourceStore = createBaseStore(() => ({ rows }));

    const paths = collectTrackedPaths(sourceStore, state => {
      const trackedRows = state.rows;
      for (let i = 0; i < trackedRows.length; i++) void trackedRows[i].value;
    });

    expect(paths).toEqual([['rows']]);
  });

  it('re-derives an indexed read when the array identity changes', async () => {
    const firstRow = { value: 1 };
    const sourceStore = createBaseStore(() => ({
      rows: [firstRow, { value: 2 }],
      unrelated: 0,
    }));
    let deriveCount = 0;
    const derived = createDerivedStore($ => {
      deriveCount += 1;
      return $(sourceStore).rows[0].value;
    });
    const unsubscribe = derived.subscribe(() => {});
    await flushMicrotasks();

    sourceStore.setState({ rows: [firstRow, { value: 3 }] });
    await flushMicrotasks();
    expect(deriveCount).toBe(2);

    sourceStore.setState({ unrelated: 1 });
    await flushMicrotasks();
    expect(deriveCount).toBe(2);

    unsubscribe();
  });
});
