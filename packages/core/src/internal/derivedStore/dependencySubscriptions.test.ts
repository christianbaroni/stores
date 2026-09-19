import { createStore } from '../createStore';
import { hasCascadeStateSubscription, SUBSCRIBE_CASCADE_STATE } from '../cascadeSubscriptions';
import type { StoreApi } from '../../store/types';
import { DependencySubscriptions } from './dependencySubscriptions';

describe('DependencySubscriptions', () => {
  it('stores selector unsubscribes as one function or a promoted array', () => {
    const dependencies = new DependencySubscriptions(() => undefined);
    const first = vi.fn();
    const second = vi.fn();

    dependencies.addSelector(first);
    expect(dependencies.size).toBe(1);

    dependencies.addSelector(second);
    expect(dependencies.size).toBe(2);

    dependencies.beginRebuild(true);
    expect(first).toHaveBeenCalledWith(true);
    expect(second).toHaveBeenCalledWith(true);
    expect(dependencies.size).toBe(0);
  });

  it('retains current state dependencies, removes stale entries, and collapses back to one', () => {
    const dependencies = new DependencySubscriptions(() => undefined);
    const firstStore = createStore(() => 1);
    const secondStore = createStore(() => 2);
    const first = trackCascadeSubscriptions(firstStore);
    const second = trackCascadeSubscriptions(secondStore);

    dependencies.beginRebuild(true);
    dependencies.retainState(firstStore);
    dependencies.finishRebuild(true);
    expect(first.created).toBe(1);

    dependencies.beginRebuild(true);
    dependencies.retainState(firstStore);
    dependencies.retainState(secondStore);
    dependencies.finishRebuild(true);
    expect(first.created).toBe(1);
    expect(second.created).toBe(1);

    dependencies.beginRebuild(true);
    dependencies.retainState(secondStore);
    dependencies.finishRebuild(true);
    expect(first.removed).toBe(1);
    expect(second.removed).toBe(0);

    dependencies.clear(true);
    expect(second.removed).toBe(1);
    expect(dependencies.size).toBe(0);
  });
});

function trackCascadeSubscriptions<State>(store: StoreApi<State>): { readonly created: number; readonly removed: number } {
  if (!hasCascadeStateSubscription(store)) throw new Error('Expected cascade-state subscription support.');

  let created = 0;
  let removed = 0;
  const original = store[SUBSCRIBE_CASCADE_STATE];

  store[SUBSCRIBE_CASCADE_STATE] = listener => {
    created += 1;
    const unsubscribe = original(listener);
    let active = true;
    return skipAbortFetch => {
      if (!active) return;
      active = false;
      removed += 1;
      unsubscribe(skipAbortFetch);
    };
  };

  return {
    get created() {
      return created;
    },
    get removed() {
      return removed;
    },
  };
}
