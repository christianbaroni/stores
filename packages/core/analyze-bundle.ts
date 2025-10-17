import * as esbuild from 'esbuild';
import * as fs from 'fs';

type ModuleStats = {
  [key: string]: number;
};

async function analyzeBundle(): Promise<void> {
  console.log('🔍 Analyzing bundle composition...\n');

  const result = await esbuild.build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    metafile: true,
    outfile: 'dist/analyze.js',
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
  console.log('==============================');
  const sortedModules = Object.entries(moduleStats).sort((a, b) => b[1] - a[1]);
  for (const [module, bytes] of sortedModules) {
    console.log(`${module}: ${(bytes / 1024).toFixed(2)} KB`);
  }

  console.log('\n📁 LOCAL CODE BREAKDOWN:');
  console.log('========================');
  const sortedLocal = Object.entries(inputStats).sort((a, b) => b[1] - a[1]);
  for (const [category, bytes] of sortedLocal) {
    console.log(`${category}: ${(bytes / 1024).toFixed(2)} KB`);
  }

  console.log('\n📊 TOTAL BUNDLE SIZE:');
  console.log('====================');
  console.log(`Unminified: ${(output.bytes / 1024).toFixed(2)} KB`);

  fs.writeFileSync('dist/bundle-analysis.json', JSON.stringify(meta, null, 2));
  console.log('\nAnalysis saved to dist/bundle-analysis.json');
}

analyzeBundle().catch(console.error);
