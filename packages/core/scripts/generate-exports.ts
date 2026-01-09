import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { Platform, exportKey, outputPath, plugins, typesPath } from '../build/plugins';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '../package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

const pluginExports = Object.fromEntries(
  Object.entries(plugins).map(([name, platforms]) => [exportKey(name), createPluginExport(name, platforms)])
);

pkg.exports = { '.': pkg.exports['.'], ...pluginExports };
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// ============ Utilities ====================================================== //

type Condition = string | { 'react-native': string; default: string };
type PluginExport = { types: string; import: Condition; require: Condition };

function createPluginExport(name: string, platforms: Platform[]): PluginExport {
  if (!platforms.includes('native')) {
    return {
      types: typesPath(name),
      import: outputPath(name, 'web', true),
      require: outputPath(name, 'web', false),
    };
  }
  return {
    types: typesPath(name),
    import: {
      'react-native': outputPath(name, 'native', true),
      default: outputPath(name, 'web', true),
    },
    require: {
      'react-native': outputPath(name, 'native', false),
      default: outputPath(name, 'web', false),
    },
  };
}
