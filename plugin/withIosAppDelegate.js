const { withAppDelegate } = require('@expo/config-plugins')
const {
  mergeContents,
  removeContents,
} = require('@expo/config-plugins/build/utils/generateCode')

// MotionTag requires SDK initialisation "as early as possible" in
// application(_:didFinishLaunchingWithOptions:) — when iOS relaunches a
// killed app for a background location event, the SDK must re-arm tracking
// before any React Native / Expo startup work runs.
const BOOTSTRAP_CALL = `    // MotionTag SDK must initialise before React Native starts so background
    // wake-ups (after the app is killed) can re-arm tracking.
    MotionTagBootstrap.bootstrap(launchOptions: launchOptions)`

// Background uploads run in a background URL session. When iOS wakes the
// (possibly killed) app to deliver its events, they must reach the SDK.
// Per the MotionTag iOS guide (and the official Flutter SDK's AppDelegate),
// every identifier is forwarded unconditionally — the SDK decides internally
// which sessions are its own and only calls the completion handler for those.
const BACKGROUND_SESSION_OVERRIDE = `  public override func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    MotionTagBootstrap.processBackgroundSessionEvents(
      identifier: identifier,
      completionHandler: completionHandler
    )
  }`

/**
 * mergeContents, but tries a list of [anchor, offset] pairs in order so the
 * plugin survives small template differences between Expo SDK versions.
 *
 * Always removes an existing block for the tag first: mergeContents alone is
 * content-hash idempotent, so a block whose content is unchanged would stay
 * at its old position even when this plugin's anchor moved.
 */
function mergeWithAnchors(src, { tag, newSrc, anchors }) {
  src = removeContents({ src, tag }).contents

  let lastError
  for (const [anchor, offset] of anchors) {
    try {
      return mergeContents({ tag, src, newSrc, anchor, offset, comment: '//' })
        .contents
    } catch (error) {
      if (error.code !== 'ERR_NO_MATCH') {
        throw error
      }
      lastError = error
    }
  }
  throw new Error(
    `[react-native-motiontag] Could not find an insertion point for "${tag}" in AppDelegate.swift. ` +
      'Your AppDelegate seems to be heavily customised — add the MotionTag calls manually as shown ' +
      `in the package README ("Setup with bare React Native"). Original error: ${lastError.message}`,
  )
}

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

    contents = mergeWithAnchors(contents, {
      tag: 'react-native-motiontag-bootstrap',
      newSrc: BOOTSTRAP_CALL,
      anchors: [
        // First statement of didFinishLaunchingWithOptions in the Expo
        // SDK 52+ template — insert the bootstrap call right before it.
        [/let delegate = ReactNativeDelegate\(\)/, 0],
        // Fallback: the line opening the first `-> Bool {` body in the file,
        // which in the Expo template is didFinishLaunchingWithOptions.
        [/\)\s*->\s*Bool\s*\{/, 1],
      ],
    })

    contents = mergeWithAnchors(contents, {
      tag: 'react-native-motiontag-background-session',
      newSrc: BACKGROUND_SESSION_OVERRIDE,
      anchors: [
        // Right after the AppDelegate class declaration, before its first member.
        [/class AppDelegate\s*:\s*ExpoAppDelegate\s*\{/, 1],
        [/:\s*ExpoAppDelegate\s*\{/, 1],
      ],
    })

    cfg.modResults.contents = contents
    return cfg
  })
}
