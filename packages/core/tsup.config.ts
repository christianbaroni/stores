import { defineConfig } from 'tsup';
import { Platform, plugins, sourcePath } from './build/plugins';

const isProduction = process.env.NODE_ENV === 'production';
const platform: Platform = process.env.BUILD_TARGET === 'native' ? 'native' : 'web';

const pluginEntries = Object.fromEntries(
  Object.entries<Platform[]>(plugins)
    .filter(([, platforms]) => platforms.includes(platform))
    .map(([name]) => [name, sourcePath(name)])
);

export default defineConfig({
  clean: true,
  define: { 'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development') },
  dts: false,
  entry: { index: 'src/index.ts', ...pluginEntries },
  external: ['react', 'react-native', 'react-native-mmkv'],
  format: ['esm', 'cjs'],
  minify: isProduction ? 'terser' : false,
  silent: true,
  sourcemap: !isProduction,
  target: 'es2020',
  treeshake: true,

  esbuildOptions(options) {
    options.alias = {
      env: `./src/env.${platform}.ts`,
      storage: `./src/storesStorage.${platform}.ts`,
    };
    if (isProduction) {
      options.drop = ['console', 'debugger'];
      options.legalComments = 'none';
    }
  },

  terserOptions: isProduction
    ? {
        compress: {
          dead_code: true,
          drop_console: true,
          drop_debugger: true,
          passes: 3,
          pure_funcs: ['console.debug', 'console.info', 'console.warn'],
        },
        format: { comments: false },
      }
    : undefined,
});
