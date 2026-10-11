import { deferred, flushMacrotask } from '../async.testUtils';
import { createAsyncMicrotaskScheduler } from './createAsyncMicrotaskScheduler';

type Persist = (name: string, value: number, version: number | undefined) => Promise<void>;

describe('createAsyncMicrotaskScheduler', () => {
  it('shares one completion promise for synchronous calls and uses the latest arguments', async () => {
    const write = deferred<void>();
    const persist = vi.fn<Persist>(() => write.promise);
    const schedule = createAsyncMicrotaskScheduler(persist);
    const first = schedule('first', 1, 0);
    const second = schedule('latest', 2, 1);
    const settled = vi.fn();
    void first.then(settled);

    try {
      expect(second).toBe(first);
      expect(persist).not.toHaveBeenCalled();
      await flushMacrotask();
      expect(persist.mock.calls).toEqual([['latest', 2, 1]]);
      expect(settled).not.toHaveBeenCalled();
    } finally {
      write.resolve();
      await first;
    }

    expect(settled).toHaveBeenCalledOnce();
  });

  it('coalesces updates received during a write into the next ordered batch', async () => {
    const firstWrite = deferred<void>();
    const nextWrite = deferred<void>();
    const persist = vi.fn<Persist>().mockReturnValueOnce(firstWrite.promise).mockReturnValueOnce(nextWrite.promise);
    const schedule = createAsyncMicrotaskScheduler(persist);
    const first = schedule('counter', 1, 0);

    try {
      await flushMacrotask();
      expect(persist.mock.calls).toEqual([['counter', 1, 0]]);

      const second = schedule('counter', 2, 1);
      const third = schedule('counter', 3, undefined);
      const settled = vi.fn();
      void third.then(settled);

      expect(second).not.toBe(first);
      expect(third).toBe(second);
      await flushMacrotask();
      expect(persist).toHaveBeenCalledTimes(1);

      firstWrite.resolve();
      await first;
      await flushMacrotask();
      expect(persist.mock.calls).toEqual([
        ['counter', 1, 0],
        ['counter', 3, undefined],
      ]);
      expect(settled).not.toHaveBeenCalled();

      nextWrite.resolve();
      await third;
      expect(settled).toHaveBeenCalledOnce();
    } finally {
      firstWrite.resolve();
      nextWrite.resolve();
      await flushMacrotask();
    }
  });

  it('reports a failed execution without preventing the next batch', async () => {
    const write = deferred<void>();
    const error = new Error('failed execution');
    const persist = vi.fn<Persist>().mockReturnValueOnce(write.promise).mockResolvedValueOnce(undefined);
    const schedule = createAsyncMicrotaskScheduler(persist);
    const first = schedule('counter', 1, 0);
    const outcome = first.catch(reason => reason);

    await flushMacrotask();
    const second = schedule('counter', 2, 0);
    write.reject(error);

    expect(await outcome).toBe(error);
    await expect(second).resolves.toBeUndefined();
    expect(persist.mock.calls).toEqual([
      ['counter', 1, 0],
      ['counter', 2, 0],
    ]);
  });
});
