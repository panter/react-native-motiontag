const path = require('path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const libraryRoot = path.resolve(projectRoot, '..')

// Peer deps of the library. The library has its own copy of these installed
// at libraryRoot/node_modules (devDeps, for `bob build` + tsc). We need to
// hide those from Metro and force resolution to the example's copies so we
// only ever have one physical instance at runtime.
const DEDUPED = ['react', 'react-native']

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const config = getDefaultConfig(projectRoot)

// Watch the parent library so edits in ../src trigger Fast Refresh.
config.watchFolders = [libraryRoot]

// Block libraryRoot's copies of peer deps.
config.resolver.blockList = new RegExp(
  DEDUPED.map(
    (name) =>
      `^${escapeRegExp(path.join(libraryRoot, 'node_modules', name))}\\/.*$`,
  ).join('|'),
)

// Redirect peer-dep imports from anywhere in the bundle to example's copy.
config.resolver.extraNodeModules = DEDUPED.reduce((acc, name) => {
  acc[name] = path.join(projectRoot, 'node_modules', name)
  return acc
}, {})

module.exports = config
