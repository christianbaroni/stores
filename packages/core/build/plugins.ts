// ============ Plugin Config ================================================== //

export type Platform = 'web' | 'native';

export const plugins = {
  chrome: ['web'],
  // delta: ['web', 'native'],
  // network: ['web', 'native'],
  // router: ['web'],
} satisfies Record<string, Platform[]>;

// ============ Path Utilities ================================================== //

export function exportKey(name: string): string {
  return `./${name}`;
}

export function outputPath(name: string, platform: Platform, esm: boolean): string {
  return `./dist/${platform}/${name}.${esm ? 'mjs' : 'js'}`;
}

export function sourcePath(name: string): string {
  return `src/plugins/${name}/index.ts`;
}

export function typesPath(name: string): string {
  return `./dist/plugins/${name}/index.d.ts`;
}
