const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const workspaceRoot = path.resolve(__dirname, '../..');
const config = getDefaultConfig(__dirname);

// The workspace uses `node-linker=hoisted` (see root .npmrc) specifically so
// Metro's normal hierarchical node_modules lookup works unmodified — Expo's
// tooling assumes an npm/yarn-classic-style flat tree. `watchFolders` is the
// one addition still needed: Metro must see `packages/api-types` (which
// lives outside `apps/mobile`) to resolve `@orbit/api-types`.
config.watchFolders = [workspaceRoot];

module.exports = withNativeWind(config, { input: './global.css' });
