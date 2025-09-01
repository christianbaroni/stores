function getNodeEnv() {
  try {
    // @ts-ignore
    return typeof process !== 'undefined' && process.env && process.env.NODE_ENV;
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
