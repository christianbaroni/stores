# react-native-mmkv Compatibility

`@storesjs/stores` supports [react-native-mmkv](https://github.com/mrousavy/react-native-mmkv) v2, v3, and v4. Version differences are handled transparently at runtime — no stores code changes are needed when upgrading MMKV.

| react-native-mmkv | React Native | Architecture               |
| ----------------- | ------------ | -------------------------- |
| v2.x              | >= 0.64      | JSI (old arch OK)          |
| v3.x              | >= 0.75      | C++ TurboModule (New Arch) |
| v4.x              | >= 0.75      | Nitro Modules (New Arch)   |

## How it works

The adapter in `storesStorage.native.ts` inspects the module's exports to detect the installed version. The only API differences that matter to stores are:

| Operation       | v2/v3              | v4                   |
| --------------- | ------------------ | -------------------- |
| Create instance | `new MMKV({ id })` | `createMMKV({ id })` |
| Delete key      | `.delete(key)`     | `.remove(key)`       |

All other methods (`getString`, `set`, `contains`, `getAllKeys`, `clearAll`) are unchanged across versions.

## Historical Changes

### v2 → v3

#### Breaking changes

1. **New Architecture required** — v3 is a pure C++ TurboModule. You must
   enable the React Native New Architecture (RN 0.75+). If you cannot enable
   it, stay on v2.

2. **Configuration additions** — Two new optional fields:
   - `mode?: Mode` — `Mode.SINGLE_PROCESS` (default) or `Mode.MULTI_PROCESS`
   - `readOnly?: boolean` — opens the instance in read-only mode

3. **Buffer return type** — `getBuffer()` returns `ArrayBufferLike` instead
   of `Uint8Array`.

4. **New instance properties** — `size` (readonly, bytes) and `isReadOnly`
   (readonly) were added to the instance.

5. **New method** — `trim()` trims storage space and clears memory cache.

#### Non-breaking

- Instance creation (`new MMKV(...)`) is unchanged.
- `delete(key)`, `getString(key)`, `set()`, `contains()`, `getAllKeys()`,
  `clearAll()`, `recrypt()` are all unchanged.
- All existing hooks (`useMMKVString`, `useMMKVNumber`, `useMMKVBoolean`,
  `useMMKVObject`, `useMMKVBuffer`) remain the same.

### v3 → v4

#### Breaking changes

1. **Instance creation** — `MMKV` is no longer a class. Use the factory
   function instead:

   ```diff
   - import { MMKV } from 'react-native-mmkv'
   - const storage = new MMKV({ id: 'my-app' })
   + import { createMMKV } from 'react-native-mmkv'
   + const storage = createMMKV({ id: 'my-app' })
   ```

2. **`MMKV` is a type-only export** — You can still
   `import type { MMKV }` for typing, but you cannot use `MMKV` as a value
   (constructor).

3. **`.delete()` renamed to `.remove()`** — and now returns `boolean`:

   ```diff
   - storage.delete('key')
   + storage.remove('key') // returns true if key existed
   ```

4. **Mode is now a string union** — not an enum:

   ```diff
   - import { Mode } from 'react-native-mmkv'
   - mode: Mode.MULTI_PROCESS
   + mode: 'multi-process'
   ```

5. **Encryption API** — `recrypt()` is deprecated. Use the new pair:

   ```diff
   - storage.recrypt('my-key')
   - storage.recrypt(undefined) // remove encryption
   + storage.encrypt('my-key', 'AES-256')
   + storage.decrypt()
   ```

   New config option: `encryptionType?: 'AES-128' | 'AES-256'`

6. **Buffer return type** — `getBuffer()` returns `ArrayBuffer` instead of
   `ArrayBufferLike`.

7. **Nitro Modules** — v4 uses `react-native-nitro-modules` instead of
   C++ TurboModules. Ensure your project supports Nitro.

#### New in v4

- `existsMMKV(id: string): boolean` — check if an instance exists without
  creating it.
- `deleteMMKV(id: string): boolean` — delete an instance's backing storage.
- `encrypt(key, encryptionType?)` / `decrypt()` — granular encryption control.
- `importAllFrom(other: MMKV): number` — import all keys from another instance.
- Instance properties: `length`, `byteSize`, `isEncrypted` (`size` deprecated
  in favor of `byteSize`).
- New hooks: `useMMKVListener`, `useMMKVKeys`.
