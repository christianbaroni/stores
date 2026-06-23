export const IS_REACT_NATIVE = false;
export const IS_BROWSER: boolean = typeof window !== 'undefined' && typeof document !== 'undefined';
export const IS_IOS = false;
export const IS_ANDROID = false;
export const IS_DEV: boolean = process.env.NODE_ENV === 'development';
export const IS_TEST: boolean = process.env.NODE_ENV === 'test';
