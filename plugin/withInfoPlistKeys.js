const { withInfoPlist } = require('@expo/config-plugins')

const BACKGROUND_MODES = ['location', 'fetch', 'processing']
const BG_TASK_IDS = [
  'com.motiontag.sdk.backgroundrefresh',
  'com.motiontag.sdk.backgroundtask',
]

function dedupe(arr) {
  return Array.from(new Set(arr))
}

module.exports = function withInfoPlistKeys(config, permissions) {
  return withInfoPlist(config, (cfg) => {
    const plist = cfg.modResults

    if (!plist.NSLocationAlwaysAndWhenInUseUsageDescription) {
      plist.NSLocationAlwaysAndWhenInUseUsageDescription =
        permissions.locationAlwaysAndWhenInUse
    }
    if (!plist.NSLocationWhenInUseUsageDescription) {
      plist.NSLocationWhenInUseUsageDescription = permissions.locationWhenInUse
    }
    if (!plist.NSMotionUsageDescription) {
      plist.NSMotionUsageDescription = permissions.motion
    }

    const existingModes = Array.isArray(plist.UIBackgroundModes)
      ? plist.UIBackgroundModes
      : []
    plist.UIBackgroundModes = dedupe([...existingModes, ...BACKGROUND_MODES])

    const existingIds = Array.isArray(plist.BGTaskSchedulerPermittedIdentifiers)
      ? plist.BGTaskSchedulerPermittedIdentifiers
      : []
    plist.BGTaskSchedulerPermittedIdentifiers = dedupe([
      ...existingIds,
      ...BG_TASK_IDS,
    ])

    return cfg
  })
}
