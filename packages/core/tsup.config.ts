import path from 'path';
import { defineConfig } from 'tsup';
import { pluginBuildEntries, type Platform } from './build/plugins';

const isProduction = process.env.NODE_ENV === 'production';
const mode = process.env.BUILD_MODE === 'vanilla' ? 'vanilla' : 'react';
const platform: Platform = mode === 'vanilla' || process.env.BUILD_TARGET !== 'native' ? 'web' : 'native';

export default defineConfig({
  clean: true,
  dts: false,
  entry: mode === 'vanilla' ? { index: 'src/index.vanilla.ts' } : { index: 'src/index.ts', ...pluginBuildEntries(platform) },
  external: ['react', 'react-native', 'react-native-mmkv'],
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
