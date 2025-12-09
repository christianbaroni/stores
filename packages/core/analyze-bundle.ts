import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);

type ModuleStats = {
  [key: string]: number;
};

function formatSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

async function getGzipSize(filePath: string): Promise<number> {
  const content = fs.readFileSync(filePath);
  const compressed = await gzip(content);
  return compressed.length;
}

async function analyzeBundle(): Promise<void> {
  console.log('🔍 Analyzing bundle composition...\n');

  // Ensure tmp directory exists
  if (!fs.existsSync('tmp')) {
    fs.mkdirSync('tmp', { recursive: true });
  }

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
  const output = Object.values(meta.outputs)[0];

  const inputStats: ModuleStats = {};
  const moduleStats: ModuleStats = {};

  for (const [inputPath, input] of Object.entries(meta.inputs)) {
    const bytes = input.bytes;

    // Categorize by source
    if (inputPath.includes('node_modules/zustand')) {
      moduleStats.zustand = (moduleStats.zustand || 0) + bytes;
    } else if (inputPath.includes('node_modules/use-sync-external-store')) {
      moduleStats['use-sync-external-store'] = (moduleStats['use-sync-external-store'] || 0) + bytes;
    } else if (inputPath.includes('node_modules')) {
      const module = inputPath.split('node_modules/')[1].split('/')[0];
      moduleStats[module] = (moduleStats[module] || 0) + bytes;
    } else {
      // Local source files
      const category = inputPath.includes('queryStore')
        ? 'queryStore'
        : inputPath.includes('derivedStore')
          ? 'derivedStore'
          : inputPath.includes('utils')
            ? 'utils'
            : inputPath.includes('hooks')
              ? 'hooks'
              : 'core';
      inputStats[category] = (inputStats[category] || 0) + bytes;
    }
  }

  console.log('📦 MODULE SIZES (unminified):');
  console.log('============================');
  const sortedModules = Object.entries(moduleStats).sort((a, b) => b[1] - a[1]);
  for (const [module, bytes] of sortedModules) {
    console.log(`${module}: ${formatSize(bytes)}`);
  }

  console.log('\n📁 LOCAL CODE BREAKDOWN:');
  console.log('=======================');
  const sortedLocal = Object.entries(inputStats).sort((a, b) => b[1] - a[1]);
  for (const [category, bytes] of sortedLocal) {
    console.log(`${category}: ${formatSize(bytes)}`);
  }

  console.log('\n📊 BUNDLE SIZE ANALYSIS:');
  console.log('=======================');
  console.log(`Unminified: ${formatSize(output.bytes)}`);

  // Analyze production builds
  const builds = [
    { name: 'Web (ESM)', path: 'dist/web/index.mjs' },
    { name: 'Web (CJS)', path: 'dist/web/index.js' },
    { name: 'Native (ESM)', path: 'dist/native/index.mjs' },
    { name: 'Native (CJS)', path: 'dist/native/index.js' },
  ];

  console.log('\n💾 PRODUCTION BUILDS [ALL EXPORTS]:');
  console.log('==================================');

  for (const build of builds) {
    if (fs.existsSync(build.path)) {
      const stats = fs.statSync(build.path);
      const gzipSize = await getGzipSize(build.path);
      console.log(`${build.name.padEnd(15)} Minified: ${formatSize(stats.size).padEnd(10)} Gzipped: ${formatSize(gzipSize)}`);
    }
  }

  fs.writeFileSync('tmp/bundle-analysis.json', JSON.stringify(meta, null, 2));
  console.log('\n✅ Analysis saved to tmp/bundle-analysis.json');
}

analyzeBundle().catch(console.error);
