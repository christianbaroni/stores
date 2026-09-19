import type { StoreApi } from '../../store/types';
import { hasCascadeStateSubscription, SUBSCRIBE_CASCADE_STATE } from '../../store/internalSubscriptions';
import { identity } from '../../utils/core';
import type { InternalUnsubscribeFn } from '../types/internalSubscribeTypes';

// ============ Types ========================================================== //

type SelectorUnsubscribes = InternalUnsubscribeFn | InternalUnsubscribeFn[] | undefined;

type StateDependency = {
  revision: number;
  unsubscribe: InternalUnsubscribeFn;
};

/** Shared options for dependency subscriptions that participate in cascade propagation. */
export const CASCADE_PARTICIPANT_SUBSCRIBE_OPTIONS = Object.freeze({
  equalityFn: Object.is,
  isCascadeParticipant: true,
});

// ============ Dependency Subscriptions ======================================= //

/**
 * Owns subscriptions created while a derived store reads its dependencies.
 * Selector subscriptions are rebuilt eagerly; whole-state subscriptions are
 * retained by revision so stable primitive dependencies do not churn.
 */
export class DependencySubscriptions {
  private selectorUnsubscribes: SelectorUnsubscribes;

  private stateDependencyRevisionStamp = 0;
  private stateDependencyStore: object | undefined;
  private stateDependencyUnsubscribe: InternalUnsubscribeFn | undefined;
  private stateDependencies: Map<object, StateDependency> | undefined;
  private stateDependencyRevision = 0;

  constructor(private readonly invalidate: () => void) {}

  /** Starts a dependency rebuild, clearing selectors and advancing the state-dependency revision. */
  beginRebuild(skipAbortFetch?: boolean): void {
    this.clearSelectors(skipAbortFetch);
    this.stateDependencyRevision += 1;
  }

  /** Records an explicit-selector subscription for the current dependency generation. */
  addSelector(unsubscribe: InternalUnsubscribeFn): void {
    const current = this.selectorUnsubscribes;
    if (!current) {
      this.selectorUnsubscribes = unsubscribe;
      return;
    }

    if (typeof current === 'function') {
      this.selectorUnsubscribes = [current, unsubscribe];
      return;
    }

    current.push(unsubscribe);
  }

  /** Retains a whole-state dependency in the current revision, subscribing only when newly observed. */
  retainState<State>(store: StoreApi<State>): void {
    const dependencies = this.stateDependencies;
    if (dependencies) {
      const existing = dependencies.get(store);
      if (existing) {
        existing.revision = this.stateDependencyRevision;
        return;
      }
      dependencies.set(store, this.createStateDependency(store));
      return;
    }

    const existingStore = this.stateDependencyStore;
    if (!existingStore) {
      this.stateDependencyStore = store;
      this.stateDependencyRevisionStamp = this.stateDependencyRevision;
      this.stateDependencyUnsubscribe = this.subscribeState(store);
      return;
    }

    if (existingStore === store) {
      this.stateDependencyRevisionStamp = this.stateDependencyRevision;
      return;
    }

    const existingUnsubscribe = this.stateDependencyUnsubscribe;
    this.stateDependencyStore = undefined;
    this.stateDependencyUnsubscribe = undefined;
    this.stateDependencies = new Map();

    if (existingUnsubscribe) {
      this.stateDependencies.set(existingStore, {
        revision: this.stateDependencyRevisionStamp,
        unsubscribe: existingUnsubscribe,
      });
    }
    this.stateDependencies.set(store, this.createStateDependency(store));
  }

  /** Removes whole-state dependencies not observed in the current rebuild. */
  finishRebuild(skipAbortFetch?: boolean): void {
    if (this.stateDependencyStore && this.stateDependencyRevisionStamp !== this.stateDependencyRevision) {
      this.stateDependencyUnsubscribe?.(skipAbortFetch);
      this.stateDependencyStore = undefined;
      this.stateDependencyUnsubscribe = undefined;
    }

    const dependencies = this.stateDependencies;
    if (!dependencies) return;

    for (const entry of dependencies) {
      const dependency = entry[1];
      if (dependency.revision === this.stateDependencyRevision) continue;
      dependency.unsubscribe(skipAbortFetch);
      dependencies.delete(entry[0]);
    }

    if (!dependencies.size) {
      this.stateDependencies = undefined;
      return;
    }

    if (dependencies.size !== 1) return;

    for (const entry of dependencies) {
      this.stateDependencyStore = entry[0];
      this.stateDependencyRevisionStamp = entry[1].revision;
      this.stateDependencyUnsubscribe = entry[1].unsubscribe;
      break;
    }
    this.stateDependencies = undefined;
  }

  /** Unsubscribes every dependency while retaining this reusable owner. */
  clear(skipAbortFetch?: boolean): void {
    this.clearSelectors(skipAbortFetch);
    this.stateDependencyUnsubscribe?.(skipAbortFetch);
    this.stateDependencyStore = undefined;
    this.stateDependencyUnsubscribe = undefined;

    const dependencies = this.stateDependencies;
    if (!dependencies) return;
    for (const entry of dependencies) entry[1].unsubscribe(skipAbortFetch);
    this.stateDependencies = undefined;
  }

  /** Number of active dependency subscriptions, used only by debug reporting. */
  get size(): number {
    const selectors = this.selectorUnsubscribes;
    const selectorCount = typeof selectors === 'function' ? 1 : (selectors?.length ?? 0);
    return selectorCount + (this.stateDependencyStore ? 1 : 0) + (this.stateDependencies?.size ?? 0);
  }

  private clearSelectors(skipAbortFetch?: boolean): void {
    const current = this.selectorUnsubscribes;
    this.selectorUnsubscribes = undefined;
    if (!current) return;

    if (typeof current === 'function') {
      current(skipAbortFetch);
      return;
    }

    for (let i = 0; i < current.length; i++) current[i](skipAbortFetch);
  }

  private createStateDependency<State>(store: StoreApi<State>): StateDependency {
    return { revision: this.stateDependencyRevision, unsubscribe: this.subscribeState(store) };
  }

  private subscribeState<State>(store: StoreApi<State>): InternalUnsubscribeFn {
    return hasCascadeStateSubscription(store)
      ? store[SUBSCRIBE_CASCADE_STATE](this.invalidate)
      : store.subscribe(identity, this.invalidate, CASCADE_PARTICIPANT_SUBSCRIBE_OPTIONS);
  }
}
