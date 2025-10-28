/**
 * @jest-environment node
 */

import { createHydrationGate } from '../createHydrationGate';
import { SetStateOverloads, StateCreator } from '../../types';

type TestState = { value: number; label?: string };

describe('createHydrationGate', () => {
  describe('deferred updates', () => {
    it('delays queued set calls until hydration completes', async () => {
      let gatedSet: SetStateOverloads<TestState> | undefined;
      const baseCreator: StateCreator<TestState> = set => {
        gatedSet = set;
        return { value: 0 };
      };

      const { stateCreator, wrapOnRehydrateStorage } = createHydrationGate(baseCreator);

      const calls: Array<{ update: unknown; replace: boolean | undefined }> = [];
      const setState: SetStateOverloads<TestState> = (update, replace) => {
        calls.push({ update, replace });
        return undefined;
      };
      const getState = () => ({ value: 0 });
      const api = {
        setState,
        getState,
        getInitialState: getState,
        subscribe: jest.fn(() => jest.fn()),
      };

      const initialState = stateCreator(setState, getState, api);
      expect(initialState).toEqual({ value: 0 });
      expect(gatedSet).toBeDefined();

      const pending = gatedSet?.({ value: 5 });
      expect(pending).toBeInstanceOf(Promise);
      expect(calls).toHaveLength(0);

      const rehydrate = wrapOnRehydrateStorage()(initialState);
      rehydrate();
      if (pending) await pending;

      expect(calls).toEqual([{ update: { value: 5 }, replace: undefined }]);
      calls.length = 0;

      gatedSet?.({ value: 10 });
      expect(calls).toEqual([{ update: { value: 10 }, replace: undefined }]);
    });
  });

  describe('callback sequencing', () => {
    it('invokes pre and post flush callbacks around queued updates', () => {
      let gatedSet: SetStateOverloads<TestState> | undefined;
      const baseCreator: StateCreator<TestState> = set => {
        gatedSet = set;
        return { value: 1 };
      };

      const { stateCreator, wrapOnRehydrateStorage } = createHydrationGate(baseCreator);

      const calls: Array<{ update: unknown; replace: boolean | undefined }> = [];
      const setState: SetStateOverloads<TestState> = (update, replace) => {
        calls.push({ update, replace });
        return undefined;
      };
      const getState = () => ({ value: 1 });
      const api = {
        setState,
        getState,
        getInitialState: getState,
        subscribe: jest.fn(() => jest.fn()),
      };

      const initialState = stateCreator(setState, getState, api);
      gatedSet?.({ value: 2 });

      const preFlush = jest.fn();
      const postFlush = jest.fn();
      const userCallback = jest.fn();

      const rehydrate = wrapOnRehydrateStorage(
        state => {
          userCallback(state);
          return () => userCallback('final');
        },
        preFlush,
        postFlush
      )(initialState);

      rehydrate();

      expect(preFlush).toHaveBeenCalledTimes(1);
      expect(calls).toEqual([{ update: { value: 2 }, replace: undefined }]);
      expect(postFlush).toHaveBeenCalledTimes(1);
      expect(userCallback).toHaveBeenNthCalledWith(1, initialState);
      expect(userCallback).toHaveBeenNthCalledWith(2, 'final');
    });
  });

  describe('flush ordering', () => {
    it('applies replacement updates before patches', () => {
      type ComplexState = { a?: number; b?: string };
      let gatedSet: SetStateOverloads<ComplexState> | undefined;
      const baseCreator: StateCreator<ComplexState> = set => {
        gatedSet = set;
        return { a: 0, b: 'initial' };
      };

      const { stateCreator, wrapOnRehydrateStorage } = createHydrationGate(baseCreator);

      const callOrder: Array<{ update: unknown; replace: boolean | undefined }> = [];
      const setState: SetStateOverloads<ComplexState> = (update, replace) => {
        callOrder.push({ update, replace });
        return undefined;
      };
      const getState = () => ({ a: 0, b: 'initial' });
      const api = {
        setState,
        getState,
        getInitialState: getState,
        subscribe: jest.fn(() => jest.fn()),
      };

      const initialState = stateCreator(setState, getState, api);
      gatedSet?.({ a: 10 }, true);
      gatedSet?.({ b: 'patched' });

      wrapOnRehydrateStorage()(initialState)();

      expect(callOrder).toEqual([
        { update: { a: 10 }, replace: true },
        { update: { b: 'patched' }, replace: undefined },
      ]);
    });
  });
});
