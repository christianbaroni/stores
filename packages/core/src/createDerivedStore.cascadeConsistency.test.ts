import { flushMicrotasks } from './async.testUtils';
import { createBaseStore } from './createBaseStore';
import { createDerivedStore } from './createDerivedStore';

describe('createDerivedStore cascade consistency', () => {
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
