import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);

function formatSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

async function getGzipSize(filePath: string): Promise<number> {
  const compressed = await gzip(fs.readFileSync(filePath));
  return compressed.length;
}

function findBuiltFiles(dir: string, prefix = ''): { name: string; path: string; format: string }[] {
  if (!fs.existsSync(dir)) return [];
  const results: { name: string; path: string; format: string }[] = [];

  for (const file of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      results.push(...findBuiltFiles(fullPath, `${prefix}${file}/`));
    } else if (file.endsWith('.js') || file.endsWith('.mjs')) {
      if (file.startsWith('chunk-')) continue;
      const name = `${prefix}${file.replace(/\.(m?js)$/, '')}`;
      const format = file.endsWith('.mjs') ? 'ESM' : 'CJS';
      results.push({ name, path: fullPath, format });
    }
  }
  return results;
}

function extractPackageName(inputPath: string): string {
  const parts = inputPath.split('node_modules/');
  const afterNodeModules = parts[parts.length - 1];
  if (afterNodeModules.startsWith('@')) {
    const [scope, name] = afterNodeModules.split('/');
    return `${scope}/${name}`;
  }
  return afterNodeModules.split('/')[0];
}

async function analyzeBundle(): Promise<void> {
  console.log('🔍 Analyzing bundle composition...\n');

  if (!fs.existsSync('tmp')) fs.mkdirSync('tmp', { recursive: true });

  const result = await esbuild.build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    metafile: true,
    outfile: 'tmp/analyze.js',
    external: ['react', 'react-native', 'react-native-mmkv'],
    write: false,
    minify: false,
  });

  const meta = result.metafile!;
  const moduleStats: Record<string, number> = {};
  const localStats: Record<string, number> = {};

  for (const [inputPath, input] of Object.entries(meta.inputs)) {
    if (inputPath.includes('node_modules')) {
      const mod = extractPackageName(inputPath);
      moduleStats[mod] = (moduleStats[mod] || 0) + input.bytes;
    } else {
      const dir = path.dirname(inputPath).split('/').pop() || 'core';
      localStats[dir] = (localStats[dir] || 0) + input.bytes;
    }
  }

  console.log('📦 DEPENDENCIES (unminified):');
  console.log('============================');
  for (const [mod, bytes] of Object.entries(moduleStats).sort((a, b) => b[1] - a[1])) {
    console.log(`${mod}: ${formatSize(bytes)}`);
  }

  console.log('\n📁 SOURCE BREAKDOWN:');
  console.log('===================');
  for (const [dir, bytes] of Object.entries(localStats).sort((a, b) => b[1] - a[1])) {
    console.log(`${dir}: ${formatSize(bytes)}`);
  }

  const webFiles = findBuiltFiles('dist/web');
  const nativeFiles = findBuiltFiles('dist/native');

  const allEntries = new Set([...webFiles, ...nativeFiles].map(f => f.name));

  console.log('\n💾 PRODUCTION BUILDS:');
  console.log('====================');

  for (const entry of [...allEntries].sort()) {
    const web = webFiles.filter(f => f.name === entry);
    const native = nativeFiles.filter(f => f.name === entry);

    console.log(`\n  stores${entry === 'index' ? '' : '/' + entry}:`);

    for (const file of [...web, ...native]) {
      const platform = file.path.includes('/web/') ? 'Web' : 'Native';
      const stats = fs.statSync(file.path);
      const gz = await getGzipSize(file.path);
      console.log(`    ${platform} ${file.format.padEnd(3)}  ${formatSize(stats.size).padEnd(10)} gzip: ${formatSize(gz)}`);
    }
  }

  console.log('\n✅ Analysis complete');
}

analyzeBundle().catch(console.error);
