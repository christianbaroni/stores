# Chrome Storage Mock Notes

This file documents the behavior we mirror from Chromium so the mock stays grounded in actual `chrome.storage` semantics.

## What counts as a change

- `chrome.storage.local`/`sync`/`managed` use `LeveldbValueStore::AddToBatch`, which reads the prior value and only records a change if `*old_value != value`. Equality is deep because `base::Value` implements `operator==` across scalars, lists, and dicts.
- Session storage uses the same check. `SessionStorageManager::ExtensionStorage::Set` exits early when the incoming value equals the existing entry.
- The mock uses `deepEqual` in `MockStorageArea.set` to keep this contract. We only mutate internal state and capture `oldValue`/`newValue` when the payload actually changes.

## When listeners fire

- Chromium dispatches `storage.onChanged` only if the backend returns a non-empty change list. `StorageFrontend::OnWriteFinished` gates on `!result.changes().empty()` before calling `OnSettingsChanged`.
- `MockStorageArea.notifyAndResolve` mirrors that guard: the microtask still resolves the caller's callback, but listeners only run when we have changes.
- Dispatch remains asynchronous. Chromium posts completion onto the UI task runner after queuing events, so the mock keeps `queueMicrotask` to match ordering.

## Payload shape

- Change events are snapshots, not live references. `ValueStoreChange::ToValue` clones values when building the change dict. Session storage does the same via `ValueChangeToValue`.
- The mock's `cloneStorageValue` function clones values on write and when building change objects so tests cannot mutate stored data in place.

## Deletes and clears

- Native storage only reports keys that existed. `LeveldbValueStore::Remove` and the session equivalent skip missing keys.
- Clearing storage emits `oldValue` for each prior entry, then wipes state.
- `MockStorageArea.remove` and `MockStorageArea.clear` follow the same rules: we gate on `hasOwnProperty`, capture the previous value, and keep empty operations silent.

## Practical implications

1. Writing equivalent data is a no-op: no listeners, no change payload.
2. Change objects are immutable snapshots. Mutating them will not reach storage.
3. Empty deletions and redundant clears do not fire.

## Sources

Chromium references:

| Behavior                 | Source                                                  |
| ------------------------ | ------------------------------------------------------- |
| Deep equality check      | [leveldb_value_store.cc] `AddToBatch` method            |
| base::Value operator==   | [base/values.h] line ~1611                              |
| Session storage equality | [session_storage_manager.cc] `ExtensionStorage::Set`    |
| Session storage remove   | [session_storage_manager.cc] `ExtensionStorage::Remove` |
| Empty changes guard      | [storage_frontend.cc] `OnWriteFinished`                 |
| Event dispatch           | [storage_frontend.cc] `OnSettingsChanged`               |
| Change value cloning     | [value_store_change.h] `ValueStoreChange::ToValue`      |
| Session change cloning   | [storage_utils.cc] `ValueChangeToValue`                 |

Sources: https://source.chromium.org/chromium/chromium/src/

- `components/value_store/leveldb_value_store.cc`
- `components/value_store/value_store_change.h`
- `extensions/browser/api/storage/session_storage_manager.cc`
- `extensions/browser/api/storage/storage_frontend.cc`
- `extensions/browser/api/storage/storage_utils.cc`
- `base/values.h`
