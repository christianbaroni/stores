import { deferred, flushMicrotasks } from './async.testUtils';
import { createQueryStore } from './createQueryStore';

import { createAsyncStorageMock } from './internal/storage/storageMocks.testUtils';

import type { SyncEngine } from './sync/types';

function createPendingStorage() {
  const read = deferred<string | undefined>();
  const storage = createAsyncStorageMock();
  storage.get.mockReturnValueOnce(read.promise);
  return { read, storage };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('initial query hydration', () => {
  it('fetches when an active query is enabled before async hydration completes', async () => {
    const { read, storage } = createPendingStorage();
    const fetcher = vi.fn(async () => 42);
    const engine: SyncEngine = {
      sessionId: 'local',
      register: () => ({ destroy: () => {}, publish: () => {} }),
    };
    const store = createQueryStore(
      { enabled: false, fetcher, staleTime: Infinity },
      { storage, storageKey: 'enabled-before-hydration', sync: { engine } }
    );
    const unsubscribe = store.subscribe(() => {});
    try {
      const enabled = store.setState({ enabled: true });
      expect(fetcher).not.toHaveBeenCalled();

      read.resolve(undefined);
      await enabled;
      await flushMicrotasks(5);
      expect(store.getState().enabled).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
    } finally {
      unsubscribe();
      store.getState().reset();
    }
  });
});
