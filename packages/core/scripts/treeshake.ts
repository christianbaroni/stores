#!/usr/bin/env tsx
import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { bold, detail, failureSummary, row, summary, write } from '@/cli';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const mjsEntries = readdirSync(join(root, 'dist/web'))
  .filter(f => f.endsWith('.mjs') && !f.startsWith('chunk-'))
  .map(f => f.replace('.mjs', ''));

const externals = ['react', 'react-native', 'zustand', 'use-sync-external-store'].map(e => `--external:${e}`).join(' ');

let passed = 0;
let failed = 0;

write(`${bold('treeshake:test')}\n\n`);

for (const entry of mjsEntries) {
  const file = join(root, `dist/web/${entry}.mjs`);
  const cmd = `echo "import '${file}'" | npx esbuild --bundle ${externals} --minify 2>/dev/null`;

  try {
    const output = execSync(cmd, { encoding: 'utf-8' }).trim();
    const isEmpty = output === '' || output === '(()=>{})();' || output === '"use strict";(()=>{})();';

    if (isEmpty) {
      write(`${row(entry)}\n`);
      passed++;
    } else {
      write(`${row(entry, { success: false })}\n`);
      write(`${detail(output.slice(0, 100) + (output.length > 100 ? '...' : ''))}\n`);
      failed++;
    }
  } catch {
    write(`${row(entry, { success: false })} (error)\n`);
    failed++;
  }
}

if (failed > 0) {
  write(`${failureSummary(passed, failed)}\n`);
  process.exit(1);
} else {
  write(`${summary('treeshake:test', { detail: 'esbuild' })}\n`);
}
