import { defineConfig } from 'tsup';

const isProduction = process.env.NODE_ENV === 'production';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  clean: true,
  dts: false,
  target: 'es2020',
  external: ['react', 'react-native', 'react-native-mmkv'],
  treeshake: true,

  // Production optimizations
  minify: isProduction ? 'terser' : false,
  sourcemap: isProduction ? false : true,

  // Environment variables
  define: {
    'process.env.NODE_ENV': JSON.stringify(isProduction ? 'production' : 'development'),
  },

  esbuildOptions(options) {
    if (isProduction) {
      options.drop = ['console', 'debugger'];
      options.legalComments = 'none';
    }
  },

  terserOptions: isProduction
    ? {
        compress: {
          drop_console: true,
          drop_debugger: true,
          passes: 2,
        },
        format: {
          comments: false,
        },
      }
    : undefined,
});
