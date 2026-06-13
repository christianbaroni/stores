import { SyncContext } from './syncEnhancer';

type SyncContextMock = {
  context: SyncContext;
  fieldTimestamps: Record<string, number>;
};

/**
 * Creates a `SyncContext` mock and the field timestamp record used by its methods.
 */
export function createSyncContextMock(overrides: Partial<SyncContext> = {}): SyncContextMock {
  const fieldTimestamps: Record<string, number> = {};

  const mergeFieldTimestamps =
    overrides.mergeFieldTimestamps ??
    ((fields: Record<string, number>) => {
      for (const [key, timestamp] of Object.entries(fields)) fieldTimestamps[key] = timestamp;
    });

  const clearFieldTimestamps =
    overrides.clearFieldTimestamps ??
    ((snapshot: Record<string, number> | undefined) => {
      if (!snapshot) return;
      for (const [key, timestamp] of Object.entries(snapshot)) {
        if (fieldTimestamps[key] === timestamp) delete fieldTimestamps[key];
      }
    });

  const getFieldTimestampSnapshot =
    overrides.getFieldTimestampSnapshot ??
    (() => {
      if (!Object.keys(fieldTimestamps).length) return undefined;
      return { ...fieldTimestamps };
    });

  const context: SyncContext = {
    isAsync: overrides.isAsync ?? false,
    getFieldTimestampSnapshot,
    getIsApplyingRemote: overrides.getIsApplyingRemote ?? (() => false),
    getSessionId: overrides.getSessionId ?? (() => 'mock-session'),
    getTimestamp: overrides.getTimestamp ?? (() => Date.now()),
    onHydrationComplete: overrides.onHydrationComplete,
    onHydrationFlushEnd: overrides.onHydrationFlushEnd,
    mergeFieldTimestamps,
    clearFieldTimestamps,
    setIsApplyingRemote: overrides.setIsApplyingRemote ?? (() => {}),
    setSessionId: overrides.setSessionId ?? (() => {}),
    setTimestamp: overrides.setTimestamp ?? (() => {}),
    setWithoutPersist: overrides.setWithoutPersist,
  };

  return { context, fieldTimestamps };
}
