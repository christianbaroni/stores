export function isPromiseLike<T>(value: T | Promise<T> | void): value is Promise<T> {
  return !!value && typeof value === 'object' && 'then' in value && typeof value.then === 'function';
}
