#!/usr/bin/env tsx
import { exec } from 'child_process';
import { copyFileSync, readdirSync, rmSync, statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { bold, formatSize, handleError, spinner, summary, timedRow, write } from '@/cli';
import { disabledPluginTypeRoots, pluginBuildEntries, type Platform } from '../build/plugins';

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
    timed(() => execAsync('tsx --tsconfig scripts/tsconfig.json scripts/generate-exports.ts', { cwd: root })),
    buildTypes(),
    buildPlatform('web'),
    buildPlatform('native'),
  ]).finally(spin.stop);

  write(
    timedRow('exports', exports.time),
    timedRow('types', types.time),
    timedRow('web', web.time, bundleSummary('web')),
    timedRow('native', native.time, bundleSummary('native')),
    summary('build', { time: performance.now() - start })
  );
}

async function buildTypes(): Promise<{ time: number }> {
  const start = performance.now();
  await execAsync('tsc -p tsconfig.build.json --emitDeclarationOnly', { cwd: root });
  removeDisabledPluginTypes();
  return { time: performance.now() - start };
}

async function buildPlatform(platform: Platform): Promise<{ time: number }> {
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

function bundleSummary(platform: Platform): string {
  const dir = join(root, 'dist', platform);
  const totalSize = mjsSize(dir);
  const entries = pluginBuildEntries(platform);
  let pluginsSize = 0;

  for (const output in entries) {
    pluginsSize += statSync(join(dir, `${output}.mjs`)).size;
  }

  const coreSize = totalSize - pluginsSize;
  return `${formatSize(totalSize)} · core ${formatSize(coreSize)} · plugins ${formatSize(pluginsSize)}`;
}

function mjsSize(path: string): number {
  const stat = statSync(path);
  if (!stat.isDirectory()) return path.endsWith('.mjs') ? stat.size : 0;

  const entries = readdirSync(path);
  let size = 0;

  for (let i = 0; i < entries.length; i++) {
    size += mjsSize(join(path, entries[i]));
  }

  return size;
}

function copyFilesFromRoot(files: string[]): void {
  for (const file of files) {
    copyFileSync(join(root, '../..', file), join(root, file));
  }
}

function removeDisabledPluginTypes(): void {
  for (let i = 0; i < disabledPluginTypeRoots.length; i++) {
    rmSync(join(root, disabledPluginTypeRoots[i]), { recursive: true, force: true });
  }
}
