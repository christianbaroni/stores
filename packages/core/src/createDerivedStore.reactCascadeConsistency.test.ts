/**
 * @vitest-environment happy-dom
 */

import { act, createElement } from 'react';
import type { ReactElement } from 'react';
import { flushMicrotasks } from './async.testUtils';
import { createBaseStore } from './createBaseStore';
import { createDerivedStore } from './createDerivedStore';
import { createMountedRoot } from './react.testUtils';

describe('createDerivedStore React cascade consistency', () => {
  it('mounts an object snapshot without uncached getSnapshot warnings', async () => {
    const sourceStore = createBaseStore(() => ({ value: 'a' }));
    const root = createMountedRoot();
    const renders: string[] = [];
    const messages: string[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation(message => {
      messages.push(String(message));
    });

    const derivedStore = createDerivedStore($ => ({ value: $(sourceStore).value }));

    function App(): ReactElement {
      const snapshot = derivedStore();
      renders.push(snapshot.value);
      return createElement('span', null, snapshot.value);
    }

    try {
      root.render(createElement(App));

      act(() => {
        sourceStore.setState({ value: 'b' });
      });
      await act(flushMicrotasks);

      expect(renders).toEqual(['a', 'b']);
      expect(messages.filter(message => message.includes('getSnapshot should be cached'))).toEqual([]);
    } finally {
      consoleError.mockRestore();
      root.unmount();
    }
  });
});
