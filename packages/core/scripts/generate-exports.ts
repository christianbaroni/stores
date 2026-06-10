import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { type PluginConfig, pluginOutputPath, pluginSubpathName, pluginTypesPath, plugins, type PluginSubpath } from '../build/plugins';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '../package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

pkg.exports = {
  '.': pkg.exports['.'],
  ...buildPackageExports(),
};

writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// ============ Utilities ====================================================== //

type PackageCondition = string | { 'react-native': string; default: string };
type PackageExport = { types: string; import: PackageCondition; require: PackageCondition };

function buildPackageExports(): Record<string, PackageExport> {
  const packageExports: Record<string, PackageExport> = {};

  for (const name in plugins) {
    const config = plugins[name];
    packageExports[packageExportKey(name)] = createPluginExport(name, config);

    const subpaths = config.subpaths;
    if (subpaths === undefined) continue;

    for (let j = 0; j < subpaths.length; j++) {
      const subpath = subpaths[j];
      packageExports[packageExportKey(name, subpath)] = createPluginExport(name, config, subpath);
    }
  }

  return packageExports;
}

function packageExportKey(name: string, subpath?: PluginSubpath): string {
  return subpath === undefined ? `./${name}` : `./${name}/${pluginSubpathName(subpath)}`;
}

function createPluginExport(name: string, config: PluginConfig, subpath?: PluginSubpath): PackageExport {
  const types = pluginTypesPath(name, subpath);

  if (!config.includes('native')) {
    return {
      types,
      import: pluginOutputPath(name, 'web', true, subpath),
      require: pluginOutputPath(name, 'web', false, subpath),
    };
  }

  return {
    types,
    import: {
      'react-native': pluginOutputPath(name, 'native', true, subpath),
      default: pluginOutputPath(name, 'web', true, subpath),
    },
    require: {
      'react-native': pluginOutputPath(name, 'native', false, subpath),
      default: pluginOutputPath(name, 'web', false, subpath),
    },
  };
}
