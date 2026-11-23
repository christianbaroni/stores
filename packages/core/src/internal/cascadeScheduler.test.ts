import { activateCascade, joinCascade, ScheduledDerivation, settleCascadeDerivations } from './cascadeScheduler';

describe('cascadeScheduler', () => {
  it('runs deferred tasks in insertion order after queue promotion', async () => {
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
    await Promise.resolve();

    expect(events).toEqual(['first', 'second']);
  });

  it('runs deferred tasks enqueued while flushing in insertion order', async () => {
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
    await Promise.resolve();

    expect(events).toEqual(['first', 'second', 'first']);
  });

  it('runs a task enqueued by the single deferred task', async () => {
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
    await Promise.resolve();

    expect(events).toEqual(['first', 'second']);
  });

  it('moves a pending derivation behind the wave that invalidated it', () => {
    const events: string[] = [];
    const second = new ScheduledDerivation(() => events.push('second'));
    const first = new ScheduledDerivation(() => {
      events.push('first');
      second.schedule();
    });
    const third = new ScheduledDerivation(() => events.push('third'));

    first.schedule();
    second.schedule();
    third.schedule();
    settleCascadeDerivations();

    expect(events).toEqual(['first', 'third', 'second']);
  });

  it('can reschedule a sibling after its wave throws', () => {
    const error = new Error('failed derivation');
    const first = new ScheduledDerivation(() => {
      throw error;
    });
    const run = vi.fn();
    const sibling = new ScheduledDerivation(run);

    first.schedule();
    sibling.schedule();
    expect(settleCascadeDerivations).toThrow(error);
    expect(run).not.toHaveBeenCalled();

    sibling.schedule();
    settleCascadeDerivations();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
