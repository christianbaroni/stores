function getNodeEnv(): string | undefined {
  try {
    return (typeof process !== 'undefined' && process.env && process.env.NODE_ENV) || undefined;
  } catch {
    return undefined;
  }
}

export const IS_REACT_NATIVE = false;
export const IS_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';
export const IS_IOS = false;
export const IS_ANDROID = false;
export const IS_DEV = getNodeEnv() === 'development';
export const IS_TEST = getNodeEnv() === 'test';

// React 18+ batches automatically, so this is just a passthrough
export const unstable_batchedUpdates = <T>(callback: () => T): T => callback();
