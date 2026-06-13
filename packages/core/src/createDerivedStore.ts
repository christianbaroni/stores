import { attachStoreHook } from '@/store/attachStoreHook';
import { derivedStore } from './internal/runtime';
import type { DeriveGetter, DeriveOptions, DerivedStore } from './types';

// ============ Store Creator ================================================== //

/**
 * ### `createDerivedStore`
 *
 * Creates a **read-only** store derived from one or more source stores.
 *
 * ---
 * The `deriveFunction` is called whenever its dependencies change, producing a new derived state.
 * Dependencies are automatically tracked through a special `$` helper, which supports:
 *
 * 1) **Selector-based** usage:
 *    ```ts
 *    $ => {
 *      const user = $(useUserStore, s => s.user, shallowEqual);
 *      const theme = $(useSettingsStore, s => s.appearance.theme);
 *      return { user, theme, isAdmin: user?.roles.includes('admin') };
 *    }
 *    ```
 *
 * 2) **Proxy-based** usage (auto-built selectors for nested properties):
 *    ```ts
 *    $ => {
 *      const { user } = $(useUserStore); // Subscribe to `user`
 *      const theme = $(useSettingsStore).appearance.theme; // Subscribe to `theme`
 *      return { isAdmin: user?.roles.includes('admin'), theme, user };
 *    }
 *    ```
 *
 * ---
 * Derived stores automatically unsubscribe from all dependencies when no consumers remain, and
 * resubscribe when new consumers appear. The returned store exposes:
 *
 * - A **store object** with `getState()`, `subscribe()`, and `destroy()`
 * - In the React build, a **React hook** (`const state = derivedStore(selector, equalityFn?)`)
 *
 * ---
 * You can optionally pass a second parameter (either an equality function or a config object)
 * to enable debouncing, customize the equality function, or set `lockDependencies: true`.
 *
 * (When dependencies are locked, subscriptions created via `$` are established once and are
 * not rebuilt on subsequent re-derives, which can be a performance win for certain workloads.)
 *
 * ---
 * @example
 * ```ts
 * // Create a derived store
 * const searchResultsStore = createDerivedStore($ => {
 *   const query = $(searchStore).query.trim().toLowerCase();
 *   const items = $(itemsStore).items;
 *   return findResults(query, items);
 * }, shallowEqual);
 *
 * const results = searchResultsStore.getState();
 * ```
 *
 * ---
 * @param deriveFunction - Function that reads from other stores via `$` to produce derived state.
 * @param optionsOrEqualityFn - Either an equality function or a config object (see `DeriveOptions`).
 *
 * @returns A read-only derived store. In the React build, it is also callable as a hook.
 */
export function createDerivedStore<Derived>(
  deriveFunction: ($: DeriveGetter) => Derived,
  optionsOrEqualityFn: DeriveOptions<Derived> = Object.is
): DerivedStore<Derived> {
  const store = derivedStore(deriveFunction, optionsOrEqualityFn);
  return attachStoreHook(store, store.getSnapshot);
}
