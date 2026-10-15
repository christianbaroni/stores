import { flushMicrotasks } from './async.testUtils';
import { createBaseStore } from './createBaseStore';
import { createDerivedStore } from './createDerivedStore';

afterEach(() => vi.useRealTimers());

it.each([false, true])('delivers a debounced dependency without requiring a read (selector: %s)', async useSelector => {
  vi.useFakeTimers();
  const source = createBaseStore(() => 0);
  const parent = createDerivedStore($ => $(source), { debounce: 50 });
  const child = createDerivedStore($ => (useSelector ? $(parent, state => state) : $(parent)) + 1);
  const listener = vi.fn();
  const unsubscribe = child.subscribe(listener);

  source.setState(1);
  await vi.advanceTimersByTimeAsync(49);
  expect(listener).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(listener.mock.calls).toEqual([[2, 1]]);

  unsubscribe();
  parent.destroy();
});

it('preserves deferred updates scheduled after a listener synchronously drains the current queue', async () => {
  const sources = Array.from({ length: 4 }, () => createBaseStore(() => 0));
  const stores = sources.map(source => createDerivedStore($ => $(source)));
  const unrelated = createBaseStore(() => 0);
  const unsubscribeUnrelated = unrelated.subscribe(() => {});
  const events: number[][] = [];
  const unsubscribes = stores.map((store, index) =>
    store.subscribe((next, previous) => {
      events.push([index, previous, next]);
      if (index !== 0) return;
      unrelated.setState(1);
      sources[2].setState(1);
      sources[3].setState(1);
    })
  );

  sources[0].setState(1);
  sources[1].setState(1);
  await flushMicrotasks();
  expect(events).toEqual([
    [0, 0, 1],
    [1, 0, 1],
    [2, 0, 1],
    [3, 0, 1],
  ]);

  for (const unsubscribe of unsubscribes) unsubscribe();
  unsubscribeUnrelated();
});

it('allows the last base listener to unsubscribe during derived delivery', () => {
  const source = createBaseStore(() => ({ count: 0 }));
  const derived = createDerivedStore($ => $(source).count);
  const unsubscribeSource = source.subscribe(() => {});
  const unsubscribeDerived = derived.subscribe(() => unsubscribeSource());

  expect(() => source.setState({ count: 1 })).not.toThrow();
  expect(derived.getState()).toBe(1);

  unsubscribeDerived();
});
