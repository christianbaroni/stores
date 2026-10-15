import { createDerivedStore } from './createDerivedStore';
import { createVirtualStore } from './createVirtualStore';
import { destroyStore } from './internal/storeUtils';
import { flushMicrotasks } from './async.testUtils';
import { createBaseStore } from './createBaseStore';
import { derivedStore } from './internal/derivedStore';
import { createSelection, subscribeSelection } from './internal/selectorSubscription';
import type { SubscribeArgs } from './types';
import type { InternalSubscribeOptions } from './internal/internalSubscriptions';

function createTrackedSource() {
  const source = createBaseStore(() => ({ value: 1 }));
  const subscribe = source.subscribe;
  const subscriptions = new Set<() => void>();
  source.subscribe = (...args: SubscribeArgs<{ value: number }>) => {
    const unsubscribe = args.length === 1 ? subscribe(args[0]) : subscribe(args[0], args[1], args[2]);
    const cleanup = () => {
      subscriptions.delete(cleanup);
      unsubscribe();
    };
    subscriptions.add(cleanup);
    return cleanup;
  };

  return { source, subscriptions };
}

describe('derived selector subscriptions', () => {
  it('releases dependencies after quiet subscription setup fails and allows another subscription', async () => {
    const { source, subscriptions } = createTrackedSource();
    let failing = true;
    const store = derivedStore($ => {
      const value = $(source, state => state.value);
      if (failing) throw new Error('admission failed');
      return value;
    });

    try {
      const listener = vi.fn();
      const selection = createSelection<number>(listener);
      expect(() => subscribeSelection(store, state => state, { selection }, true)).toThrow('admission failed');

      await flushMicrotasks(4);
      expect(subscriptions.size).toBe(0);

      failing = false;
      const unsubscribe = subscribeSelection(store, state => state, { selection }, true);
      selection.refresh();
      expect(selection.currentSlice).toBe(1);

      source.setState({ value: 2 });
      await flushMicrotasks(4);
      expect(listener.mock.calls).toEqual([[2, 1]]);

      unsubscribe();
      await flushMicrotasks(4);
      expect(subscriptions.size).toBe(0);
    } finally {
      store.destroy();
    }
  });

  it('attaches a shared selection without temporary cleanup and removes its cascade listener', async () => {
    const { source, subscriptions } = createTrackedSource();
    const store = derivedStore($ => $(source, state => state.value));
    const listener = vi.fn();
    const selection = createSelection<number>(listener, { isCascadeParticipant: true });
    const queueMicrotask = vi.spyOn(globalThis, 'queueMicrotask');

    try {
      const unsubscribe = subscribeSelection(store, state => state, { selection, isCascadeParticipant: true });
      expect(queueMicrotask).not.toHaveBeenCalled();

      source.setState({ value: 2 });
      await flushMicrotasks(4);
      expect(listener.mock.calls).toEqual([[2, 1]]);

      unsubscribe();
      await flushMicrotasks(4);
      expect(subscriptions.size).toBe(0);

      source.setState({ value: 3 });
      await flushMicrotasks(4);
      expect(listener.mock.calls).toEqual([[2, 1]]);
    } finally {
      queueMicrotask.mockRestore();
      store.destroy();
    }
  });

  it.each([false, true])('does not queue temporary-read cleanup when attaching a selector subscription (cascade: %s)', async cascade => {
    const { source, subscriptions } = createTrackedSource();
    const store = derivedStore($ => $(source, state => state.value));
    const options: InternalSubscribeOptions<number> = { isCascadeParticipant: cascade };
    const queueMicrotask = vi.spyOn(globalThis, 'queueMicrotask');

    try {
      const unsubscribe = store.subscribe(
        state => state,
        () => {},
        options
      );
      expect(queueMicrotask).not.toHaveBeenCalled();

      await flushMicrotasks(4);
      expect(subscriptions.size).toBe(1);

      unsubscribe();
      await flushMicrotasks(4);
      expect(subscriptions.size).toBe(0);
    } finally {
      queueMicrotask.mockRestore();
      store.destroy();
    }
  });

  it.each([false, true])(
    'keeps dependencies attached when initial selection removes the last other subscriber (cascade: %s)',
    async cascade => {
      const source = createBaseStore(() => 1);
      const store = derivedStore($ => $(source));

      try {
        const options: InternalSubscribeOptions<number> = { isCascadeParticipant: cascade };
        const unsubscribeExisting = store.subscribe(
          state => state,
          () => {}
        );
        const events: [number, number][] = [];
        const unsubscribe = store.subscribe(
          state => {
            unsubscribeExisting();
            return state;
          },
          (current, previous) => events.push([current, previous]),
          options
        );
        await flushMicrotasks(4);
        source.setState(2);
        await flushMicrotasks(4);
        unsubscribe();
        expect(events).toEqual([[2, 1]]);
      } finally {
        store.destroy();
      }
    }
  );

  it.each(['derive', 'selector'] as const)(
    'releases dependencies after %s throws during subscription and allows another subscription',
    async failure => {
      const { source, subscriptions } = createTrackedSource();
      let failing = true;
      const store = derivedStore($ => {
        const value = $(source, state => state.value);
        if (failing && failure === 'derive') throw new Error('admission failed');
        return value;
      });

      try {
        const selector = (state: number) => {
          if (failing && failure === 'selector') throw new Error('admission failed');
          return state;
        };
        expect(() => store.subscribe(selector, () => {})).toThrow('admission failed');

        await flushMicrotasks(4);
        expect(subscriptions.size).toBe(0);

        failing = false;
        const events: [number, number][] = [];
        const unsubscribe = store.subscribe(selector, (current, previous) => events.push([current, previous]));
        source.setState({ value: 2 });
        await flushMicrotasks(4);
        unsubscribe();
        await flushMicrotasks(4);
        expect(events).toEqual([[2, 1]]);
        expect(subscriptions.size).toBe(0);
      } finally {
        store.destroy();
      }
    }
  );

  it.each([false, true])('preserves a nested subscriber when the outer selector throws (cascade: %s)', async cascade => {
    const { source, subscriptions } = createTrackedSource();
    const store = derivedStore($ => $(source, state => state.value));

    try {
      const events: [number, number][] = [];
      const options: InternalSubscribeOptions<number> = { isCascadeParticipant: cascade };
      let unsubscribe = () => {};
      expect(() =>
        store.subscribe(
          () => {
            unsubscribe = store.subscribe(
              state => state,
              (current, previous) => events.push([current, previous])
            );
            throw new Error('outer admission failed');
          },
          () => {},
          options
        )
      ).toThrow('outer admission failed');

      await flushMicrotasks(4);
      expect(subscriptions.size).toBe(1);

      source.setState({ value: 2 });
      await flushMicrotasks(4);
      unsubscribe();
      await flushMicrotasks(4);
      expect(events).toEqual([[2, 1]]);
      expect(subscriptions.size).toBe(0);
    } finally {
      store.destroy();
    }
  });
  it.each([
    ['direct', 'none'],
    ['direct', 'raw'],
    ['direct', 'selected'],
    ['virtual', 'none'],
    ['virtual', 'raw'],
    ['virtual', 'selected'],
  ] as const)('delivers a source correction made from an immediate %s subscription with a %s source consumer', async (kind, consumer) => {
    const source = createBaseStore(() => ({ selectedId: 0 }));
    const selection = createDerivedStore($ => $(source).selectedId);
    const store = kind === 'virtual' ? createVirtualStore(() => selection) : selection;
    const sourceChanges: number[] = [];
    const unsubscribeSource =
      consumer === 'raw'
        ? source.subscribe(state => sourceChanges.push(state.selectedId))
        : consumer === 'selected'
          ? source.subscribe(
              state => state.selectedId,
              id => sourceChanges.push(id)
            )
          : () => {};
    const changes: [number, number][] = [];
    const unsubscribe = store.subscribe(
      value => value,
      (current, previous) => {
        changes.push([current, previous]);
        if (current === 0) source.setState({ selectedId: 1 });
      },
      { fireImmediately: true }
    );

    try {
      await flushMicrotasks();
      expect(store.getState()).toBe(1);
      expect(sourceChanges).toEqual(consumer === 'none' ? [] : [1]);
      expect(changes).toEqual([
        [0, 0],
        [1, 0],
      ]);

      source.setState({ selectedId: 2 });
      await flushMicrotasks();
      expect(changes).toEqual([
        [0, 0],
        [1, 0],
        [2, 1],
      ]);
    } finally {
      unsubscribe();
      unsubscribeSource();
      destroyStore(store);
      selection.destroy();
    }
  });
});

describe('immediate subscription failure cleanup', () => {
  it.each([
    ['direct', false],
    ['direct', true],
    ['shared', false],
    ['shared', true],
  ] as const)('removes a failed %s listener while preserving existing subscriber=%s', async (kind, hasExisting) => {
    const { source, subscriptions } = createTrackedSource();
    const store = derivedStore($ => $(source, state => state.value));
    const releaseSource = source.subscribe(() => {});
    const existing = vi.fn();
    const unsubscribeExisting = hasExisting ? store.subscribe(state => state, existing) : () => {};
    const error = new Error('initial reaction failed');
    const reaction = vi.fn((value: number) => {
      if (value === 1) {
        source.setState({ value: 2 });
        throw error;
      }
    });

    try {
      expect(() => {
        if (kind === 'direct') store.subscribe(state => state, reaction, { fireImmediately: true });
        else subscribeSelection(store, state => state, { selection: createSelection(reaction), fireImmediately: true });
      }).toThrow(error);
      await flushMicrotasks(4);
      expect(subscriptions.size).toBe(hasExisting ? 2 : 1);
      const callsAfterFailure = reaction.mock.calls.length;

      source.setState({ value: 3 });
      await flushMicrotasks(4);
      expect(reaction).toHaveBeenCalledTimes(callsAfterFailure);
      if (hasExisting)
        expect(existing.mock.calls).toEqual([
          [2, 1],
          [3, 2],
        ]);

      unsubscribeExisting();
      await flushMicrotasks(4);
      expect(subscriptions.size).toBe(1);
    } finally {
      unsubscribeExisting();
      releaseSource();
      store.destroy();
    }
  });
});
