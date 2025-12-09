import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [
    {
      enforce: 'pre',
      name: 'stores-web-shims',
      resolveId(source, importer) {
        if (!importer) return null;
        if (!importer.includes(`${path.sep}core${path.sep}src${path.sep}`)) return null;
        if (source === '@env' || source === './env' || source === '../env') {
          return path.resolve(__dirname, '../core/src/env.web.ts');
        }
        if (source === './storesStorage' || source === '../storesStorage') {
          return path.resolve(__dirname, '../core/src/storesStorage.web.ts');
        }
        return null;
      },
    },
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler', { target: '19' }]],
      },
    }),
  ],
  server: { port: 3000 },
});
