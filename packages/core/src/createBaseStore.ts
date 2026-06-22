import { attachStoreHook } from '#store/attachStoreHook';
import { baseStore } from './internal/runtime';
import type { BaseStoreOptions, OptionallyPersistedStore, Store, StateCreator } from './types';

/**
 * Creates a base store without persistence.
 * @param createState - The state creator function for the base store.
 * @returns A store with the specified state.
 */
export function createBaseStore<S>(createState: StateCreator<S>): Store<S>;

/**
 * Creates a base store with persistence.
 * @param createState - The state creator function for the base store.
 * @param options - The configuration options for persistence and sync.
 * @returns A store with the specified state and persistence.
 */
export function createBaseStore<S, PersistedState extends Partial<S> = Partial<S>, PersistReturn extends void = void>(
  createState: StateCreator<S>,
  options: BaseStoreOptions<S, PersistedState, PersistReturn>
): Store<S, PersistedState, PersistReturn>;

/**
 * Creates a base store with async persistence.
 * @param createState - The state creator function for the base store.
 * @param options - The configuration options for persistence and sync.
 * @returns A store with the specified state and persistence.
 */
export function createBaseStore<S, PersistedState extends Partial<S> = Partial<S>, PersistReturn extends Promise<void> = Promise<void>>(
  createState: StateCreator<S>,
  options: BaseStoreOptions<S, PersistedState, PersistReturn>
): Store<S, PersistedState, PersistReturn>;

/**
 * Creates a base store with optional persistence.
 * @param createState - The state creator function for the base store.
 * @param options - The configuration options for persistence and sync.
 * @returns A store with the specified state and optional persistence.
 */
export function createBaseStore<S, PersistedState extends Partial<S> = Partial<S>, PersistReturn extends void = void>(
  createState: StateCreator<S>,
  options?: BaseStoreOptions<S, PersistedState, PersistReturn>
): OptionallyPersistedStore<S, PersistedState, PersistReturn>;

/**
 * Creates a base store with optional async persistence.
 * @param createState - The state creator function for the base store.
 * @param options - The configuration options for persistence and sync.
 * @returns A store with the specified state and optional persistence.
 */
export function createBaseStore<S, PersistedState extends Partial<S> = Partial<S>, PersistReturn extends Promise<void> = Promise<void>>(
  createState: StateCreator<S>,
  options?: BaseStoreOptions<S, PersistedState, PersistReturn>
): OptionallyPersistedStore<S, PersistedState, PersistReturn>;

/**
 * Creates a base store with optional persistence and sync.
 * @param createState - The state creator function for the base store.
 * @param options - The configuration options for persistence and sync.
 * @returns A store with the specified state and optional persistence.
 */
export function createBaseStore<S, PersistedState extends Partial<S>, PersistReturn extends void | Promise<void>>(
  createState: StateCreator<S>,
  options?: BaseStoreOptions<S, PersistedState, PersistReturn>
): Store<S> | Store<S, PersistedState, PersistReturn> {
  const store = baseStore(createState, options);
  return attachStoreHook(store, store.getState, store.getInitialState, Object.is);
}
