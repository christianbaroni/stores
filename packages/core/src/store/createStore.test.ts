import { createStore } from './createStore';

describe('createStore', () => {
  it('does not notify when an updater returns the current state reference', () => {
    const store = createStore(() => ({ count: 0 }));
    const listener = vi.fn();

    store.subscribe(listener);
    store.setState(state => state);

    expect(listener).not.toHaveBeenCalled();
    expect(store.getState()).toEqual({ count: 0 });
  });

  it('replaces primitive state when replace is omitted', () => {
    const store = createStore(() => 0);
    const listener = vi.fn();

    store.subscribe(listener);
    store.setState(1);

    expect(store.getState()).toBe(1);
    expect(listener).toHaveBeenCalledWith(1, 0);
  });

  it('replaces array state without converting it into an object', () => {
    const store = createStore(() => [1, 2]);
    const listener = vi.fn();
    const previous = store.getState();

    store.subscribe(listener);
    store.setState([3]);

    expect(store.getState()).toEqual([3]);
    expect(Array.isArray(store.getState())).toBe(true);
    expect(listener).toHaveBeenCalledWith([3], previous);
  });

  it('notifies selector subscribers only when their selected value changes', () => {
    const store = createStore(() => ({ count: 0, label: 'initial' }));
    const listener = vi.fn();

    store.subscribe(state => state.count, listener);
    store.setState({ label: 'updated' });
    store.setState({ count: 1 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(1, 0);
  });
});
