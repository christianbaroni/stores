import { DerivedSubscribers, type DerivedWatcher } from './derivedSubscribers';

describe('DerivedSubscribers', () => {
  it('maintains idempotent collection counts and routes notification lanes', () => {
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

    expect(subscribers.addWatcher(ordinary)).toBe(true);
    expect(subscribers.addWatcher(ordinary)).toBe(false);
    expect(subscribers.addWatcher(cascadeWatcher)).toBe(true);
    expect(subscribers.addCascadeStateListener(cascadeState)).toBe(true);
    expect(subscribers.addCascadeStateListener(cascadeState)).toBe(false);

    expect(subscribers.watcherCount).toBe(2);
    expect(subscribers.ordinaryWatcherCount).toBe(1);
    expect(subscribers.cascadeParticipantCount).toBe(2);
    expect(subscribers.cascadeStateListenerCount).toBe(1);

    subscribers.notifyCascade(1, 0);
    subscribers.notifyOrdinary(1, 0);

    expect(cascadeState).toHaveBeenCalledWith(1, 0);
    expect(cascadeSlice).toHaveBeenCalledWith(1, 0);
    expect(ordinary).toHaveBeenCalledWith(1, 0);

    expect(subscribers.deleteWatcher(cascadeWatcher)).toBe(true);
    expect(subscribers.deleteWatcher(cascadeWatcher)).toBe(false);
    expect(subscribers.deleteCascadeStateListener(cascadeState)).toBe(true);
    expect(subscribers.deleteCascadeStateListener(cascadeState)).toBe(false);

    subscribers.clear();
    expect(subscribers.watcherCount).toBe(0);
    expect(subscribers.ordinaryWatcherCount).toBe(0);
    expect(subscribers.cascadeParticipantCount).toBe(0);
    expect(subscribers.cascadeStateListenerCount).toBe(0);
  });

  it('stops active Set iteration when cleared reentrantly', () => {
    const subscribers = new DerivedSubscribers<number>();
    const second = vi.fn();

    subscribers.addWatcher(() => subscribers.clear());
    subscribers.addWatcher(second);
    subscribers.notifyOrdinary(1, 0);

    expect(second).not.toHaveBeenCalled();
  });
});
