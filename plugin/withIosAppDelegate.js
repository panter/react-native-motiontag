const { withAppDelegate } = require('@expo/config-plugins')
const {
  mergeContents,
} = require('@expo/config-plugins/build/utils/generateCode')

module.exports = function withIosAppDelegate(config) {
  return withAppDelegate(config, (cfg) => {
    if (cfg.modResults.language !== 'swift') {
      throw new Error(
        '[react-native-motiontag] requires a Swift AppDelegate (Expo SDK 51+). Upgrade your AppDelegate to Swift before adding this plugin.',
      )
    }

    let contents = cfg.modResults.contents

    contents = mergeContents({
      tag: 'react-native-motiontag-import',
      src: contents,
      newSrc: 'import RNMotionTag',
      anchor: /import Expo\b/,
      offset: 1,
      comment: '//',
    }).contents

    contents = mergeContents({
      tag: 'react-native-motiontag-bootstrap',
      src: contents,
      newSrc:
        '    MotionTagBootstrap.bootstrap(launchOptions: launchOptions)',
      anchor:
        /return super\.application\(application, didFinishLaunchingWithOptions: launchOptions\)/,
      offset: 0,
      comment: '//',
    }).contents

    cfg.modResults.contents = contents
    return cfg
  })
}
