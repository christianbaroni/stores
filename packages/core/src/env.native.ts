import { unstable_batchedUpdates } from 'react-native';

let Platform;
try {
  const req = Function('return typeof require !== "undefined" ? require : undefined')();
  Platform = req ? req('react-native').Platform : { OS: undefined };
} catch {
  Platform = { OS: undefined };
}

export const IS_REACT_NATIVE = true;
export const IS_BROWSER = false;
export const IS_IOS = Platform.OS === 'ios';
export const IS_ANDROID = Platform.OS === 'android';
export const IS_DEV = process.env.NODE_ENV === 'development';
export const IS_TEST = process.env.NODE_ENV === 'test';

export { unstable_batchedUpdates };
