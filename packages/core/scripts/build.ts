#!/usr/bin/env tsx
import { exec } from 'child_process';
import { copyFileSync, readFileSync, rmSync, statSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import { bold, formatSize, handleError, spinner, summary, timedRow, write } from '@/cli';
import { pluginBuildEntries, type Platform } from '../build/plugins';

// ============ Script ========================================================= //

const execAsync = promisify(exec);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const typesOnly = process.argv.includes('--types-only');
const output = outputArg();

(output ? buildOutputOnly(output) : typesOnly ? buildTypesOnly() : build()).catch(e => {
  write(summary('build', { success: false }));
  handleError(e);
});

// ============ Types ========================================================== //

type BuildOutput = Platform | 'vanilla';
type BuildCommandOptions = { env?: NodeJS.ProcessEnv };
type TimedResult = { time: number };

// ============ Build Runner =================================================== //

async function buildTypesOnly(): Promise<void> {
  prepareBuild();
  await buildTypes();
}

async function buildOutputOnly(output: BuildOutput): Promise<void> {
  rmSync(join(root, 'dist', output), { recursive: true, force: true });
  await buildOutput(output, process.env.NODE_ENV);
}

async function build(): Promise<void> {
  const start = performance.now();
  prepareBuild();

  write(`${bold('stores')}\n`);
  const spin = spinner(' exports · types · vanilla · web · native');
  write('\n');

  const exports = await generateExports();
  const [types, vanilla, web, native] = await Promise.all([
    buildTypes(),
    buildOutput('vanilla'),
    buildOutput('web'),
    buildOutput('native'),
  ]).finally(spin.stop);

  write(
    timedRow('exports', exports.time),
    timedRow('types', types.time),
    timedRow('vanilla', vanilla.time, bundleSummary('vanilla')),
    timedRow('web', web.time, bundleSummary('web')),
    timedRow('native', native.time, bundleSummary('native')),
    summary('build', { time: performance.now() - start })
  );
}

// ============ Build Helpers ================================================== //

async function buildTypes(): Promise<TimedResult> {
  return timed(() => runCommand('tsdown --config tsdown.config.ts --no-clean', { env: { ...process.env, STORES_TSDOWN_CONFIG: 'types' } }));
}

async function timed(action: () => Promise<void>): Promise<TimedResult> {
  const start = performance.now();
  await action();
  return { time: performance.now() - start };
}

async function runCommand(command: string, options?: BuildCommandOptions): Promise<void> {
  await execAsync(command, { cwd: root, env: options?.env });
}

function buildOutput(output: BuildOutput, nodeEnv = 'production'): Promise<TimedResult> {
  return timed(() =>
    runCommand(`tsdown --config tsdown.config.ts --out-dir dist/${output} --no-clean`, { env: buildEnv(output, nodeEnv) })
  );
}

function generateExports(): Promise<TimedResult> {
  return timed(() => runCommand('tsx --tsconfig scripts/tsconfig.json scripts/generate-exports.ts'));
}

function buildEnv(output: BuildOutput, nodeEnv: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: nodeEnv,
    STORES_TSDOWN_CONFIG: 'bundle',
    ...(output === 'native' ? { BUILD_TARGET: 'native' } : undefined),
    ...(output === 'vanilla' ? { BUILD_MODE: 'vanilla' } : undefined),
  };
}

function outputArg(): BuildOutput | undefined {
  const prefix = '--output=';
  const arg = process.argv.find(value => value.startsWith(prefix));
  const output = arg?.slice(prefix.length);

  if (output === undefined) return undefined;
  if (output === 'native' || output === 'vanilla' || output === 'web') return output;
  throw new Error(`Unknown build output: ${output}`);
}

// ============ Summary Utilities ============================================== //

function bundleSummary(output: BuildOutput): string {
  const dir = join(root, 'dist', output);
  const entries = output === 'vanilla' ? {} : pluginBuildEntries(output);
  const coreFiles = moduleGraph(join(dir, 'index.mjs'));
  const allFiles = new Set(coreFiles);

  for (const entry of Object.keys(entries)) {
    for (const file of moduleGraph(join(dir, `${entry}.mjs`))) allFiles.add(file);
  }

  const totalSize = filesSize(allFiles);
  const coreSize = filesSize(coreFiles);
  const pluginsSize = totalSize - coreSize;
  return `${formatSize(totalSize)} · core ${formatSize(coreSize)} · plugins ${formatSize(pluginsSize)}`;
}

function moduleGraph(entry: string, files: Set<string> = new Set()): Set<string> {
  const file = resolve(entry);
  if (files.has(file)) return files;

  files.add(file);
  const source = readFileSync(file, 'utf8');

  for (const specifier of moduleSpecifiers(source)) {
    if (specifier.startsWith('.')) moduleGraph(resolve(dirname(file), specifier), files);
  }
  return files;
}

function moduleSpecifiers(source: string): string[] {
  return Array.from(source.matchAll(/\b(?:import|export)\b(?:[^'"]*?\bfrom\s*)?["']([^"']+)["']/g), match => match[1]);
}

function filesSize(files: Set<string>): number {
  let size = 0;
  for (const file of files) size += statSync(file).size;
  return size;
}

// ============ File Utilities ================================================= //

function copyFilesFromRoot(files: string[]): void {
  for (const file of files) copyFileSync(join(root, '../..', file), join(root, file));
}

function prepareBuild(): void {
  rmSync(join(root, 'dist'), { recursive: true, force: true });
  copyFilesFromRoot(['LICENSE', 'README.md']);
}
