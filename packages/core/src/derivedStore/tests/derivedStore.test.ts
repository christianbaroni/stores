/**
 * @jest-environment node
 */

import { createDerivedStore } from '../../createDerivedStore';
import { createQueryStore } from '../../createQueryStore';
import { createBaseStore } from '../../createBaseStore';
import { QueryStatuses } from '../../queryStore/types';
import { SubscribeArgs, SubscribeOverloads } from '../../types';
import { deepEqual } from '../../utils/equality';
import { hasGetSnapshot } from '../../utils/storeUtils';

/**
 * `createDerivedStore` uses `queueMicrotask` to batch updates, so we use
 * this to flush any pending operations before checking for state changes.
 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}

describe('createDerivedStore', () => {
  // ──────────────────────────────────────────────
  // Basic Usage (Single Dependency)
  // ──────────────────────────────────────────────
  describe('Basic Usage (Single Dependency)', () => {
    it('should only notify watchers after the first subscription derivation and on subsequent updates, allowing getState() one-off derivations when unsubscribed', async () => {
      const baseStore = createBaseStore(() => ({
        count: 0,
        text: 'init',
      }));

      let deriveCount = 0;
      const useDerived = createDerivedStore($ => {
        deriveCount += 1;
        return $(baseStore).count * 2;
      });

      // Initially no watchers => no derivation
      expect(deriveCount).toBe(0);

      const watcher = jest.fn();
      const unsubscribe = useDerived.subscribe(watcher);
      await flushMicrotasks();

      // First subscription => one derivation => watchers not notified (prevState=undefined)
      expect(deriveCount).toBe(1);
      expect(watcher).toHaveBeenCalledTimes(0);
      expect(useDerived.getState()).toBe(0);

      // Update count => new derived => watchers see old=0 -> new=6
      baseStore.setState({ count: 3 });
      await flushMicrotasks();

      expect(deriveCount).toBe(2);
      expect(useDerived.getState()).toBe(6);
      expect(watcher).toHaveBeenCalledTimes(1);
      expect(watcher).toHaveBeenLastCalledWith(6, 0);

      // Unsubscribe => watchers=0 => future updates won't notify watchers
      unsubscribe();
      await flushMicrotasks();
      baseStore.setState({ count: 10 });
      await flushMicrotasks();

      // No watchers => no immediate derivation
      expect(deriveCount).toBe(2);

      // But calling getState() triggers a one-off derivation => new value
      expect(useDerived.getState()).toBe(20);
      expect(deriveCount).toBe(3);
    });

    it('should skip notifying watchers if derived output is unchanged by Object.is, but still re-derive if the relevant property changed', async () => {
      const baseStore = createBaseStore(() => ({
        count: 2,
        text: 'hello',
      }));

      let deriveCount = 0;
      const useDerived = createDerivedStore($ => {
        deriveCount += 1;
        const count = $(baseStore).count;
        return count % 2 === 0 ? 'even' : 'odd';
      });

      const watcher = jest.fn();
      const unsubscribe = useDerived.subscribe(watcher);
      await flushMicrotasks();

      // First subscription => watchers=0 calls
      expect(deriveCount).toBe(1);
      expect(watcher).toHaveBeenCalledTimes(0);
      expect(useDerived.getState()).toBe('even');

      // Count: 2 -> 4 => new derived still 'even' => watchers not notified
      baseStore.setState({ count: 4 });
      await flushMicrotasks();

      expect(deriveCount).toBe(2);
      expect(watcher).toHaveBeenCalledTimes(0);

      // 4 -> 5 => becomes 'odd' => watchers see new
      baseStore.setState({ count: 5 });
      await flushMicrotasks();

      expect(deriveCount).toBe(3);
      expect(watcher).toHaveBeenCalledTimes(1);
      expect(useDerived.getState()).toBe('odd');
      expect(watcher).toHaveBeenLastCalledWith('odd', 'even');

      unsubscribe();
    });
  });

  // ──────────────────────────────────────────────
  // Proxy-Based Subscription
  // ──────────────────────────────────────────────
  describe('Proxy-Based Subscription', () => {
    it('should not trigger watchers when reassigning an identical nested value, but should when that nested value actually changes', async () => {
      const baseStore = createBaseStore(() => ({
        user: {
          name: 'Alice',
          profile: { email: 'alice@example.com' },
        },
        unused: 123,
      }));

      let deriveCount = 0;
      const useDerived = createDerivedStore($ => {
        deriveCount += 1;
        return $(baseStore).user.profile.email;
      });

      const watcher = jest.fn();
      const unsubscribe = useDerived.subscribe(watcher);
      await flushMicrotasks();

      // First derive => watchers=0
      expect(deriveCount).toBe(1);
      expect(watcher).toHaveBeenCalledTimes(0);

      // Replace user object with same final email => watchers skip
      baseStore.setState({
        user: {
          name: 'Alice',
          profile: { email: 'alice@example.com' },
        },
        unused: 999,
      });
      await flushMicrotasks();

      expect(deriveCount).toBe(1);
      expect(watcher).toHaveBeenCalledTimes(0);

      // Now actually change the email => watchers see old -> new
      baseStore.setState({
        user: {
          name: 'Alice',
          profile: { email: 'newalice@example.com' },
        },
        unused: 999,
      });
      await flushMicrotasks();

      expect(deriveCount).toBe(2);
      expect(watcher).toHaveBeenCalledTimes(1);
      expect(watcher).toHaveBeenLastCalledWith('newalice@example.com', 'alice@example.com');

      unsubscribe();
    });

    it('[selectors] should only notify watchers when the directly tracked property changes, ignoring other property or object reference updates', async () => {
      const baseStore = createBaseStore(() => ({
        data: { key1: 10, key2: 20 },
      }));

      let deriveCount = 0;
      const useDerived = createDerivedStore($ => {
        deriveCount += 1;
        return $(baseStore, s => s.data.key1);
      });

      const watcher = jest.fn();
      const unsubscribe = useDerived.subscribe(watcher);
      await flushMicrotasks();

      // First derive => watchers=0
      expect(deriveCount).toBe(1);
      expect(watcher).toHaveBeenCalledTimes(0);

      // Set data with same key1 => should skip re-derivation
      baseStore.setState({ data: { key1: 10, key2: 999 } });
      await flushMicrotasks();

      expect(deriveCount).toBe(1);
      expect(watcher).toHaveBeenCalledTimes(0);

      // Now actually change key1 => watchers see new
      baseStore.setState({ data: { key1: 11, key2: 999 } });
      await flushMicrotasks();

      expect(deriveCount).toBe(2);
      expect(watcher).toHaveBeenCalledTimes(1);
      expect(watcher).toHaveBeenLastCalledWith(11, 10);

      unsubscribe();
    });
  });

  // ──────────────────────────────────────────────
  // Equality Function (Store-Level)
  // ──────────────────────────────────────────────
  describe('Equality Function (Store-Level)', () => {
    it('should re-derive on the same input but skip watcher notifications if eqFn deems no difference, then notify on real changes', async () => {
      const baseStore = createBaseStore(() => ({ name: 'Alice', age: 30 }));

      let deriveCount = 0;
      const useDerived = createDerivedStore(
        $ => {
          deriveCount += 1;
          const { name, age } = $(baseStore);
          return { name, age };
        },
        { equalityFn: deepEqual }
      );

      let nameTracker = '';
      let ageTracker = 0;
      let watcherCalls = 0;

      const unsubscribe = useDerived.subscribe(newVal => {
        nameTracker = newVal.name;
        ageTracker = newVal.age;
        watcherCalls += 1;
      });
      await flushMicrotasks();

      // first derive => watchers=0
      expect(deriveCount).toBe(1);
      expect(watcherCalls).toBe(0);

      // set name => watchers see change
      baseStore.setState({ name: 'Bob' });
      await flushMicrotasks();

      expect(deriveCount).toBe(2);
      expect(watcherCalls).toBe(1);
      expect(nameTracker).toBe('Bob');
      expect(ageTracker).toBe(30);

      // set same name again => should not re-derive
      baseStore.setState({ name: 'Bob' });
      await flushMicrotasks();

      expect(deriveCount).toBe(2);
      expect(watcherCalls).toBe(1);

      // now set new age => watchers see new
      baseStore.setState({ age: 31 });
      await flushMicrotasks();

      expect(deriveCount).toBe(3);
      expect(watcherCalls).toBe(2);
      expect(ageTracker).toBe(31);

      unsubscribe();
    });
  });

  // ──────────────────────────────────────────────
  // Rapid Update Batching
  // ──────────────────────────────────────────────
  describe('Rapid Update Batching', () => {
    it('should batch rapid updates', async () => {
      const baseStore = createBaseStore(() => ({ val: 0 }));
      const secondStore = createBaseStore(() => ({ val: 0 }));

      let deriveCount = 0;
      let lastValue = 0;
      const useDerived = createDerivedStore($ => {
        deriveCount += 1;
        const value = $(baseStore).val * $(secondStore).val;
        lastValue = value;
        return value;
      });

      const watcher = jest.fn();
      const unsubscribe = useDerived.subscribe(watcher);

      // First derivation => watchers=0
      expect(deriveCount).toBe(1);
      expect(watcher).toHaveBeenCalledTimes(0);
      expect(useDerived.getState()).toBe(0);

      // Update both stores multiple times
      baseStore.setState({ val: 1 });
      secondStore.setState({ val: 2 });
      baseStore.setState({ val: 3 });
      secondStore.setState({ val: 4 });
      await flushMicrotasks();

      // Should have batched updates into a single derivation and called the watcher once
      expect(deriveCount).toBe(2);
      expect(watcher).toHaveBeenCalledTimes(1);
      expect(lastValue).toBe(baseStore.getState().val * secondStore.getState().val);

      unsubscribe();
    });
  });

  // ──────────────────────────────────────────────
  // Synchronous Derivation Chains and Primitives
  // ──────────────────────────────────────────────
  describe('Synchronous Derivation Chains and Primitives', () => {
    it('should derive synchronously when a derived store dependency chain exists, and handle primitive and nullish store states as leaves', async () => {
      const baseStore = createBaseStore<number | undefined>(() => undefined);
      const secondStore = createBaseStore(() => 0);

      let totalIntermediaryDerives = 0;

      const baseDerivedStore = createDerivedStore($ => {
        totalIntermediaryDerives += 1;
        return $(baseStore);
      });
      const secondDerivedStore = createDerivedStore($ => {
        totalIntermediaryDerives += 1;
        return $(secondStore);
      });

      let deriveCount = 0;
      let lastValue = 0;
      const useDerived = createDerivedStore($ => {
        deriveCount += 1;
        const value = ($(baseDerivedStore) ?? 0) * ($(secondDerivedStore) ?? 0);
        lastValue = value;
        return value;
      });

      let watcherCalls = 0;
      const unsubscribe = useDerived.subscribe(
        state => state,
        () => (watcherCalls += 1)
      );

      // First derivation => watchers=0
      expect(deriveCount).toBe(1);
      expect(totalIntermediaryDerives / 2).toBe(1);
      expect(watcherCalls).toBe(0);
      expect(useDerived.getState()).toBe(0);

      // Update the derivation chain four times
      baseStore.setState(1);
      secondStore.setState(2);
      baseStore.setState(3);
      secondStore.setState(4);
      await flushMicrotasks();

      // Should have resulted in two useDerivedStore derivations
      expect(deriveCount).toBe(2);

      // And two additional derivations for each pass-through derived store
      expect(totalIntermediaryDerives / 2).toBe(2);

      // But only a single watcher call
      expect(watcherCalls).toBe(1);

      // With the derivation chain in sync
      expect(lastValue).toBe((baseStore.getState() ?? 0) * (secondStore.getState() ?? 0));
      expect(lastValue).toBe((baseDerivedStore.getState() ?? 0) * (secondDerivedStore.getState() ?? 0));

      unsubscribe();
    });
  });

  // ──────────────────────────────────────────────
  // Debounce Option
  // ──────────────────────────────────────────────
  describe('Debounce Option', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('should batch multiple updates within a debounce window and notify watchers with the final derived value', async () => {
      const baseStore = createBaseStore(() => ({ val: 0 }));

      let deriveCount = 0;
      const useDerived = createDerivedStore(
        $ => {
          deriveCount += 1;
          return $(baseStore).val;
        },
        { debounce: 50 }
      );

      const watcher = jest.fn();
      const unsubscribe = useDerived.subscribe(watcher);

      // First derivation => watchers=0
      await flushMicrotasks();
      expect(deriveCount).toBe(1);
      expect(watcher).toHaveBeenCalledTimes(0);

      // Multiple updates quickly
      baseStore.setState({ val: 1 });
      baseStore.setState({ val: 2 });
      baseStore.setState({ val: 3 });
      await flushMicrotasks();

      // No immediate re-derive, still within debounce
      jest.advanceTimersByTime(50);
      await flushMicrotasks();

      // Single final re-derive => watchers=1
      expect(deriveCount).toBe(2);
      expect(watcher).toHaveBeenCalledTimes(1);
      expect(useDerived.getState()).toBe(3);

      unsubscribe();
    });

    it('should flush pending updates immediately when flushUpdates() is called', async () => {
      const baseStore = createBaseStore(() => ({ val: 10 }));

      let deriveCount = 0;
      let watcherCallCount = 0;
      let lastVal = 0;

      const useDerived = createDerivedStore(
        $ => {
          deriveCount += 1;
          return $(baseStore).val * 2;
        },
        { debounce: 100 }
      );

      const unsubscribe = useDerived.subscribe(val => {
        lastVal = val;
        watcherCallCount += 1;
      });

      // First derivation => watchers=0 calls
      await flushMicrotasks();
      expect(deriveCount).toBe(1);
      expect(watcherCallCount).toBe(0);
      expect(useDerived.getState()).toBe(20);

      // Update, queued by debounce
      baseStore.setState({ val: 15 });
      await flushMicrotasks();
      expect(deriveCount).toBe(1);

      // Flush => immediate re-derive => watchers see new
      useDerived.flushUpdates();
      await flushMicrotasks();

      expect(deriveCount).toBe(2);
      expect(watcherCallCount).toBe(1);
      expect(lastVal).toBe(30);

      unsubscribe();
    });
  });

  // ──────────────────────────────────────────────
  // Fast Mode
  // ──────────────────────────────────────────────
  describe('Fast Mode', () => {
    it('should not rebuild subscriptions on each re-derive', async () => {
      const baseStore = createBaseStore(() => ({ count: 0 }));

      const secondStore = createBaseStore<{ nested: { multiplier: number }; inc: () => void }>(set => ({
        nested: { multiplier: 1 },
        inc() {
          set(state => ({ nested: { multiplier: state.nested.multiplier * 10 } }));
        },
      }));

      type BaseState = ReturnType<typeof baseStore.getState>;

      let subscriptionCount = 0;
      const originalSubscribe: SubscribeOverloads<BaseState> = baseStore.subscribe.bind(baseStore);
      baseStore.subscribe = (...args: SubscribeArgs<BaseState>) => {
        subscriptionCount += 1;
        if (args.length === 1) {
          const listener = args[0];
          return originalSubscribe(listener);
        } else {
          const [selector, listener, options] = args;
          return originalSubscribe(selector, listener, options);
        }
      };

      let deriveCount = 0;
      const useDerived = createDerivedStore(
        $ => {
          deriveCount += 1;
          const value = $(baseStore).count * $(secondStore).nested.multiplier;
          return value;
        },
        { lockDependencies: true }
      );

      // No watchers => no derivation yet
      expect(deriveCount).toBe(0);

      // Subscribe => trigger first derivation
      const unsubscribe = useDerived.subscribe(() => {
        return;
      });
      await flushMicrotasks();

      expect(subscriptionCount).toBe(1);
      expect(deriveCount).toBe(1);

      // Update a dependency => second derivation
      secondStore.getState().inc();
      await flushMicrotasks();

      // Subscription count should still be 1
      expect(subscriptionCount).toBe(1);
      // Derive count should be 2
      expect(deriveCount).toBe(2);

      unsubscribe();
    });
  });

  // ──────────────────────────────────────────────
  // Subscribe and Unsubscribe Behavior
  // ──────────────────────────────────────────────
  describe('Subscribe and Unsubscribe Behavior', () => {
    it('should not update watchers after destroy, but allow a one-off re-derive if getState() is called post-destroy', async () => {
      const baseStore = createBaseStore(() => ({ val: 0 }));
      let deriveCount = 0;

      const useDerived = createDerivedStore($ => {
        deriveCount += 1;
        return $(baseStore).val + 1;
      });

      let callCount = 0;
      let lastValue = 0;
      const unsubscribe = useDerived.subscribe(val => {
        lastValue = val;
        callCount += 1;
      });
      await flushMicrotasks();

      // First derivation => watchers=0
      expect(deriveCount).toBe(1);
      expect(callCount).toBe(0);

      // Update base => watchers=1
      baseStore.setState({ val: 10 });
      await flushMicrotasks();

      expect(deriveCount).toBe(2);
      expect(callCount).toBe(1);
      expect(lastValue).toBe(11);

      // destroy => no watchers remain
      useDerived.destroy();
      baseStore.setState({ val: 20 });
      await flushMicrotasks();

      // watchers not called
      expect(callCount).toBe(1);
      expect(deriveCount).toBe(2);

      // But if we do getState => a one-off re-derive => no watchers
      const finalValue = useDerived.getState();
      expect(finalValue).toBe(21);
      expect(deriveCount).toBe(3);

      unsubscribe();
    });

    it('should stop subscription updates after destroy() is called', async () => {
      const baseStore = createBaseStore(() => ({ val: 0 }));
      let deriveCount = 0;

      const useDerived = createDerivedStore($ => {
        deriveCount += 1;
        return $(baseStore).val + 1;
      });

      let callCount = 0;
      let lastValue = 0;
      const unsubscribe = useDerived.subscribe(val => {
        lastValue = val;
        callCount += 1;
      });
      await flushMicrotasks();

      // First derive => watchers=0
      expect(deriveCount).toBe(1);
      expect(callCount).toBe(0);
      expect(useDerived.getState()).toBe(1);

      // Update => watchers see new
      baseStore.setState({ val: 10 });
      await flushMicrotasks();

      expect(deriveCount).toBe(2);
      expect(callCount).toBe(1);
      expect(lastValue).toBe(11);

      // destroy => watchers unsubscribed
      useDerived.destroy();

      // Another update => no watchers
      baseStore.setState({ val: 20 });
      await flushMicrotasks();

      // If we call getState => a one-off derivation occurs
      expect(useDerived.getState()).toBe(21);
      expect(deriveCount).toBe(3);

      // But watchers remain at 1 call
      expect(callCount).toBe(1);

      unsubscribe();
    });
  });

  // ──────────────────────────────────────────────
  // Subscribe with Slice Listeners
  // ──────────────────────────────────────────────
  describe('Subscribe with Slice Listeners', () => {
    it('should only notify slice listeners for changes in the relevant slice, ignoring the first derivation unless fireImmediately', async () => {
      const baseStore = createBaseStore(() => ({ foo: 1, bar: 2 }));

      const useDerived = createDerivedStore($ => {
        const { foo, bar } = $(baseStore);
        return {
          sum: foo + bar,
          product: foo * bar,
        };
      });

      let sumCalls = 0;
      let lastSum = 0;
      const unsubSum = useDerived.subscribe(
        s => s.sum,
        newSum => {
          lastSum = newSum;
          sumCalls += 1;
        }
      );
      await flushMicrotasks();

      // No immediate call => watchers=0 for the sum slice
      expect(sumCalls).toBe(0);
      expect(useDerived.getState()).toEqual({ sum: 3, product: 2 });

      let prodCalls = 0;
      let lastProd = 0;
      const unsubProd = useDerived.subscribe(
        s => s.product,
        newProduct => {
          lastProd = newProduct;
          prodCalls += 1;
        },
        { fireImmediately: true }
      );
      // fireImmediately => 1 call with (2,2)
      expect(prodCalls).toBe(1);
      expect(lastProd).toBe(2);

      // Update foo => sum=4 => product=4 => watchers see old -> new
      baseStore.setState({ foo: 2, bar: 2 });
      await flushMicrotasks();

      expect(sumCalls).toBe(1);
      expect(lastSum).toBe(4);
      expect(prodCalls).toBe(2);
      expect(lastProd).toBe(4);

      // Updating foo with the same value => no calls
      baseStore.setState({ foo: 2, bar: 2 });
      await flushMicrotasks();

      expect(sumCalls).toBe(1);
      expect(prodCalls).toBe(2);

      unsubSum();
      unsubProd();
    });
  });

  // ──────────────────────────────────────────────
  // Usage with createQueryStore
  // ──────────────────────────────────────────────
  describe('Usage with createQueryStore', () => {
    it('should derive from the query store and only notify watchers if the final derived output changes', async () => {
      const fetcher = jest.fn(async () => 'some-data');
      const queryStore = createQueryStore<string>({ fetcher });

      let deriveCount = 0;
      const useDerived = createDerivedStore($ => {
        deriveCount += 1;
        const { getData, status } = $(queryStore);
        return { data: getData(), status };
      });

      const watcher = jest.fn();
      const unsubscribe = useDerived.subscribe(watcher);

      // First derive => watchers=0
      expect(deriveCount).toBe(1);
      expect(watcher).toHaveBeenCalledTimes(0);
      expect(useDerived.getState()).toEqual({ status: QueryStatuses.Idle, data: null });

      // Perform a fetch => might transition Idle -> Fetching -> Success => watchers see new final
      await queryStore.getState().fetch();
      expect(deriveCount).toBe(2);
      expect(watcher).not.toHaveBeenCalledTimes(0); // Watchers got at least one call

      const final = useDerived.getState();
      expect(final.status).toBe(QueryStatuses.Success);
      expect(final.data).toBe('some-data');

      // A second fetch with the same data => final derived is unchanged => watchers skip
      const oldWatcherCalls = watcher.mock.calls.length;
      await queryStore.getState().fetch();
      const nextFinal = useDerived.getState();
      expect(nextFinal.data).toBe('some-data');
      expect(watcher.mock.calls.length).toBe(oldWatcherCalls);

      unsubscribe();
    });
  });

  // ──────────────────────────────────────────────
  // Derivation Modes: Component vs Derived vs Mixed
  // ──────────────────────────────────────────────
  describe('Derivation Modes', () => {
    describe('Pure Component Mode (no derived watchers)', () => {
      it('should batch multiple synchronous updates via microtask when only component watchers exist', async () => {
        const baseStore = createBaseStore(() => ({ val: 0 }));

        let deriveCount = 0;
        const useDerived = createDerivedStore($ => {
          deriveCount += 1;
          return $(baseStore).val * 2;
        });

        // Simulate React component subscription via useSyncExternalStore (selector-based)
        const watcher = jest.fn();
        const unsubscribe = useDerived.subscribe(s => s, watcher);
        if (hasGetSnapshot(useDerived)) {
          useDerived.getSnapshot(); // Trigger initial derivation like React does
        }

        // First derivation => watchers=0
        expect(deriveCount).toBe(1);
        expect(watcher).toHaveBeenCalledTimes(0);

        // Multiple synchronous updates
        baseStore.setState({ val: 1 });
        baseStore.setState({ val: 2 });
        baseStore.setState({ val: 3 });

        // Before microtask: no re-derivation yet
        expect(deriveCount).toBe(1);
        expect(watcher).toHaveBeenCalledTimes(0);

        await flushMicrotasks();

        // After microtask: single batched update
        expect(deriveCount).toBe(2);
        expect(watcher).toHaveBeenCalledTimes(1);
        expect(watcher).toHaveBeenCalledWith(6, 0);

        unsubscribe();
      });
    });

    describe('Pure Derived Mode (only derived watchers)', () => {
      it('should batch and deduplicate derivations when only derived stores are watching', async () => {
        const baseStore = createBaseStore(() => ({ val: 0 }));

        let parentDeriveCount = 0;
        const useParent = createDerivedStore($ => {
          parentDeriveCount += 1;
          return $(baseStore).val * 2;
        });

        let childDeriveCount = 0;
        const childValues: number[] = [];
        const useChild = createDerivedStore($ => {
          childDeriveCount += 1;
          const value = $(useParent) + 100;
          childValues.push(value);
          return value;
        });

        // Add a third derived store to watch child (so child has only derived watchers)
        let grandchildDeriveCount = 0;
        const grandchildValues: number[] = [];
        const useGrandchild = createDerivedStore($ => {
          grandchildDeriveCount += 1;
          const value = $(useChild) + 1000;
          grandchildValues.push(value);
          return value;
        });

        // Subscribe to grandchild to activate the chain (component watcher only at the end)
        const watcher = jest.fn();
        const unsubscribe = useGrandchild.subscribe(s => s, watcher);
        if (hasGetSnapshot(useGrandchild)) {
          useGrandchild.getSnapshot();
        }

        // First derivation => watchers=0
        expect(parentDeriveCount).toBe(1);
        expect(childDeriveCount).toBe(1);
        expect(grandchildDeriveCount).toBe(1);
        expect(watcher).toHaveBeenCalledTimes(0);

        // Multiple synchronous updates
        baseStore.setState({ val: 1 });
        baseStore.setState({ val: 2 });
        baseStore.setState({ val: 3 });

        // With new behavior: all stores batch via cascade (even pure derived chains)
        // Before microtask: no derivations yet
        expect(parentDeriveCount).toBe(1);
        expect(childDeriveCount).toBe(1);
        expect(grandchildDeriveCount).toBe(1);
        expect(childValues).toEqual([100]);
        expect(grandchildValues).toEqual([1100]);

        await flushMicrotasks();

        // After microtask: each store derives once (batched and deduplicated)
        expect(parentDeriveCount).toBe(2); // Initial + 1 batched
        expect(childDeriveCount).toBe(2); // Initial + 1 batched
        expect(grandchildDeriveCount).toBe(2); // Initial + 1 batched
        expect(childValues).toEqual([100, 106]);
        expect(grandchildValues).toEqual([1100, 1106]);
        expect(watcher).toHaveBeenCalledTimes(1);
        expect(watcher).toHaveBeenCalledWith(1106, 1100);

        unsubscribe();
      });
    });

    describe('Mixed Mode (both component and derived watchers)', () => {
      it('should derive synchronously when getState() is called', async () => {
        const baseStore = createBaseStore(() => ({ val: 0 }));

        let parentDeriveCount = 0;
        const useParent = createDerivedStore($ => {
          parentDeriveCount += 1;
          return $(baseStore).val * 2;
        });

        // Add a derived watcher (child derived store)
        let childDeriveCount = 0;
        const childValues: number[] = [];
        const useChild = createDerivedStore($ => {
          childDeriveCount += 1;
          const value = $(useParent) + 100;
          childValues.push(value);
          return value;
        });

        const childWatcher = jest.fn();
        const unsubChild = useChild.subscribe(s => s, childWatcher);
        if (hasGetSnapshot(useChild)) {
          useChild.getSnapshot();
        }

        // Add a component watcher (selector-based, non-derived) - simulates React
        const componentValues: number[] = [];
        const componentWatcher = jest.fn((val: number) => {
          componentValues.push(val);
        });
        const unsubComponent = useParent.subscribe(s => s, componentWatcher);
        if (hasGetSnapshot(useParent)) {
          useParent.getSnapshot();
        }

        // Initial state
        expect(parentDeriveCount).toBe(1);
        expect(childDeriveCount).toBe(1);
        expect(childValues).toEqual([100]);
        expect(componentValues).toEqual([]);
        expect(componentWatcher).toHaveBeenCalledTimes(0);
        expect(childWatcher).toHaveBeenCalledTimes(0);

        // Multiple synchronous updates
        baseStore.setState({ val: 1 });
        baseStore.setState({ val: 2 });
        baseStore.setState({ val: 3 });

        // Before microtask: all updates batched
        expect(parentDeriveCount).toBe(1);
        expect(childDeriveCount).toBe(1);
        expect(childValues).toEqual([100]);
        expect(componentWatcher).toHaveBeenCalledTimes(0);
        expect(componentValues).toEqual([]);

        useParent.getState();
        expect(parentDeriveCount).toBe(2);

        useChild.getState();
        expect(childDeriveCount).toBe(2);
        expect(childValues).toEqual([100, 106]);

        await flushMicrotasks();

        // After microtask: batched updates applied once
        expect(componentWatcher).toHaveBeenCalledTimes(1);
        expect(componentValues).toEqual([6]);
        expect(componentWatcher).toHaveBeenCalledWith(6, 0);

        expect(childWatcher).toHaveBeenCalledTimes(1);
        expect(childWatcher).toHaveBeenCalledWith(106, 100);

        unsubChild();
        unsubComponent();
      });

      it('should handle transitions between modes correctly', async () => {
        const baseStore = createBaseStore(() => ({ val: 0 }));

        let deriveCount = 0;
        const useDerived = createDerivedStore($ => {
          deriveCount += 1;
          return $(baseStore).val * 2;
        });

        // Start with component watcher only (batched mode) - selector-based like React
        const componentWatcher = jest.fn();
        const unsubComponent = useDerived.subscribe(s => s, componentWatcher);
        if (hasGetSnapshot(useDerived)) {
          useDerived.getSnapshot();
        }

        expect(deriveCount).toBe(1);

        baseStore.setState({ val: 1 });
        baseStore.setState({ val: 2 });

        // Batched - no immediate derivation
        expect(deriveCount).toBe(1);

        await flushMicrotasks();
        expect(deriveCount).toBe(2);
        expect(componentWatcher).toHaveBeenCalledTimes(1);

        // Now add a derived watcher (switch to mixed mode)
        let childDeriveCount = 0;
        const useChild = createDerivedStore($ => {
          childDeriveCount += 1;
          return $(useDerived) + 100;
        });

        const childWatcher = jest.fn();
        const unsubChild = useChild.subscribe(s => s, childWatcher);
        if (hasGetSnapshot(useChild)) {
          useChild.getSnapshot();
        }

        expect(childDeriveCount).toBe(1);

        // Multiple updates
        baseStore.setState({ val: 3 });
        baseStore.setState({ val: 4 });

        // Before microtask: updates batched via cascade scheduler
        expect(deriveCount).toBe(2);
        expect(childDeriveCount).toBe(1);

        // Component watcher still batched
        expect(componentWatcher).toHaveBeenCalledTimes(1);

        await flushMicrotasks();

        // After microtask: cascade applies batched updates
        expect(deriveCount).toBe(3);
        expect(childDeriveCount).toBe(2);
        expect(componentWatcher).toHaveBeenCalledTimes(2);
        expect(componentWatcher).toHaveBeenLastCalledWith(8, 4);
        expect(childWatcher).toHaveBeenCalledTimes(1);
        expect(childWatcher).toHaveBeenCalledWith(108, 104);

        // Remove derived watcher (back to component-only mode)
        unsubChild();

        // Multiple updates again
        baseStore.setState({ val: 5 });
        baseStore.setState({ val: 6 });

        // Before microtask: updates batched
        expect(deriveCount).toBe(3);

        await flushMicrotasks();

        // After microtask: single batched derivation
        expect(deriveCount).toBe(4);
        expect(componentWatcher).toHaveBeenCalledTimes(3);

        unsubComponent();
      });
    });
  });

  // ──────────────────────────────────────────────
  // Diamond Dependencies
  // ──────────────────────────────────────────────
  describe('Diamond Dependencies', () => {
    it('should minimize derivations in deep diamond dependency graphs via cascade scheduling', async () => {
      /**
       * Graph topology:
       *
       *           base1    base2
       *             |  \  /  |
       *             |   \/   |
       *             |   /\   |
       *             |  /  \  |
       *           left    right
       *             |  \  /  |
       *             |   \/   |
       *             |   /\   |
       *             |  /  \  |
       *          leftMid  rightMid
       *               \    /
       *                \  /
       *               merged
       *                  |
       *               final
       *
       * The cascade scheduler's benefits:
       * - Coalesces derivations into microtask-batched cascades
       * - Derives in topological order using a ranked dirty queue
       * - Does so without knowledge of broader graph structure
       * - Component watchers get a single notification per cascade
       * - Tearing is eliminated (all React components see consistent derived state)
       *
       * This test demonstrates that even with complex diamond dependencies, there
       * are zero unnecessary derivations, and component watchers are notified
       * exactly once per update batch.
       */

      const base1 = createBaseStore(() => ({ val: 1 }));
      const base2 = createBaseStore(() => ({ val: 10 }));

      const deriveCounts = {
        left: 0,
        right: 0,
        leftMid: 0,
        rightMid: 0,
        merged: 0,
        final: 0,
      };

      // Layer 1: Both depend on both bases (diamond pattern)
      const useLeft = createDerivedStore($ => {
        deriveCounts.left += 1;
        return $(base1).val + $(base2).val;
      });

      const useRight = createDerivedStore($ => {
        deriveCounts.right += 1;
        return $(base1).val * $(base2).val;
      });

      // Layer 2: Each depends on both Layer 1 stores (creates second diamond)
      const useLeftMid = createDerivedStore($ => {
        deriveCounts.leftMid += 1;
        return $(useLeft) + $(useRight);
      });

      const useRightMid = createDerivedStore($ => {
        deriveCounts.rightMid += 1;
        return $(useLeft) * $(useRight);
      });

      // Layer 3: Merge both mid stores (convergence point)
      const useMerged = createDerivedStore($ => {
        deriveCounts.merged += 1;
        const leftMid = $(useLeftMid);
        const rightMid = $(useRightMid);
        return { leftMid, rightMid, sum: leftMid + rightMid };
      });

      // Layer 4: Final derived store (component watcher will be here)
      const useFinal = createDerivedStore($ => {
        deriveCounts.final += 1;
        const merged = $(useMerged);
        return merged.sum * 2;
      });

      const watchers = {
        left: jest.fn(),
        final: jest.fn(),
      };

      const unsubLeft = useLeft.subscribe(s => s, watchers.left);
      const unsubFinal = useFinal.subscribe(s => s, watchers.final);

      // Initial derivation cascade
      expect(deriveCounts.left).toBe(1);
      expect(deriveCounts.right).toBe(1);
      expect(deriveCounts.leftMid).toBe(1);
      expect(deriveCounts.rightMid).toBe(1);
      expect(deriveCounts.merged).toBe(1);
      expect(deriveCounts.final).toBe(1);

      // All watchers should be at 0 (first derive doesn't notify)
      expect(watchers.left).toHaveBeenCalledTimes(0);
      expect(watchers.final).toHaveBeenCalledTimes(0);

      // Initial values:
      // base1=1, base2=10
      // left = 1+10 = 11
      // right = 1*10 = 10
      // leftMid = 11+10 = 21
      // rightMid = 11*10 = 110
      // merged = {leftMid: 21, rightMid: 110, sum: 131}
      // final = 131*2 = 262
      expect(useFinal.getState()).toBe(262);

      // Reset counters to measure next update
      Object.keys(deriveCounts).forEach(key => {
        deriveCounts[key as keyof typeof deriveCounts] = 0;
      });

      // Update base1 => triggers cascade
      base1.setState({ val: 2 });

      // With the cascade scheduler:
      // - All stores are enlisted in the cascade
      // - Derivations happen in rank order, each store derives once
      // - Component notifications are deferred to microtask
      // Before microtask: no derivations yet (all queued)
      expect(deriveCounts.left).toBe(0);
      expect(deriveCounts.right).toBe(0);
      expect(deriveCounts.leftMid).toBe(0);
      expect(deriveCounts.rightMid).toBe(0);
      expect(deriveCounts.merged).toBe(0);
      expect(deriveCounts.final).toBe(0);

      await flushMicrotasks();

      // After microtask: cascade executes in rank order
      // Each store derives once despite multiple dependency paths
      expect(deriveCounts.left).toBe(1);
      expect(deriveCounts.right).toBe(1);
      expect(deriveCounts.leftMid).toBe(1);
      expect(deriveCounts.rightMid).toBe(1);
      expect(deriveCounts.merged).toBe(1);
      expect(deriveCounts.final).toBe(1);

      // All watchers notified exactly once
      expect(watchers.left).toHaveBeenCalledTimes(1);
      expect(watchers.final).toHaveBeenCalledTimes(1);

      // New values:
      // base1=2, base2=10
      // left = 2+10 = 12
      // right = 2*10 = 20
      // leftMid = 12+20 = 32
      // rightMid = 12*20 = 240
      // merged = {leftMid: 32, rightMid: 240, sum: 272}
      // final = 272*2 = 544
      expect(useFinal.getState()).toBe(544);
      expect(watchers.final).toHaveBeenCalledWith(544, 262);

      // Reset counters again
      Object.keys(deriveCounts).forEach(key => {
        deriveCounts[key as keyof typeof deriveCounts] = 0;
      });

      // Update BOTH bases simultaneously => cascade batches everything
      base1.setState({ val: 3 });
      base2.setState({ val: 20 });

      // Before microtask: no derivations yet
      expect(deriveCounts.left).toBe(0);
      expect(deriveCounts.right).toBe(0);

      await flushMicrotasks();

      // After microtask, each store derives exactly once despite:
      // - Two base store updates
      // - Multiple convergent dependency paths (diamonds)
      // Demonstrating the cascade scheduler's ability to eliminate inefficiency
      expect(deriveCounts.left).toBe(1);
      expect(deriveCounts.right).toBe(1);
      expect(deriveCounts.leftMid).toBe(1);
      expect(deriveCounts.rightMid).toBe(1);
      expect(deriveCounts.merged).toBe(1);
      expect(deriveCounts.final).toBe(1);

      // Each watcher notified exactly once (second notification)
      expect(watchers.left).toHaveBeenCalledTimes(2);
      expect(watchers.final).toHaveBeenCalledTimes(2);

      // New values:
      // base1=3, base2=20
      // left = 3+20 = 23
      // right = 3*20 = 60
      // leftMid = 23+60 = 83
      // rightMid = 23*60 = 1380
      // merged = {leftMid: 83, rightMid: 1380, sum: 1463}
      // final = 1463*2 = 2926
      expect(useFinal.getState()).toBe(2926);
      expect(watchers.final).toHaveBeenLastCalledWith(2926, 544);

      // Cleanup
      unsubLeft();
      unsubFinal();
    });
  });

  // ──────────────────────────────────────────────
  // setState Should Throw Error
  // ──────────────────────────────────────────────
  describe('setState Should Throw Error', () => {
    it('should throw if setState is called on a derived store', () => {
      const baseStore = createBaseStore(() => ({ val: 1 }));
      const useDerived = createDerivedStore($ => {
        return $(baseStore).val * 2;
      });

      expect(() => {
        useDerived.setState(0);
      }).toThrow();
    });
  });
});
