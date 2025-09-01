let Platform;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const req = Function('return typeof require !== "undefined" ? require : undefined')();
  Platform = req ? req('react-native').Platform : { OS: undefined };
} catch {
  Platform = { OS: undefined };
}

function getNodeEnv() {
  try {
    // @ts-ignore
    return typeof process !== 'undefined' && process.env && process.env.NODE_ENV;
  } catch {
    return undefined;
  }
}

export const IS_REACT_NATIVE = true;
export const IS_BROWSER = false;
export const IS_IOS = Platform.OS === 'ios';
export const IS_ANDROID = Platform.OS === 'android';
export const IS_DEV = getNodeEnv() === 'development';
export const IS_TEST = getNodeEnv() === 'test';
