import { debounce } from './debounce';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('debounce', () => {
  it('coalesces a burst to its latest call after a full quiet period measured in elapsed time', () => {
    const first = { scale: 2 };
    const latest = { scale: 3 };
    const invoke = vi.fn(function (this: typeof first, value: number) {
      return this.scale * value;
    });
    const call = debounce(invoke, 100, { maxWait: 300 });

    expect(call.call(first, 1)).toBeUndefined();
    vi.advanceTimersByTime(60);
    vi.setSystemTime(Date.now() + 5_000);
    expect(call.call(latest, 4)).toBeUndefined();
    vi.setSystemTime(Date.now() - 10_000);

    vi.advanceTimersByTime(99);
    expect(invoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(invoke.mock.calls).toEqual([[4]]);
    expect(invoke.mock.contexts).toEqual([latest]);
    expect(vi.getTimerCount()).toBe(0);

    expect(call.call(first, 5)).toBe(12);
    expect(invoke).toHaveBeenCalledOnce();
  });

  it.each([
    { leading: false, trailing: false, single: [], burst: [] },
    { leading: true, trailing: false, single: [1], burst: [2] },
    { leading: false, trailing: true, single: [1], burst: [3] },
    { leading: true, trailing: true, single: [1], burst: [2, 3] },
  ])('consumes calls only on enabled edges: leading=$leading, trailing=$trailing', ({ leading, trailing, single, burst }) => {
    const values: number[] = [];
    const call = debounce((value: number) => values.push(value), 100, { leading, trailing, maxWait: 300 });

    call(1);
    expect(values).toEqual(leading ? [1] : []);
    expect(vi.getTimerCount()).toBe(leading || trailing ? 1 : 0);
    vi.advanceTimersByTime(100);
    expect(values).toEqual(single);
    values.length = 0;

    call(2);
    vi.advanceTimersByTime(40);
    call(3);
    vi.advanceTimersByTime(99);
    expect(values).toEqual(leading ? [2] : []);
    vi.advanceTimersByTime(1);
    expect(values).toEqual(burst);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['timer', 'call'])('bounds continuous input by maxWait when the deadline is reached through a %s', deadline => {
    const elapsed = performance.now.bind(performance);
    let timeWithoutTimerDelivery: number | undefined;
    vi.spyOn(performance, 'now').mockImplementation(() => timeWithoutTimerDelivery ?? elapsed());
    const invoke = vi.fn();
    const call = debounce(invoke, 100, { maxWait: 250 });

    call();
    for (let i = 0; i < 3; i++) {
      vi.advanceTimersByTime(80);
      call();
    }
    vi.advanceTimersByTime(9);
    expect(invoke).not.toHaveBeenCalled();

    if (deadline === 'timer') vi.advanceTimersByTime(1);
    else {
      timeWithoutTimerDelivery = 250;
      call();
    }
    expect(invoke).toHaveBeenCalledOnce();
    call.cancel();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('discards pending work on cancel and consumes it on flush while preserving the completed result', () => {
    const invoke = vi.fn((value: number) => value * 10);
    const call = debounce(invoke, 100, { leading: true });

    expect(call(1)).toBe(10);
    vi.advanceTimersByTime(20);
    expect(call(2)).toBe(10);
    call.cancel();
    expect(vi.getTimerCount()).toBe(0);
    expect(call.flush()).toBe(10);

    expect(call(3)).toBe(30);
    vi.advanceTimersByTime(20);
    expect(call(4)).toBe(30);
    expect(call.flush()).toBe(40);
    expect(vi.getTimerCount()).toBe(0);
    expect(call.flush()).toBe(40);
    call.cancel();
    vi.advanceTimersByTime(200);
    expect(invoke.mock.calls).toEqual([[1], [3], [4]]);
  });

  it.each([false, true])('preserves callback-created work when the invoking callback throws=%s', throws => {
    const error = new Error('callback failed');
    const invoke = vi.fn((value: number): number => {
      if (value < 3) {
        call(value + 1);
        if (throws) throw error;
      }
      return value;
    });
    const call = debounce(invoke, 100, { leading: true });

    if (throws) expect(() => call(1)).toThrow(error);
    else expect(call(1)).toBe(1);
    expect(invoke.mock.calls).toEqual([[1]]);
    expect(vi.getTimerCount()).toBe(1);

    if (throws) expect(() => call.flush()).toThrow(error);
    else expect(call.flush()).toBe(2);
    expect(invoke.mock.calls).toEqual([[1], [2]]);
    expect(vi.getTimerCount()).toBe(1);

    vi.advanceTimersByTime(100);
    expect(invoke.mock.calls).toEqual([[1], [2], [3]]);
    expect(vi.getTimerCount()).toBe(0);
    expect(call.flush()).toBe(3);
  });
});
