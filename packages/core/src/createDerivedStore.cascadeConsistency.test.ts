import { flushMicrotasks } from './async.testUtils';
import { createBaseStore } from './createBaseStore';
import { createDerivedStore } from './createDerivedStore';

describe('createDerivedStore cascade consistency', () => {
  it('keeps derived dependency subscriptions alive after an ordinary subscriber unsubscribes', async () => {
    const sourceStore = createBaseStore(() => ({ value: 1 }));
    const parentStore = createDerivedStore($ => $(sourceStore).value);
    const childStore = createDerivedStore($ => $(parentStore) + 1);

    const unsubscribeChild = childStore.subscribe(() => undefined);
    const unsubscribeParent = parentStore.subscribe(() => undefined);

    expect(childStore.getState()).toBe(2);

    unsubscribeParent();
    sourceStore.setState({ value: 2 });
    await flushMicrotasks();

    expect(childStore.getState()).toBe(3);

    unsubscribeChild();
  });

  it('settles a pending cascade when a downstream derived store is read', async () => {
    const sourceStore = createBaseStore(() => ({ value: 'a' }));
    const parentStore = createDerivedStore($ => $(sourceStore).value);
    const childStore = createDerivedStore($ => $(parentStore));

    childStore.subscribe(() => undefined);
    expect(childStore.getState()).toBe('a');

    sourceStore.setState({ value: 'b' });

    expect(childStore.getState()).toBe('b');

    await flushMicrotasks();

    expect(childStore.getState()).toBe('b');
  });

  it('settles a pending cascade before unrelated ordinary listeners observe', async () => {
    const sourceStore = createBaseStore(() => ({ value: 1 }));
    const triggerStore = createBaseStore(() => ({ tick: 0 }));
    const events: string[] = [];

    let deriveCount = 0;
    const doubledStore = createDerivedStore($ => {
      deriveCount += 1;
      return $(sourceStore).value * 2;
    });

    triggerStore.subscribe(() => {
      events.push(`trigger:${doubledStore.getState()}`);
    });
    doubledStore.subscribe((next, prev) => {
      events.push(`derived:${prev}->${next}`);
    });

    expect(doubledStore.getState()).toBe(2);
    expect(deriveCount).toBe(1);

    sourceStore.setState({ value: 2 });
    triggerStore.setState({ tick: 1 });

    expect(events).toEqual(['derived:2->4', 'trigger:4']);
    expect(deriveCount).toBe(2);

    await flushMicrotasks();

    expect(doubledStore.getState()).toBe(4);
    expect(deriveCount).toBe(2);
    expect(events).toEqual(['derived:2->4', 'trigger:4']);
  });

  it('settles cascade work enqueued while deferred listeners are flushing', async () => {
    const triggerSource = createBaseStore(() => ({ value: 'idle' }));
    const nestedSource = createBaseStore(() => ({ value: 'before' }));

    const triggerDerived = createDerivedStore($ => $(triggerSource).value);
    const nestedParent = createDerivedStore($ => $(nestedSource).value);
    const nestedChild = createDerivedStore($ => $(nestedParent));
    const childEvents: string[] = [];

    nestedChild.subscribe((next, prev) => {
      childEvents.push(`${prev}->${next}`);
    });
    triggerDerived.subscribe(next => {
      if (next === 'go') nestedSource.setState({ value: 'after' });
    });

    expect(nestedChild.getState()).toBe('before');

    triggerSource.setState({ value: 'go' });

    await flushMicrotasks();

    expect(nestedChild.getState()).toBe('after');
    expect(childEvents).toEqual(['before->after']);
  });

  it('requeues an ordinary-only derived flush when its listener writes a dependency', async () => {
    const sourceStore = createBaseStore(() => ({ value: 0 }));
    const derivedStore = createDerivedStore($ => $(sourceStore).value);
    const events: string[] = [];

    const unsubscribe = derivedStore.subscribe((next, prev) => {
      events.push(`${prev}->${next}`);
      if (next === 1) sourceStore.setState({ value: 2 });
    });

    try {
      expect(derivedStore.getState()).toBe(0);

      sourceStore.setState({ value: 1 });

      await flushMicrotasks();
      await flushMicrotasks();

      expect(events).toEqual(['0->1', '1->2']);
    } finally {
      unsubscribe();
    }
  });

  it('derives a direct-plus-transitive child once while activating a downstream chain', async () => {
    const sourceStore = createBaseStore(() => ({ value: 1 }));
    let parentDeriveCount = 0;
    let childDeriveCount = 0;
    let grandchildDeriveCount = 0;

    const parentStore = createDerivedStore($ => {
      parentDeriveCount += 1;
      return $(sourceStore, state => state.value) * 2;
    });
    const childStore = createDerivedStore($ => {
      childDeriveCount += 1;
      return $(sourceStore, state => state.value) + $(parentStore, state => state);
    });
    const grandchildStore = createDerivedStore($ => {
      grandchildDeriveCount += 1;
      return $(childStore, state => state);
    });
    const events: number[] = [];

    const unsubscribe = grandchildStore.subscribe(value => {
      events.push(value);
    });

    try {
      expect(grandchildStore.getState()).toBe(3);
      expect(parentDeriveCount).toBe(1);
      expect(childDeriveCount).toBe(1);
      expect(grandchildDeriveCount).toBe(1);

      sourceStore.setState({ value: 2 });

      await flushMicrotasks();

      expect(events).toEqual([6]);
      expect(grandchildStore.getState()).toBe(6);
      expect(parentDeriveCount).toBe(2);
      expect(childDeriveCount).toBe(2);
      expect(grandchildDeriveCount).toBe(2);
    } finally {
      unsubscribe();
    }
  });

  it('reads a fresh transitive parent in a locked dependency graph', async () => {
    const sourceStore = createBaseStore(() => ({ value: 1 }));
    const childInputs: { parent: number; source: number }[] = [];
    let parentDeriveCount = 0;
    let childDeriveCount = 0;

    const parentStore = createDerivedStore(
      $ => {
        parentDeriveCount += 1;
        return $(sourceStore, state => state.value) * 2;
      },
      { lockDependencies: true }
    );
    const childStore = createDerivedStore(
      $ => {
        childDeriveCount += 1;
        const source = $(sourceStore, state => state.value);
        const parent = $(parentStore, state => state);
        childInputs.push({ parent, source });
        return source + parent;
      },
      { lockDependencies: true }
    );
    const grandchildStore = createDerivedStore($ => $(childStore, state => state), { lockDependencies: true });
    const events: number[] = [];

    const unsubscribe = grandchildStore.subscribe(value => {
      events.push(value);
    });

    try {
      expect(grandchildStore.getState()).toBe(3);

      sourceStore.setState({ value: 2 });

      await flushMicrotasks();

      expect(events).toEqual([6]);
      expect(grandchildStore.getState()).toBe(6);
      expect(childInputs).toEqual([
        { parent: 2, source: 1 },
        { parent: 4, source: 2 },
      ]);
      expect(parentDeriveCount).toBe(2);
      expect(childDeriveCount).toBe(2);
    } finally {
      unsubscribe();
    }
  });

  it('settles proxy-derived primitive dependencies before a direct-plus-transitive reader runs', async () => {
    const sourceStore = createBaseStore(() => ({ value: 0 }));
    const sumInputs: number[][] = [];

    const firstStore = createDerivedStore($ => $(sourceStore).value + 1);
    const secondStore = createDerivedStore($ => $(firstStore) + 1);
    const thirdStore = createDerivedStore($ => $(secondStore) + 1);
    const sumStore = createDerivedStore($ => {
      const values = [$(sourceStore).value, $(firstStore), $(secondStore), $(thirdStore)];
      sumInputs.push(values);
      return values[0] + values[1] + values[2] + values[3];
    });
    const observerStore = createDerivedStore($ => $(sumStore));
    const events: number[] = [];

    const unsubscribe = observerStore.subscribe(value => {
      events.push(value);
    });

    try {
      expect(observerStore.getState()).toBe(6);

      sourceStore.setState({ value: 1 });

      await flushMicrotasks();

      expect(events).toEqual([10]);
      expect(observerStore.getState()).toBe(10);
      expect(sumInputs).toEqual([
        [0, 1, 2, 3],
        [1, 2, 3, 4],
      ]);
    } finally {
      unsubscribe();
    }
  });

  it('does not propagate through unchanged proxy-derived primitive output', async () => {
    const sourceStore = createBaseStore(() => ({ value: 0 }));
    let constantDeriveCount = 0;
    let downstreamDeriveCount = 0;

    const firstStore = createDerivedStore($ => $(sourceStore).value);
    const constantStore = createDerivedStore($ => {
      constantDeriveCount += 1;
      $(firstStore);
      return 0;
    });
    const expensiveStore = createDerivedStore($ => {
      downstreamDeriveCount += 1;
      return $(constantStore) + 1;
    });
    const finalStore = createDerivedStore($ => $(expensiveStore) + 5);
    const observerStore = createDerivedStore($ => $(finalStore));
    const events: number[] = [];

    const unsubscribe = observerStore.subscribe(value => {
      events.push(value);
    });

    try {
      expect(observerStore.getState()).toBe(6);

      sourceStore.setState({ value: 1 });

      await flushMicrotasks();

      expect(observerStore.getState()).toBe(6);
      sourceStore.setState({ value: 2 });
      await flushMicrotasks();

      expect(observerStore.getState()).toBe(6);
      expect(events).toEqual([]);
      expect(constantDeriveCount).toBe(3);
      expect(downstreamDeriveCount).toBe(1);
    } finally {
      unsubscribe();
    }
  });

  it('reads fresh dynamic proxy dependencies after deferred cleanup has run', async () => {
    const sourceStore = createBaseStore(() => ({ value: 0 }));
    const doubleStore = createDerivedStore($ => $(sourceStore).value * 2);
    const inverseStore = createDerivedStore($ => -$(sourceStore).value);
    const currentStore = createDerivedStore($ => {
      const source = $(sourceStore).value;
      const selectedStore = source % 2 ? doubleStore : inverseStore;
      return $(selectedStore) + $(selectedStore);
    });
    const unsubscribe = currentStore.subscribe(() => undefined);

    function write(value: number): number {
      sourceStore.setState({ value });
      return currentStore.getState();
    }

    try {
      write(1);
      write(2);

      await flushMicrotasks();

      expect(write(1)).toBe(4);
      expect(write(2)).toBe(-4);
      expect(write(1)).toBe(4);
    } finally {
      unsubscribe();
      currentStore.destroy();
      doubleStore.destroy();
      inverseStore.destroy();
    }
  });

  it('drops stale primitive proxy dependencies after dynamic reads switch', async () => {
    const modeStore = createBaseStore(() => ({ useFirst: true }));
    const firstStore = createBaseStore(() => 1);
    const secondStore = createBaseStore(() => 10);
    const events: number[] = [];
    let deriveCount = 0;

    const currentStore = createDerivedStore($ => {
      deriveCount += 1;
      return $(modeStore).useFirst ? $(firstStore) : $(secondStore);
    });
    const unsubscribe = currentStore.subscribe(value => {
      events.push(value);
    });

    try {
      expect(currentStore.getState()).toBe(1);
      expect(deriveCount).toBe(1);

      modeStore.setState({ useFirst: false });
      await flushMicrotasks();

      expect(currentStore.getState()).toBe(10);
      expect(events).toEqual([10]);
      expect(deriveCount).toBe(2);

      firstStore.setState(2);
      await flushMicrotasks();

      expect(currentStore.getState()).toBe(10);
      expect(events).toEqual([10]);
      expect(deriveCount).toBe(2);

      secondStore.setState(11);
      await flushMicrotasks();

      expect(currentStore.getState()).toBe(11);
      expect(events).toEqual([10, 11]);
      expect(deriveCount).toBe(3);
    } finally {
      unsubscribe();
      currentStore.destroy();
    }
  });

  it('keeps a fallback-retained path when a later same-store path is added', async () => {
    const modeStore = createBaseStore(() => ({ usePair: false }));
    const firstStore = createBaseStore(() => ({ value: 1 }));
    const pairStore = createBaseStore(() => ({ left: 10, right: 100 }));
    const events: number[] = [];

    const currentStore = createDerivedStore($ => {
      const usePair = $(modeStore).usePair;
      const pair = $(pairStore);
      return usePair ? pair.left + pair.right : $(firstStore).value + pair.left;
    });
    const unsubscribe = currentStore.subscribe(value => {
      events.push(value);
    });

    try {
      expect(currentStore.getState()).toBe(11);

      modeStore.setState({ usePair: true });
      await flushMicrotasks();

      expect(currentStore.getState()).toBe(110);
      expect(events).toEqual([110]);

      pairStore.setState({ left: 11, right: 100 });
      await flushMicrotasks();

      expect(currentStore.getState()).toBe(111);
      expect(events).toEqual([110, 111]);
    } finally {
      unsubscribe();
      currentStore.destroy();
    }
  });

  it('settles reentrant cascade work before same-source ordinary listeners observe', async () => {
    const triggerSource = createBaseStore(() => ({ value: 'idle' }));
    const nestedSource = createBaseStore(() => ({ value: 'before' }));

    const triggerDerived = createDerivedStore($ => $(triggerSource).value);
    const nestedParent = createDerivedStore($ => $(nestedSource).value);
    const nestedChild = createDerivedStore($ => $(nestedParent));
    const observations: string[] = [];

    nestedChild.subscribe(() => undefined);
    nestedSource.subscribe(() => {
      observations.push(nestedChild.getState());
    });
    triggerDerived.subscribe(next => {
      if (next === 'go') nestedSource.setState({ value: 'after' });
    });

    expect(nestedChild.getState()).toBe('before');

    triggerSource.setState({ value: 'go' });

    await flushMicrotasks();

    expect(observations).toEqual(['after']);
  });

  it('settles reentrant cascade work before a deferred listener reads downstream state', async () => {
    const triggerSource = createBaseStore(() => ({ value: 'idle' }));
    const nestedSource = createBaseStore(() => ({ value: 'before' }));

    const triggerDerived = createDerivedStore($ => $(triggerSource).value);
    const nestedParent = createDerivedStore($ => $(nestedSource).value);
    const nestedChild = createDerivedStore($ => $(nestedParent));
    const observations: string[] = [];

    nestedChild.subscribe(() => undefined);
    triggerDerived.subscribe(next => {
      if (next === 'go') {
        nestedSource.setState({ value: 'after' });
        observations.push(nestedChild.getState());
      }
    });

    expect(nestedChild.getState()).toBe('before');

    triggerSource.setState({ value: 'go' });

    await flushMicrotasks();

    expect(observations).toEqual(['after']);
  });
});
