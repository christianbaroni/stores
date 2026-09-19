import { activateCascade, enqueueDerive, flushCascade, getCurrentDeriveRank, joinCascade } from './cascadeScheduler';

describe('cascadeScheduler', () => {
  it('runs deferred tasks in insertion order after queue promotion', () => {
    const events: string[] = [];

    function first(): void {
      events.push('first');
    }

    function second(): void {
      events.push('second');
    }

    activateCascade();
    joinCascade(first);
    joinCascade(second);
    flushCascade();

    expect(events).toEqual(['first', 'second']);
  });

  it('runs deferred tasks enqueued while flushing in insertion order', () => {
    const events: string[] = [];

    function first(): void {
      events.push('first');
    }

    function second(): void {
      events.push('second');
      joinCascade(first);
    }

    activateCascade();
    joinCascade(first);
    joinCascade(second);
    flushCascade();

    expect(events).toEqual(['first', 'second', 'first']);
  });

  it('runs a task enqueued by the single deferred task', () => {
    const events: string[] = [];

    function first(): void {
      events.push('first');
      joinCascade(second);
    }

    function second(): void {
      events.push('second');
    }

    activateCascade();
    joinCascade(first);
    flushCascade();

    expect(events).toEqual(['first', 'second']);
  });

  it('lets a derive task skip a stale rank after being requeued from the active batch', () => {
    const events: string[] = [];
    let secondRank: number | null = null;

    function first(): void {
      events.push('first');
      secondRank = 1;
      enqueueDerive(second, 1);
    }

    function second(): void {
      if (secondRank !== getCurrentDeriveRank()) return;
      events.push('second');
    }

    activateCascade();
    enqueueDerive(first, 0);
    secondRank = 0;
    enqueueDerive(second, 0);
    flushCascade();

    expect(events).toEqual(['first', 'second']);
  });
});
