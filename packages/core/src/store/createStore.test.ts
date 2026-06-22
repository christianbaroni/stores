import type { InternalSubscribeOptions } from '../internal/types/internalSubscribeTypes';
import { createStore } from './createStore';
import type { StoreApi } from './types';

describe('createStore', () => {
  type CounterState = { count: number; increment: () => void; reset: () => void };

  it('passes the store api into the creator and keeps initial state stable', () => {
    let creatorApi: StoreApi<CounterState> | undefined;

    const store = createStore<CounterState>((set, get, api) => {
      creatorApi = api;
      return {
        count: 0,
        increment: () => set({ count: get().count + 1 }),
        reset: () => api.setState(api.getInitialState(), true),
      };
    });

    if (!creatorApi) throw new Error('Expected createStore to pass the api to the state creator.');
    const initialState = store.getInitialState();

    expect(creatorApi).toBe(store);

    store.getState().increment();
    expect(store.getState().count).toBe(1);
    expect(store.getInitialState()).toBe(initialState);

    store.getState().reset();
    expect(store.getState()).toBe(initialState);
  });

  it('does not notify when an updater returns the current state reference', () => {
    const store = createStore(() => ({ count: 0 }));
    const listener = vi.fn();

    store.subscribe(listener);
    store.setState(state => state);

    expect(listener).not.toHaveBeenCalled();
    expect(store.getState()).toEqual({ count: 0 });
  });

  it('does not notify when Object.is treats primitive state as unchanged', () => {
    const store = createStore(() => NaN);
    const listener = vi.fn();

    store.subscribe(listener);
    store.setState(NaN);

    expect(listener).not.toHaveBeenCalled();
  });

  it('notifies when object state changes identity even if values match', () => {
    const initialState = { count: 0 };
    const store = createStore(() => initialState);
    const listener = vi.fn();

    store.subscribe(listener);
    store.setState({ ...store.getState() });

    expect(listener).toHaveBeenCalledWith({ count: 0 }, initialState);
  });

  it('merges object updates by default and replaces when requested', () => {
    const store = createStore<{ count: number; label?: string } | { label: string }>(() => ({ count: 0 }));

    store.setState({ label: 'merged' });
    expect(store.getState()).toEqual({ count: 0, label: 'merged' });

    store.setState({ label: 'replaced' }, true);
    expect(store.getState()).toEqual({ label: 'replaced' });
  });

  it('replaces primitive state when replace is omitted', () => {
    const store = createStore(() => 0);
    const listener = vi.fn();

    store.subscribe(listener);
    store.setState(1);

    expect(store.getState()).toBe(1);
    expect(listener).toHaveBeenCalledWith(1, 0);
  });

  it('replaces array state without converting it into a plain object', () => {
    const store = createStore(() => [1, 2]);
    const listener = vi.fn();
    const previous = store.getState();

    store.subscribe(listener);
    store.setState([3]);

    expect(store.getState()).toEqual([3]);
    expect(Array.isArray(store.getState())).toBe(true);
    expect(listener).toHaveBeenCalledWith([3], previous);
  });

  it('removes unsubscribed listeners while preserving remaining subscribers', () => {
    const store = createStore(() => ({ count: 0 }));
    const removedListener = vi.fn();
    const remainingListener = vi.fn();

    const unsubscribe = store.subscribe(removedListener);
    store.subscribe(remainingListener);

    unsubscribe();
    store.setState({ count: 1 });

    expect(removedListener).not.toHaveBeenCalled();
    expect(remainingListener).toHaveBeenCalledTimes(1);
    expect(remainingListener).toHaveBeenCalledWith({ count: 1 }, { count: 0 });
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

  it('honors selector equality functions', () => {
    const store = createStore(() => ({ count: 0 }));
    const listener = vi.fn();

    store.subscribe(state => state.count, listener, { equalityFn: (a, b) => Math.abs(a - b) < 2 });

    store.setState({ count: 1 });
    store.setState({ count: 2 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(2, 0);
  });

  it('fires selector subscribers immediately with the current selection when requested', () => {
    const store = createStore(() => ({ count: 1 }));
    const listener = vi.fn();

    store.subscribe(state => state.count, listener, { fireImmediately: true });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(1, 1);
  });

  it('notifies cascade participants before ordinary listeners', () => {
    const store = createStore(() => ({ count: 0 }));
    let participantValue = 0;

    const listener = vi.fn(() => {
      expect(participantValue).toBe(1);
    });

    const subscribeOptions: InternalSubscribeOptions<unknown> = { isCascadeParticipant: true };

    store.subscribe(
      state => state.count,
      count => {
        participantValue = count;
      },
      subscribeOptions
    );
    store.subscribe(listener);

    store.setState({ count: 1 });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ count: 1 }, { count: 0 });
  });
});
