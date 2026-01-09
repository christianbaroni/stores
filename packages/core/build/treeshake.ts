#!/usr/bin/env tsx
import { execSync } from 'child_process';
import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { Text } from './cli';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const mjsEntries = readdirSync(join(root, 'dist/web'))
  .filter(f => f.endsWith('.mjs') && !f.startsWith('chunk-'))
  .map(f => f.replace('.mjs', ''));

const externals = ['react', 'react-native', 'zustand', 'use-sync-external-store'].map(e => `--external:${e}`).join(' ');

let passed = 0;
let failed = 0;

console.log(`${Text.Bold}treeshake:test${Text.Reset}\n`);

for (const entry of mjsEntries) {
  const file = join(root, `dist/web/${entry}.mjs`);
  const cmd = `echo "import '${file}'" | npx esbuild --bundle ${externals} --minify 2>/dev/null`;

  try {
    const output = execSync(cmd, { encoding: 'utf-8' }).trim();
    const isEmpty = output === '' || output === '(()=>{})();' || output === '"use strict";(()=>{})();';

    if (isEmpty) {
      console.log(`  ${Text.Green}✓${Text.Reset} ${entry}`);
      passed++;
    } else {
      console.log(`  ${Text.Red}✗${Text.Reset} ${entry}`);
      console.log(`    ${Text.Dim}${output.slice(0, 100)}${output.length > 100 ? '...' : ''}${Text.Reset}`);
      failed++;
    }
  } catch {
    console.log(`  ${Text.Red}✗${Text.Reset} ${entry} (error)`);
    failed++;
  }
}

if (failed > 0) {
  console.log(`\n  ${Text.Red}✗${Text.Reset} ${passed} passed, ${failed} failed\n`);
  process.exit(1);
} else {
  console.log(`\n  ${Text.Green}✓ ${'treeshake:test'.padEnd(8)}${Text.Reset} ${Text.Dim}· esbuild${Text.Reset}\n`);
}
