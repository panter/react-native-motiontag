const { withPlugins } = require('@expo/config-plugins')

const withInfoPlistKeys = require('./withInfoPlistKeys')
const withIosAppDelegate = require('./withIosAppDelegate')
const withAndroidMavenRepo = require('./withAndroidMavenRepo')
const withAndroidManifestExtras = require('./withAndroidManifestExtras')
const withAndroidNotification = require('./withAndroidNotification')
const withAndroidMainApplication = require('./withAndroidMainApplication')
const withAndroidBackupRules = require('./withAndroidBackupRules')

const DEFAULTS = {
  iosPermissions: {
    locationAlwaysAndWhenInUse:
      'We use your location to track your trips with MotionTag.',
    locationWhenInUse:
      'We use your location to track your trips with MotionTag.',
    motion: 'We use motion data to detect transport modes.',
  },
  androidNotification: {
    channelId: 'motiontag_tracking',
    channelName: 'MotionTag tracking',
    title: 'MotionTag',
    text: 'Tracking is active',
    iconResource: null,
  },
}

function withMotionTag(config, options) {
  const userOptions = options || {}
  const merged = {
    iosPermissions: {
      ...DEFAULTS.iosPermissions,
      ...(userOptions.iosPermissions || {}),
    },
    androidNotification: {
      ...DEFAULTS.androidNotification,
      ...(userOptions.androidNotification || {}),
    },
  }

  if (config.newArchEnabled === false) {
    console.warn(
      '[react-native-motiontag] requires the New Architecture. Set "newArchEnabled": true in your app config.',
    )
  }

  return withPlugins(config, [
    [withInfoPlistKeys, merged.iosPermissions],
    [withIosAppDelegate],
    [withAndroidMavenRepo],
    [withAndroidManifestExtras],
    [withAndroidNotification, merged.androidNotification],
    [withAndroidMainApplication],
    [withAndroidBackupRules],
  ])
}

module.exports = withMotionTag
