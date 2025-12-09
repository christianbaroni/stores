import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  const app = process.env.APP || 'example'; // Default to 'example' app
  const appRoot = path.resolve(__dirname, 'src/apps', app);
  const publicDir = path.resolve(__dirname, 'public', app);

  return {
    root: __dirname,
    publicDir,
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
      react(),
      {
        name: 'move-html-files',
        closeBundle() {
          const distDir = path.resolve(__dirname, 'dist', app);
          const popupHtml = path.join(distDir, `src/apps/${app}/popup/index.html`);
          const optionsHtml = path.join(distDir, `src/apps/${app}/options/index.html`);

          if (fs.existsSync(popupHtml)) {
            fs.copyFileSync(popupHtml, path.join(distDir, 'popup.html'));
          }
          if (fs.existsSync(optionsHtml)) {
            fs.copyFileSync(optionsHtml, path.join(distDir, 'options.html'));
          }

          // Clean up the src directory
          const srcDir = path.join(distDir, 'src');
          if (fs.existsSync(srcDir)) {
            fs.rmSync(srcDir, { recursive: true, force: true });
          }
        },
      },
    ],
    build: {
      outDir: `dist/${app}`,
      emptyOutDir: true,
      sourcemap: false,
      rollupOptions: {
        input: {
          popup: path.resolve(appRoot, 'popup/index.html'),
          options: path.resolve(appRoot, 'options/index.html'),
          background: path.resolve(appRoot, 'background/index.ts'),
        },
        output: {
          entryFileNames: chunk => (chunk.name === 'background' ? 'background.js' : 'assets/[name].js'),
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
});
