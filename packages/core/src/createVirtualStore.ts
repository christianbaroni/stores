import { attachStoreHook } from '#store/attachStoreHook';
import { virtualStore } from './internal/runtime';
import type {
  BaseStore,
  DeriveGetter,
  DeriveOptions,
  InferPersistedState,
  InferSetStateReturn,
  InferStoreState,
  OptionallyPersistedStore,
} from './types';

type MethodOverrides<Store extends BaseStore<unknown>> = Partial<Pick<Store, 'getState' | 'setState'>>;

type VirtualStore<Store extends BaseStore<unknown>> = OptionallyPersistedStore<
  InferStoreState<Store>,
  InferPersistedState<Store>,
  InferSetStateReturn<Store>
>;

type VirtualStoreOptions = {
  debugMode?: boolean;
  /**
   * Whether to lock dependencies (see: {@link DeriveOptions}) for the virtual store.
   * @default true
   */
  lockDependencies?: boolean;
};

/**
 * ### `createVirtualStore`
 *
 * Returns a stable store interface backed by different store instances over time.
 * When dependencies change, the derive function runs and creates a new store, then
 * all subscriptions rebind automatically. Only depend on state that should trigger
 * new store creation.
 *
 * ---
 * 💡 **Note:** `lockDependencies` (see: {@link DeriveOptions}) is enabled by default.
 * Ensure that any `$` dependencies in your `createStore` function are called
 * consistently. If they are not, set `lockDependencies` to `false`.
 *
 * ---
 * @param createStore - Derive function that returns a store instance
 * @param overrides - Optional method overrides (e.g., `getState(id?: string)`)
 *
 * @example
 * ```ts
 * const useUserAssetsStore = createVirtualStore($ => {
 *   const address = $(useWalletsStore).accountAddress;
 *   return createUserAssetsStore(address);
 * });
 * ```
 */
export function createVirtualStore<Store extends BaseStore<InferStoreState<Store>>>(
  createStore: ($: DeriveGetter) => Store,
  options?: VirtualStoreOptions
): VirtualStore<Store>;

export function createVirtualStore<Store extends BaseStore<InferStoreState<Store>>, Overrides extends MethodOverrides<Store>>(
  createStore: ($: DeriveGetter) => Store,
  overrides: (getStore: () => Store) => Overrides,
  options?: VirtualStoreOptions
): VirtualStore<Store> & Overrides;

export function createVirtualStore<
  Store extends BaseStore<InferStoreState<Store>>,
  Overrides extends MethodOverrides<Store> = Record<string, never>,
>(
  createStore: ($: DeriveGetter) => Store,
  overridesOrOptions?: VirtualStoreOptions | ((getStore: () => Store) => Overrides),
  options?: VirtualStoreOptions
): OptionallyPersistedStore<InferStoreState<Store>, InferPersistedState<Store>, void | Promise<void>> & Overrides {
  const store = virtualStore(createStore, overridesOrOptions, options);
  return attachStoreHook(store, store.getState, store.getInitialState);
}
