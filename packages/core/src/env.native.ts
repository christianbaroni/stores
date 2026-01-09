import { Platform, unstable_batchedUpdates } from 'react-native';

export const IS_REACT_NATIVE = true;
export const IS_BROWSER = false;
export const IS_IOS = Platform.OS === 'ios';
export const IS_ANDROID = Platform.OS === 'android';
export const IS_DEV = process.env.NODE_ENV === 'development';
export const IS_TEST = process.env.NODE_ENV === 'test';

export { unstable_batchedUpdates };
