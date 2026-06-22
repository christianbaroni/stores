import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot } from 'react-dom/client';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

export type MountedRoot = {
  container: HTMLDivElement;
  render: (element: ReactElement) => void;
  unmount: () => void;
};

export function createMountedRoot(): MountedRoot {
  const container = document.createElement('div');
  const root = createRoot(container);

  document.body.appendChild(container);

  return {
    container,
    render: element => {
      act(() => root.render(element));
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}
