import path from 'path';
import type { Plugin } from 'esbuild';
import { defineConfig } from 'tsup';
import { pluginBuildEntries, type Platform } from './build/plugins';

// ============ Constants ====================================================== //

const isProduction = process.env.NODE_ENV === 'production';
const mode = process.env.BUILD_MODE === 'vanilla' ? 'vanilla' : 'react';
const platform: Platform = mode === 'vanilla' || process.env.BUILD_TARGET !== 'native' ? 'web' : 'native';
const buildInternalRuntime = mode === 'react' && platform === 'web';

const internalRuntimeDir = path.resolve(__dirname, 'src/internal');
const runtimeSource = path.resolve(__dirname, 'src/internal/runtime.ts');

// ============ Config ========================================================= //

export default defineConfig({
  clean: true,
  dts: false,
  entry:
    mode === 'vanilla'
      ? { index: 'src/index.vanilla.ts' }
      : {
          index: 'src/index.ts',
          ...pluginBuildEntries(platform),
          ...(buildInternalRuntime ? { 'internal/runtime': 'src/internal/runtime.ts' } : undefined),
        },
  external: ['react', 'react-native', 'react-native-mmkv'],
  esbuildPlugins: platform === 'web' ? [externalizeInternalRuntimeImports()] : undefined,
  format: ['esm', 'cjs'],
  minify: isProduction ? 'terser' : false,
  silent: true,
  sourcemap: !isProduction,
  target: 'es2020',
  treeshake: true,

  esbuildOptions(options) {
    options.alias = {
      '@/env': path.resolve(__dirname, `src/env.${platform}.ts`),
      '@/storage': path.resolve(__dirname, `src/storesStorage.${platform}.ts`),
      '@/store/attachStoreHook': path.resolve(__dirname, `src/store/attachStoreHook.${mode}.ts`),
      '@/store/batchStoreNotifications': path.resolve(__dirname, `src/store/batchStoreNotifications.${platform}.ts`),
    };
    if (isProduction) {
      options.drop = ['debugger'];
      options.legalComments = 'none';
    }
  },

  terserOptions: isProduction
    ? {
        compress: {
          dead_code: true,
          drop_debugger: true,
          passes: 3,
        },
        format: { comments: false },
      }
    : undefined,
});

// ============ Utilities ====================================================== //

function externalizeInternalRuntimeImports(): Plugin {
  return {
    name: 'externalize-internal-runtime-imports',
    setup(build) {
      const extension = build.initialOptions.define?.TSUP_FORMAT === '"esm"' ? '.mjs' : '.js';
      const runtimeImport = mode === 'vanilla' ? `../web/internal/runtime${extension}` : `./internal/runtime${extension}`;

      build.onResolve({ filter: /^\.{1,2}\// }, args => {
        if (args.kind === 'entry-point') return undefined;

        const request = args.path.endsWith('.ts') ? args.path : `${args.path}.ts`;
        const resolvedPath = path.resolve(args.resolveDir, request);
        if (resolvedPath === runtimeSource) return { path: runtimeImport, external: true };

        if (!isInternalRuntimePath(args.resolveDir) && isInternalRuntimePath(resolvedPath)) {
          return {
            errors: [{ text: `Web entries must import ${path.relative(args.resolveDir, runtimeSource)} instead of ${args.path}.` }],
          };
        }
      });
    },
  };
}

function isInternalRuntimePath(filePath: string): boolean {
  const relativePath = path.relative(internalRuntimeDir, filePath);
  return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}
