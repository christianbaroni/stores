#!/usr/bin/env tsx
import { exec } from 'child_process';
import { copyFileSync, readdirSync, rmSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { bold, formatSize, handleError, spinner, summary, timedRow, write } from '@/cli';
import { plugins } from '../build/plugins';

const execAsync = promisify(exec);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

build().catch(err => {
  write(summary('build', { success: false }));
  handleError(err);
});

async function build(): Promise<void> {
  const start = performance.now();

  rmSync(join(root, 'dist'), { recursive: true, force: true });
  copyFilesFromRoot(['LICENSE', 'README.md']);

  write(`${bold('stores')}\n`);
  const spin = spinner(' exports · types · web · native');
  write('\n');

  const [exports, types, web, native] = await Promise.all([
    timed(() => execAsync('tsx scripts/generate-exports.ts', { cwd: root })),
    timed(() => execAsync('tsc -p tsconfig.build.json --emitDeclarationOnly', { cwd: root })),
    buildPlatform('web'),
    buildPlatform('native'),
  ]).finally(spin.stop);

  write(
    timedRow('exports', exports.time),
    timedRow('types', types.time),
    timedRow('web', web.time, bundleSummary('dist/web')),
    timedRow('native', native.time, bundleSummary('dist/native')),
    summary('build', { time: performance.now() - start })
  );
}

async function buildPlatform(platform: 'web' | 'native'): Promise<{ time: number }> {
  const start = performance.now();
  const env = { ...process.env, NODE_ENV: 'production', ...(platform === 'native' && { BUILD_TARGET: 'native' }) };
  await execAsync(`tsup --config tsup.config.ts --out-dir dist/${platform}`, { cwd: root, env });
  return { time: performance.now() - start };
}

async function timed<T>(fn: () => Promise<T>): Promise<{ time: number; result: T }> {
  const start = performance.now();
  const result = await fn();
  return { time: performance.now() - start, result };
}

function bundleSummary(dir: string): string {
  const fullPath = join(root, dir);
  const files = readdirSync(fullPath);
  const getSize = (name: string) => (files.includes(`${name}.mjs`) ? statSync(join(fullPath, `${name}.mjs`)).size : 0);
  const coreSize = getSize('index');
  const pluginsSize = Object.keys(plugins).reduce((sum, name) => sum + getSize(name), 0);
  return `${formatSize(coreSize + pluginsSize)} · core ${formatSize(coreSize)} · plugins ${formatSize(pluginsSize)}`;
}

function copyFilesFromRoot(files: string[]): void {
  for (const file of files) {
    copyFileSync(join(root, '../..', file), join(root, file));
  }
}
