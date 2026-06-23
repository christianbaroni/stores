import { Platform } from 'react-native';

export const IS_REACT_NATIVE = true;
export const IS_BROWSER = false;
export const IS_IOS: boolean = Platform.OS === 'ios';
export const IS_ANDROID: boolean = Platform.OS === 'android';
export const IS_DEV: boolean = process.env.NODE_ENV === 'development';
export const IS_TEST: boolean = process.env.NODE_ENV === 'test';
