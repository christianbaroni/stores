export function batchStoreNotifications<T>(callback: () => T): T {
  return callback();
}
