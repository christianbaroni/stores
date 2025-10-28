import { useLayoutEffect } from 'react';

export function usePageBackground(color: string): void {
  useLayoutEffect(() => {
    setPageBackground(color);
  }, [color]);
}

function getOrCreateThemeColorMeta(): HTMLMetaElement {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  return meta;
}

function setPageBackground(color: string): void {
  document.body.style.backgroundColor = color;
  getOrCreateThemeColorMeta().setAttribute('content', color);
}
