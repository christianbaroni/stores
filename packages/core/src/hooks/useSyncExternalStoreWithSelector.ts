import { useDebugValue, useRef, useSyncExternalStore } from 'react';
import type { EqualityFn, Selector, SubscribeOverloads, UnsubscribeFn } from '../types';
import { noop } from '../utils/core';

// ============ Constants ====================================================== //

const EMPTY = Symbol('empty selection');

const objectIs: EqualityFn = Object.is;

// ============ Types ========================================================== //

type Empty = typeof EMPTY;

type SelectionCell<State, Value> = {
  committedEqualityFn: EqualityFn<Value>;
  committedSelector: Selector<State, Value>;
  committedSource: SubscribeOverloads<State>;
  committedValue: Value | Empty;
  equalityFn: EqualityFn<Value>;
  getSelectedServerSnapshot: () => Value;
  getSelectedSnapshot: () => Value;
  getServerStoreSnapshot?: () => State;
  getStoreSnapshot: () => State;
  latestSnapshot: State | Empty;
  latestSource: SubscribeOverloads<State> | Empty;
  selector: Selector<State, Value>;
  selectedSource: SubscribeOverloads<State>;
  selectedSubscribe: (onStoreChange: () => void) => UnsubscribeFn;
  source: SubscribeOverloads<State>;
  value: Value | Empty;
  valueEqualityFn: EqualityFn<Value>;
  valueSelector: Selector<State, Value>;
  valueSnapshot: State | Empty;
};

// ============ Hook =========================================================== //

export function useSyncExternalStoreWithSelector<State>(
  subscribe: SubscribeOverloads<State>,
  getSnapshot: () => State,
  getServerSnapshot?: (() => State) | undefined,
  selector?: undefined,
  equalityFn?: undefined
): State;

export function useSyncExternalStoreWithSelector<State, Selected>(
  subscribe: SubscribeOverloads<State>,
  getSnapshot: () => State,
  getServerSnapshot: (() => State) | undefined,
  selector: Selector<State, Selected>,
  equalityFn?: EqualityFn<Selected>
): Selected;

export function useSyncExternalStoreWithSelector<State, Selected>(
  subscribe: SubscribeOverloads<State>,
  getSnapshot: () => State,
  getServerSnapshot: (() => State) | undefined,
  selector: Selector<State, Selected> | undefined,
  equalityFn?: EqualityFn<Selected>
): State | Selected;

export function useSyncExternalStoreWithSelector<State, Selected>(
  subscribe: SubscribeOverloads<State>,
  getSnapshot: () => State,
  getServerSnapshot?: (() => State) | undefined,
  selector?: Selector<State, Selected>,
  equalityFn: EqualityFn<Selected> = objectIs
): State | Selected {
  const cellRef = useRef<SelectionCell<State, Selected> | null>(null);

  let subscribeToStore: (onStoreChange: () => void) => UnsubscribeFn = subscribe;
  let readSnapshot: () => State | Selected = getSnapshot;
  let readServerSnapshot: (() => State | Selected) | undefined = getServerSnapshot;

  if (selector) {
    let cell = cellRef.current;
    if (cell === null) {
      cell = createSelectionCell(subscribe, getSnapshot, getServerSnapshot, selector, equalityFn);
      cellRef.current = cell;
    }

    updateSelectionCell(cell, subscribe, getSnapshot, getServerSnapshot, selector, equalityFn);

    subscribeToStore = cell.selectedSubscribe;
    readSnapshot = cell.getSelectedSnapshot;
    readServerSnapshot = getServerSnapshot === undefined ? undefined : cell.getSelectedServerSnapshot;
  }

  const value = useSyncExternalStore(subscribeToStore, readSnapshot, readServerSnapshot);

  useDebugValue(value);
  return value;
}

// ============ Selection ====================================================== //

function createSelectionCell<State, Value>(
  source: SubscribeOverloads<State>,
  getStoreSnapshot: () => State,
  getServerStoreSnapshot: (() => State) | undefined,
  selector: Selector<State, Value>,
  equalityFn: EqualityFn<Value>
): SelectionCell<State, Value> {
  const cell: SelectionCell<State, Value> = {
    committedEqualityFn: equalityFn,
    committedSelector: selector,
    committedSource: source,
    committedValue: EMPTY,
    equalityFn,
    getSelectedServerSnapshot: () => readSelectedServerSnapshot(cell),
    getSelectedSnapshot: () => readSelectedSnapshot(cell),
    getServerStoreSnapshot,
    getStoreSnapshot,
    latestSnapshot: EMPTY,
    latestSource: EMPTY,
    selector,
    selectedSource: source,
    selectedSubscribe: () => noop,
    source,
    value: EMPTY,
    valueEqualityFn: equalityFn,
    valueSelector: selector,
    valueSnapshot: EMPTY,
  };

  cell.selectedSubscribe = createSelectionSubscribe(cell, source);

  return cell;
}

function updateSelectionCell<State, Value>(
  cell: SelectionCell<State, Value>,
  source: SubscribeOverloads<State>,
  getStoreSnapshot: () => State,
  getServerStoreSnapshot: (() => State) | undefined,
  selector: Selector<State, Value>,
  equalityFn: EqualityFn<Value>
): void {
  if (cell.source !== source || cell.getStoreSnapshot !== getStoreSnapshot) cell.latestSnapshot = EMPTY;

  cell.source = source;
  cell.getStoreSnapshot = getStoreSnapshot;
  cell.getServerStoreSnapshot = getServerStoreSnapshot;
  cell.selector = selector;
  cell.equalityFn = equalityFn;

  if (cell.selectedSource === source) return;

  cell.selectedSource = source;
  cell.selectedSubscribe = createSelectionSubscribe(cell, source);
}

function createSelectionSubscribe<State, Value>(
  cell: SelectionCell<State, Value>,
  source: SubscribeOverloads<State>
): (onStoreChange: () => void) => UnsubscribeFn {
  return onStoreChange => {
    commitSelection(cell);

    return source(snapshot => {
      cell.latestSnapshot = snapshot;
      cell.latestSource = source;

      const previousValue = cell.committedValue;
      if (previousValue === EMPTY || cell.committedSource !== source) {
        onStoreChange();
        return;
      }

      const selector = cell.committedSelector;
      const equalityFn = cell.committedEqualityFn;

      if (cell.selector === selector && cell.equalityFn === equalityFn) {
        const nextValue = selector(snapshot);
        const isEqual = equalityFn === objectIs ? objectIs(previousValue, nextValue) : equalityFn(previousValue, nextValue);
        if (isEqual) return;

        cell.committedValue = nextValue;
        cell.value = nextValue;
        cell.valueEqualityFn = equalityFn;
        cell.valueSelector = selector;
        cell.valueSnapshot = snapshot;
        onStoreChange();
        return;
      }

      if (cell.source !== source) {
        onStoreChange();
        return;
      }

      const value = cell.value;
      if (value === EMPTY) return;

      const currentValue = cell.selector(snapshot);
      const isEqual = cell.equalityFn(value, currentValue);

      cell.committedEqualityFn = cell.equalityFn;
      cell.committedSelector = cell.selector;
      cell.committedValue = rememberSelection(cell, snapshot, isEqual ? value : currentValue);

      if (!isEqual) onStoreChange();
    });
  };
}

function readSelectedSnapshot<State, Value>(cell: SelectionCell<State, Value>): Value {
  const snapshot = readStoreSnapshot(cell);
  return selectSnapshot(cell, snapshot);
}

function readSelectedServerSnapshot<State, Value>(cell: SelectionCell<State, Value>): Value {
  const getSnapshot = cell.getServerStoreSnapshot ?? cell.getStoreSnapshot;
  return selectSnapshot(cell, getSnapshot());
}

function selectSnapshot<State, Value>(cell: SelectionCell<State, Value>, snapshot: State): Value {
  const value = cell.value;

  if (
    value !== EMPTY &&
    objectIs(cell.valueSnapshot, snapshot) &&
    cell.valueSelector === cell.selector &&
    cell.valueEqualityFn === cell.equalityFn
  ) {
    return value;
  }

  const nextValue = cell.selector(snapshot);
  if (value !== EMPTY) {
    const isEqual = cell.equalityFn === objectIs ? objectIs(value, nextValue) : cell.equalityFn(value, nextValue);
    if (isEqual) return rememberSelection(cell, snapshot, value);
  }

  const committedValue = cell.committedValue;
  if (
    committedValue !== EMPTY &&
    committedValue !== value &&
    cell.committedSource === cell.source &&
    (cell.equalityFn === objectIs ? objectIs(committedValue, nextValue) : cell.equalityFn(committedValue, nextValue))
  ) {
    return rememberSelection(cell, snapshot, committedValue);
  }

  return rememberSelection(cell, snapshot, nextValue);
}

function readStoreSnapshot<State, Value>(cell: SelectionCell<State, Value>): State {
  if (cell.latestSource === cell.source && cell.latestSnapshot !== EMPTY) return cell.latestSnapshot;

  const snapshot = cell.getStoreSnapshot();
  cell.latestSnapshot = snapshot;
  cell.latestSource = cell.source;
  return snapshot;
}

function rememberSelection<State, Value>(cell: SelectionCell<State, Value>, snapshot: State, value: Value): Value {
  cell.value = value;
  cell.valueEqualityFn = cell.equalityFn;
  cell.valueSelector = cell.selector;
  cell.valueSnapshot = snapshot;
  return value;
}

function commitSelection<State, Value>(cell: SelectionCell<State, Value>): void {
  cell.committedEqualityFn = cell.equalityFn;
  cell.committedSelector = cell.selector;
  cell.committedSource = cell.source;
  cell.committedValue = cell.value === EMPTY ? readSelectedSnapshot(cell) : cell.value;
}
