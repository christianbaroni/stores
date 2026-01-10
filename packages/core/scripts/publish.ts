#!/usr/bin/env tsx
import { execSync } from 'child_process';
import { readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { bold, confirm, dim, exec, formatSize, formatTime, green, handleError, info, step, Symbol, write } from '@/cli';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skipConfirm = process.argv.includes('--yes') || process.argv.includes('-y');

publish().catch(handleError);

async function publish(): Promise<void> {
  const start = Date.now();
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));

  write(`\n${bold(pkg.name)} ${dim(`v${pkg.version}`)}\n\n`);

  step('build', () => exec('tsx scripts/build.ts', root));
  step('test', () => exec('pnpm run test', root));

  write(`\n${info(`Package size: ${formatSize(getDirectorySize(join(root, 'dist')))}`)}\n`);
  write(`${info('Files: dist/, README.md, LICENSE')}\n\n`);

  if (!skipConfirm) {
    const confirmed = await confirm(`  Publish v${pkg.version} to npm?`);
    if (!confirmed) {
      write(`\n${info('Cancelled')}\n\n`);
      process.exit(0);
    }
    write('\n');
  }

  step('publish', () => execSync('pnpm publish --access public', { cwd: root, stdio: 'inherit' }));

  write(`\n  ${green(Symbol.Check)} ${dim(`Published in ${formatTime(Date.now() - start)}`)}\n\n`);
}

function getDirectorySize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? getDirectorySize(path) : statSync(path).size;
  }
  return total;
}
