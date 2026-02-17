declare module 'react-native-mmkv' {
  export type MMKVConfiguration = { id: string };

  export type MMKVInstance = {
    clearAll(): void;
    contains(key: string): boolean;
    delete?(key: string): void;
    getAllKeys(): string[];
    getString(key: string): string | undefined;
    remove?(key: string): boolean | void;
    set(key: string, value: string | number | boolean | Uint8Array | ArrayBuffer): void;
  };

  export const MMKV: (new (options: MMKVConfiguration) => MMKVInstance) | undefined;
  export function createMMKV(options?: MMKVConfiguration): MMKVInstance;
}
