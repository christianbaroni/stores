import { createDerivedStore, shallowEqual, time } from 'stores';
import { useSyncTestStore } from './syncTestStore';

const CONTEXT_TTL_MS = time.seconds(3);

export const useSortedContexts = createDerivedStore(
  $ => {
    const contexts = $(useSyncTestStore).activeContexts;
    const now = Date.now();

    const recentlyActive = Object.values(contexts).filter(context => {
      if (!context) return false;
      const age = now - context.lastSeenAt;
      return age <= CONTEXT_TTL_MS;
    });

    return recentlyActive
      .sort((a, b) => {
        if (!a || !b) return 0;
        const typeOrder: Record<string, number> = { background: 0, popup: 1, options: 2 };
        const typeComparison = (typeOrder[a.type] ?? 999) - (typeOrder[b.type] ?? 999);
        if (typeComparison !== 0) return typeComparison;
        return a.label.localeCompare(b.label);
      })
      .filter(context => context !== undefined);
  },
  { equalityFn: shallowEqual, lockDependencies: true }
);

export const useRecentOperations = createDerivedStore(
  $ => {
    const operations = $(useSyncTestStore).operations;
    return [...operations].reverse();
  },
  { lockDependencies: true }
);

export const useOperationStats = createDerivedStore(
  $ => {
    const operations = $(useSyncTestStore).operations;
    const totalOps = operations.length;
    const incrementOps = operations.filter(op => op.type === 'increment').length;
    const decrementOps = operations.filter(op => op.type === 'decrement').length;
    const resetOps = operations.filter(op => op.type === 'reset').length;
    const setOps = operations.filter(op => op.type === 'set').length;
    const formattedTotalOps = totalOps > 50 ? '50+' : `${totalOps} total`;

    return {
      decrementOps,
      formattedTotalOps,
      incrementOps,
      resetOps,
      setOps,
      totalOps,
    };
  },
  { debugMode: 'verbose', lockDependencies: true }
);
