const { withMainApplication } = require('@expo/config-plugins')
const {
  mergeContents,
} = require('@expo/config-plugins/build/utils/generateCode')

module.exports = function withAndroidMainApplication(config) {
  return withMainApplication(config, (cfg) => {
    if (cfg.modResults.language !== 'kt') {
      throw new Error(
        '[react-native-motiontag] requires a Kotlin MainApplication (Expo SDK 51+).',
      )
    }

    let contents = cfg.modResults.contents

    contents = mergeContents({
      tag: 'react-native-motiontag-import',
      src: contents,
      newSrc: 'import de.motiontag.reactnative.MotionTagBootstrap',
      anchor: /^package\s+[^\s]+/m,
      offset: 1,
      comment: '//',
    }).contents

    contents = mergeContents({
      tag: 'react-native-motiontag-bootstrap',
      src: contents,
      newSrc:
        '    MotionTagBootstrap.init(this, MotionTagNotificationFactory.create(this))',
      anchor: /super\.onCreate\(\)/,
      offset: 1,
      comment: '//',
    }).contents

    cfg.modResults.contents = contents
    return cfg
  })
}
