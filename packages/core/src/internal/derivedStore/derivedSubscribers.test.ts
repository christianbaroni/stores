import { DerivedSubscribers, type DerivedWatcher } from './derivedSubscribers';

describe('DerivedSubscribers', () => {
  it('counts each subscription once and separates cascade from ordinary delivery', () => {
    const subscribers = new DerivedSubscribers<number>();
    const ordinary = vi.fn();
    const cascadeState = vi.fn();
    const cascadeSlice = vi.fn();
    const cascadeWatcher: DerivedWatcher<number> = {
      currentSlice: 0,
      equalityFn: Object.is,
      isCascadeParticipant: true,
      listener: cascadeSlice,
      selector: state => state % 2,
    };

    expect(subscribers.add(ordinary, false)).toBe(true);
    expect(subscribers.add(ordinary, false)).toBe(false);
    expect(subscribers.add(cascadeWatcher, true)).toBe(true);
    expect(subscribers.add(cascadeState, true)).toBe(true);
    expect(subscribers.add(cascadeState, true)).toBe(false);

    expect(subscribers.watcherCount).toBe(2);
    expect(subscribers.ordinaryWatcherCount).toBe(1);
    expect(subscribers.cascadeParticipantCount).toBe(2);
    expect(subscribers.cascadeStateListenerCount).toBe(1);

    subscribers.notifyCascade(1, 0);

    expect(ordinary).not.toHaveBeenCalled();

    subscribers.notifyOrdinary(2, 1);

    expect(cascadeState.mock.calls).toEqual([[1, 0]]);
    expect(cascadeSlice.mock.calls).toEqual([[1, 0]]);
    expect(ordinary.mock.calls).toEqual([[2, 1]]);

    expect(subscribers.delete(cascadeWatcher, true)).toBe(true);
    expect(subscribers.delete(cascadeWatcher, true)).toBe(false);
    expect(subscribers.delete(cascadeState, true)).toBe(true);
    expect(subscribers.delete(cascadeState, true)).toBe(false);

    subscribers.clear();
    expect(subscribers.watcherCount).toBe(0);
    expect(subscribers.ordinaryWatcherCount).toBe(0);
    expect(subscribers.cascadeParticipantCount).toBe(0);
    expect(subscribers.cascadeStateListenerCount).toBe(0);
  });

  it('stops active Set iteration when cleared reentrantly', () => {
    const subscribers = new DerivedSubscribers<number>();
    const second = vi.fn();

    subscribers.add(() => subscribers.clear(), false);
    subscribers.add(second, false);
    subscribers.notifyOrdinary(1, 0);

    expect(second).not.toHaveBeenCalled();
  });
});
