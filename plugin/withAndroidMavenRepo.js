const { withProjectBuildGradle } = require('@expo/config-plugins')
const {
  mergeContents,
} = require('@expo/config-plugins/build/utils/generateCode')

const MAVEN_BLOCK = `    maven { url "https://pkgs.dev.azure.com/motiontag/releases/_packaging/releases/maven/v1" }`

module.exports = function withAndroidMavenRepo(config) {
  return withProjectBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error(
        '[react-native-motiontag] expected Groovy build.gradle; got ' +
          cfg.modResults.language,
      )
    }

    cfg.modResults.contents = mergeContents({
      tag: 'react-native-motiontag-maven',
      src: cfg.modResults.contents,
      newSrc: MAVEN_BLOCK,
      anchor: /allprojects\s*\{/,
      offset: 2,
      comment: '//',
    }).contents

    return cfg
  })
}
