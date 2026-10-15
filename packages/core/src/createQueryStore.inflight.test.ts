import { deferred } from './async.testUtils';
import { createQueryStore } from './createQueryStore';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('independent query reads', () => {
  it.each([true, 'withCache'] as const)('preserves independent reads with skipStoreUpdates=%s', async skipStoreUpdates => {
    const request = deferred<string>();
    const store = createQueryStore({ params: { id: 'a' }, fetcher: () => request.promise, staleTime: Infinity });
    const read = store.getState().fetch({ id: 'b' }, { skipStoreUpdates });

    try {
      store.setState({ enabled: false });
      request.resolve('parallel data');
      expect(await read).toBe('parallel data');
      expect(store.getState().getData({ id: 'b' })).toBe(skipStoreUpdates === 'withCache' ? 'parallel data' : null);
    } finally {
      store.getState().reset();
    }
  });
});
