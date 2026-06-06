/**
 * @jest-environment node
 */

import { createBaseStore } from '../../createBaseStore';
import { createDerivedStore } from '../../createDerivedStore';

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}

function expectDefined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Expected value to be defined');
  return value;
}

describe('derive proxy stripping', () => {
  it('strips a directly escaped root tracking proxy from derived output', async () => {
    const sourceStore = createBaseStore(() => ({
      count: 1,
    }));

    const useDerived = createDerivedStore($ => {
      const source = $(sourceStore);
      return { source };
    });

    const unsubscribe = useDerived.subscribe(() => {});
    await flushMicrotasks();

    expect(useDerived.getState().source).toBe(sourceStore.getState());

    unsubscribe();
  });

  it('strips nested escaped tracking proxies after object paths were observed', async () => {
    const profile = { name: 'Alice' };
    const sourceStore = createBaseStore(() => ({
      count: 1,
      profile,
    }));

    const useDerived = createDerivedStore($ => {
      const source = $(sourceStore);
      return {
        nested: {
          source,
        },
        profile: source.profile,
      };
    });

    const unsubscribe = useDerived.subscribe(() => {});
    await flushMicrotasks();

    const state = useDerived.getState();
    expect(state.nested.source).toBe(sourceStore.getState());
    expect(state.profile).toBe(profile);

    unsubscribe();
  });

  it('does not wrap returned containers while stripping nested tracking proxies', async () => {
    const profile = { name: 'Alice' };
    const sourceStore = createBaseStore(() => ({
      count: 1,
      profile,
    }));

    type PublishedState = {
      nested: {
        source: ReturnType<typeof sourceStore.getState>;
      };
      profile: typeof profile;
    };

    let returnedState: PublishedState | undefined;
    const useDerived = createDerivedStore($ => {
      const source = $(sourceStore);
      const nextState = {
        nested: {
          source,
        },
        profile: source.profile,
      };

      returnedState = nextState;
      return nextState;
    });

    const unsubscribe = useDerived.subscribe(() => {});
    await flushMicrotasks();

    const state = useDerived.getState();
    const returned = expectDefined(returnedState);
    expect(state).toBe(returned);
    expect(state.nested).toBe(returned.nested);
    expect(state.nested.source).toBe(sourceStore.getState());
    expect(state.profile).toBe(profile);

    unsubscribe();
  });

  it('does not use has traps to identify tracking proxies during stripping', async () => {
    const sourceStore = createBaseStore(() => ({
      count: 1,
    }));

    let hasReads = 0;
    const foreignProxy = new Proxy(new Date('2026-05-18T00:00:00.000Z'), {
      has(target, key) {
        hasReads += 1;
        return Reflect.has(target, key);
      },
    });

    const useDerived = createDerivedStore($ => {
      void $(sourceStore).count;
      return { foreignProxy };
    });

    const unsubscribe = useDerived.subscribe(() => {});
    await flushMicrotasks();

    expect(useDerived.getState().foreignProxy).toBe(foreignProxy);
    expect(hasReads).toBe(0);

    unsubscribe();
  });
});
