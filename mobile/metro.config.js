const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

/**
 * Mobile-only Metro config. Expo app lives solely under mobile/.
 * Do not resolve React/RN from the monorepo root (Next.js uses React 19).
 */
const projectRoot = __dirname;

const config = getDefaultConfig(projectRoot);

// Watch only this app tree (not parent client/server workspaces).
config.watchFolders = [projectRoot];

// Single resolver root: mobile/node_modules only.
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

// Expo default; avoids non-standard hierarchical lookup that breaks doctor checks.
config.resolver.disableHierarchicalLookup = false;

config.resolver.blockList = [
  /.*\.code-review-graph\/.*/,
  /.*\.git\/.*/,
  /.*\.gsd\/.*/,
  /.*\.agent\/.*/,
  /.*\.agents\/.*/,
  /.*\.claude\/.*/,
];

module.exports = withNativeWind(config, { input: './global.css' });
