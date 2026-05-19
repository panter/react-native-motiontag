const { withAndroidManifest } = require('@expo/config-plugins')

const PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.POST_NOTIFICATIONS',
]

function ensurePermission(manifest, name) {
  manifest['uses-permission'] = manifest['uses-permission'] || []
  const exists = manifest['uses-permission'].some(
    (p) => p && p.$ && p.$['android:name'] === name,
  )
  if (!exists) {
    manifest['uses-permission'].push({ $: { 'android:name': name } })
  }
}

module.exports = function withAndroidManifestExtras(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest
    for (const perm of PERMISSIONS) {
      ensurePermission(manifest, perm)
    }
    return cfg
  })
}
