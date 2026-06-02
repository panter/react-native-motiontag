# @panter/react-native-motiontag

Turbo Module wrapping the [MotionTag tracking SDK](https://motion-tag.com/) for
React Native (new architecture only).

The JS surface mirrors the [official Flutter SDK](https://github.com/MOTIONTAG/motiontag-sdk-flutter)
so payloads are interchangeable. Bridges the iOS SDK v6.5.x and the Android
SDK v7.2.x — the platform asymmetry is hidden behind a shared TS contract.

## Contents

- [Install in your app](#install-in-your-app)
- [Setup with Expo (recommended)](#setup-with-expo-recommended)
- [Setup with bare React Native](#setup-with-bare-react-native)
- [Public API](#public-api)
- [Pre-RN events](#pre-rn-events)
- [Native dependency versions](#native-dependency-versions)
- [Running the example app](#running-the-example-app)
- [Repo layout](#repo-layout)
- [Developing the package](#developing-the-package)
- [Upgrading](#upgrading)
- [Releasing](#releasing)

## Install in your app

```sh
yarn add @panter/react-native-motiontag
# or:  npm install @panter/react-native-motiontag
```

Then follow **either** the Expo path (recommended) or the bare React Native
path below — pick the one that matches your project.

## Public API

```ts
import MotionTag from '@panter/react-native-motiontag'

await MotionTag.setUserToken(jwt)
await MotionTag.start()
const active = await MotionTag.isTrackingActive()
await MotionTag.stop()

const subscription = MotionTag.addListener(event => {
  if (event.type === 'transmissionError' && event.errorCode === 401) {
    // re-auth flow
  }
})
subscription.remove()
```

`addListener` supports multiple subscribers; each `addListener` returns its
own `EventSubscription`. The `MotionTagEvent` discriminated union covers
`started`, `stopped`, `location`, `transmissionSuccess`, `transmissionError`,
`authorization` (iOS), `powerSaveModeChanged` (Android),
`batteryOptimizationsChanged` (Android), and a fall-through `log` channel
that carries the diagnostic string format the underlying SDKs emit.

The platform-only methods (`isPowerSaveModeEnabled`,
`isBatteryOptimizationsEnabled` on Android; `getWifiOnlyDataTransfer` /
`setWifiOnlyDataTransfer` / `clearData` on Android) resolve to safe defaults
(`false`) or reject (`'UNSUPPORTED'`) on iOS, matching the Flutter SDK's
behaviour.

## Setup with Expo (recommended)

The package ships an Expo config plugin that wires up everything for you on
`expo prebuild`: AppDelegate bootstrap + background URL session forwarding
(iOS), MainApplication bootstrap (Android), `Info.plist` permission +
background-mode keys, foreground-service notification factory, the Azure
DevOps Maven repo, and the extra Android permissions (`POST_NOTIFICATIONS`,
`FOREGROUND_SERVICE`).

Add the plugin to `app.json`:

```jsonc
{
  "expo": {
    "newArchEnabled": true,
    "plugins": [
      [
        "@panter/react-native-motiontag",
        {
          "iosPermissions": {
            "locationAlwaysAndWhenInUse": "We use your location to track your trips.",
            "locationWhenInUse": "We use your location to track your trips.",
            "motion": "We use motion data to detect transport modes."
          },
          "androidNotification": {
            "channelId": "motiontag_tracking",
            "channelName": "Tracking",
            "title": "MyApp",
            "text": "Tracking is active"
          }
        }
      ]
    ]
  }
}
```

Then run `npx expo prebuild --clean` followed by `npx expo run:ios` /
`npx expo run:android`. Expo Go is not supported — the library has native
code, you need a development client build.

## Setup with bare React Native

The MotionTag SDKs need to be initialised **before React Native starts**.
Turbo modules are instantiated lazily on first JS access, so they cannot run
this themselves — the host app must call a small bootstrap from its
`AppDelegate` (iOS) and `Application.onCreate` (Android).

### iOS — `AppDelegate.swift`

```swift
import RNMotionTag

func application(
  _ application: UIApplication,
  didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
) -> Bool {
  // Must be the FIRST statement: when iOS relaunches the killed app for a
  // background location event, the SDK has to re-arm tracking before any
  // React Native startup work runs.
  MotionTagBootstrap.bootstrap(launchOptions: launchOptions)
  // … rest of RN bootstrap …
}

func application(
  _ application: UIApplication,
  handleEventsForBackgroundURLSession identifier: String,
  completionHandler: @escaping () -> Void
) {
  if MotionTagBootstrap.handlesBackgroundURLSession(identifier: identifier) {
    MotionTagBootstrap.processBackgroundSessionEvents(
      identifier: identifier,
      completionHandler: completionHandler
    )
  } else {
    // Forward sessions owned by other SDKs (Firebase, …) to their handlers, or
    // finish them immediately if nothing else in the app uses background sessions.
    // Each session's completion handler must be called exactly once.
    completionHandler()
  }
}
```

The host's `Info.plist` must declare:

- `NSLocationAlwaysAndWhenInUseUsageDescription`,
  `NSLocationWhenInUseUsageDescription`, `NSMotionUsageDescription` —
  user-facing copy stays host-owned.
- `UIBackgroundModes` containing `location`, `fetch`, `processing`.
- `BGTaskSchedulerPermittedIdentifiers` containing
  `com.motiontag.sdk.backgroundrefresh` and
  `com.motiontag.sdk.backgroundtask` (required from SDK 6.5.0).
- `FirebaseAppDelegateProxyEnabled = false` if the app uses Firebase,
  so its swizzling doesn't interfere with MotionTag's background URLSession.

Tested with both CocoaPods' default static-library linkage and
`use_frameworks! :linkage => :static` (commonly enabled by Firebase,
MapBox, and other Swift-only iOS SDKs) — no host-side workaround needed
in either mode.

### Android — `Application.onCreate`

```kotlin
import de.motiontag.reactnative.MotionTagBootstrap

override fun onCreate() {
    super.onCreate()
    // Init the SDK before React Native loads — the MotionTag SDK requires
    // initialisation as early as possible in onCreate.
    MotionTagBootstrap.init(this, createNotification())
    loadReactNative(this)
}
```

The host owns the foreground-service `Notification` (channel id, title,
text, icon) — the package does not impose copy or branding. Required
SDK permissions (`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`,
`ACCESS_BACKGROUND_LOCATION`, `ACTIVITY_RECOGNITION`,
`FOREGROUND_SERVICE_LOCATION`) are merged into the host manifest by Gradle.

## Pre-RN events

Events that fire between native init (in `MotionTagBootstrap.init` /
`MotionTagBootstrap.bootstrap`) and the JS subscription being installed are
**dropped** — only the diagnostic log line goes to logcat / Console. In
practice this is rare and only affects authorization-status changes; the
3-second polling reconciler in `useTrackingChecks` re-establishes state.

## Native dependency versions

| Platform | Version | Source |
| --- | --- | --- |
| iOS | `MotionTagSDK ~> 6.5.0` | CocoaPods trunk (transitive from this pod) |
| Android | `de.motiontag:tracker:7.2.5` | `pkgs.dev.azure.com/motiontag/releases` (Maven repo declared in this package) |

The two SDKs are intentionally out of sync — aligning them is tracked as
a follow-up.

## Running the example app

The `example/` folder is a working Expo dev-client app that exercises the
package end-to-end: paste a JWT, request permissions, start tracking, watch
events stream in.

**Requirements**: Node 18+, Xcode for iOS, Android Studio for Android. Expo
Go won't work — the package has native code, so you need a development
client build.

```sh
git clone https://github.com/panter/react-native-motiontag
cd react-native-motiontag
yarn install                       # installs root devDeps + runs `bob build`
cd example
yarn install                       # installs Expo deps + links the parent
npx expo prebuild --clean          # runs the config plugin, generates ios/ + android/
npx expo run:ios                   # build + boot iOS simulator
# or
npx expo run:android               # needs an Android emulator running first
```

After the first run, the dev loop is:

```sh
cd example
npx expo start --dev-client        # Metro only; reuses the installed app
```

Press `r` to reload the JS bundle. Edits to `App.tsx`, `src/`, or the
library's `src/index.ts` hot-reload via Fast Refresh. Native (Swift/Kotlin)
edits require another `expo run:ios` / `expo run:android`.

For real motion-tracking validation use a physical device
(`npx expo run:ios --device`) — simulators can't generate motion-sensor
data and only fake locations via Xcode's debug-location menu / the Android
emulator's location controls.

## Repo layout

```
react-native-motiontag/
├── src/                 # TS source (the JS API surface)
├── android/             # Android Turbo Module (Kotlin, AAR)
├── ios/                 # iOS Turbo Module (Swift + ObjC++)
├── plugin/              # Expo config plugin (plain JS, no build)
├── app.plugin.js        # Plugin entrypoint loaded by `expo prebuild`
├── react-native-motiontag.podspec
├── package.json         # Published npm package
└── example/             # Standalone Expo demo app consuming the package
```

The library and the example are independent npm packages. The example
declares the parent via a relative path:

```json
{ "dependencies": { "@panter/react-native-motiontag": "file:.." } }
```

When you `yarn install` in `example/`, that resolves as a symlink to the
parent — edit library source and changes show up in the example without a
re-install.

## Developing the package

- **Build the library**: `yarn install` at the root runs `react-native-builder-bob`
  via the `prepare` script. Output lands in `lib/{commonjs,module,typescript}`.
  These are produced for npm consumers; the example uses `src/` directly via
  the `react-native` field in `package.json`.
- **Type-check the source**: `npx tsc -p tsconfig.build.json --noEmit`.
- **Dedup peer deps**: `react`/`react-native` are installed both at the root
  (devDeps, for `bob build` + tsc) and in `example/` (runtime). Metro is
  configured in `example/metro.config.js` to block the root copies and
  redirect every `'react-native'` / `'react'` import to the example's copy
  — a single physical instance at runtime.
- **`.npmrc` at root** sets `legacy-peer-deps=true` so npm doesn't try to
  auto-install our declared peers when someone runs `npm install` at the
  library root.
- **Iterate on the Expo config plugin** by editing files in `plugin/` and
  re-running `npx expo prebuild --clean` in `example/`. The injected blocks
  are wrapped in `@generated` markers and de-duplicated on re-run.

## Upgrading

The repo has four independent upgrade axes — keep them as separate PRs / commits
so [release-please](#releasing) classifies each one correctly. The iOS and
Android SDK versions drift on purpose (see [AGENTS.md](AGENTS.md)) — don't align
them just because they're both bumpable.

### Where to check for new versions

| What | Source |
| --- | --- |
| MotionTag iOS SDK changelog | [api.motion-tag.de/developer/ios?locale=en&os_aspect=changelog](https://api.motion-tag.de/developer/ios?locale=en&os_aspect=changelog) |
| MotionTag iOS integration guide | [api.motion-tag.de/developer/ios?locale=en&os_aspect=sdk](https://api.motion-tag.de/developer/ios?locale=en&os_aspect=sdk) |
| MotionTag Android SDK changelog | [api.motion-tag.de/developer/android?locale=en&os_aspect=changelog](https://api.motion-tag.de/developer/android?locale=en&os_aspect=changelog) |
| MotionTag Android integration guide | [api.motion-tag.de/developer/android?locale=en&os_aspect=sdk](https://api.motion-tag.de/developer/android?locale=en&os_aspect=sdk) |
| Expo SDK upgrade walkthrough | [docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough](https://docs.expo.dev/workflow/upgrading-expo-sdk-walkthrough/) |
| Expo config-plugins changelog | [github.com/expo/expo/.../config-plugins/CHANGELOG.md](https://github.com/expo/expo/blob/main/packages/%40expo/config-plugins/CHANGELOG.md) |
| react-native-builder-bob releases | [github.com/callstack/react-native-builder-bob/releases](https://github.com/callstack/react-native-builder-bob/releases) |
| React Native upgrade helper (rarely needed here) | [react-native-community.github.io/upgrade-helper](https://react-native-community.github.io/upgrade-helper/) |

The two MotionTag changelog endpoints are the authoritative source — the vendor
doesn't publish a GitHub release feed. Both `locale=en` and `locale=de` work.

### Pinned versions to compare against

| Axis | Pinned in | Currently |
| --- | --- | --- |
| iOS SDK | [`react-native-motiontag.podspec`](react-native-motiontag.podspec) | `MotionTagSDK ~> 6.5.0` |
| Android SDK | [`android/build.gradle`](android/build.gradle) | `de.motiontag:tracker:7.2.5` |
| Example Expo SDK | [`example/package.json`](example/package.json) | `expo ~55` |
| Library build tooling | [`package.json`](package.json) | `react-native-builder-bob`, `@expo/config-plugins`, `typescript` |

### When the changelog mentions integration changes

A version bump is **not** "just" a version bump when the changelog touches:

- iOS `Info.plist` keys (especially `BGTaskSchedulerPermittedIdentifiers` and
  `UIBackgroundModes`) → update both the [bare-RN snippet above](#ios--appdelegateswift)
  and the Expo plugin's Info.plist injection in `plugin/`.
- iOS bootstrap signature (`MotionTagBootstrap.bootstrap`,
  `processBackgroundSessionEvents`, `handlesBackgroundURLSession`) → update
  `ios/MotionTagBootstrap.swift`, the README snippet, and the plugin's
  AppDelegate injection. Note: `handlesBackgroundURLSession` hard-codes the
  SDK's background URL session identifier prefixes (`com.motion-tag.` /
  `com.motiontag.`) — re-check them against the SDK binary on every iOS SDK
  bump (`strings MotionTagSDK | grep -i session`).
- Android manifest permissions or foreground-service contract → update
  `android/src/main/AndroidManifest.xml`, the plugin's manifest edits, and the
  Android section above.
- Android bootstrap signature (`MotionTagBootstrap.init`) → update the Kotlin
  source, the README snippet, and the plugin's MainApplication injection.

Treat these as `feat:` (or `feat!:` if hosts must change code) rather than
`fix:` so release-please bumps the minor/major correctly.

### Bumping the example app's Expo SDK

The library itself is SDK-agnostic — only `example/` pins an Expo version:

```sh
cd example
npx expo install expo@<target>
npx expo install --fix              # realigns react, react-native, expo-*
npx expo prebuild --clean           # mandatory across SDK majors
npx expo run:ios && npx expo run:android
```

If the new Expo SDK pulls in an RN version above this package's peer range
(`react-native >=0.79.0`), widen the peer range in the root `package.json` in
the same PR. Don't tighten the lower bound.

### Verifying before opening the PR

After any axis bump:

```sh
yarn install && yarn prepare                        # at the root
npx tsc -p tsconfig.build.json --noEmit             # typecheck
cd example && yarn install
npx expo prebuild --clean
npx expo run:ios                                    # ideally on a device
npx expo run:android                                # ideally on a device
```

Walk the golden path in the example: paste JWT → start → events stream → stop.
Simulators can't generate motion-sensor data, so a physical device is the only
way to fully validate a MotionTag SDK bump.

## Releasing

Releases are fully automated via [release-please](https://github.com/googleapis/release-please)
and npm Trusted Publishing — no manual `npm publish`, no tokens, no
hand-edited changelog.

### The flow

1. Land commits on `main` using [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat: …` — minor bump (`0.1.0` → `0.2.0`)
   - `fix: …` — patch bump (`0.1.0` → `0.1.1`)
   - `feat!: …` or `BREAKING CHANGE:` in body — major bump
   - `chore:`, `docs:`, `refactor:`, `test:`, `ci:` — no bump, but appear
     in the changelog under their respective sections
2. The **Release Please** workflow opens (or updates) a PR titled
   `chore(main): release X.Y.Z`. The PR contains the version bump in
   `package.json`, an updated `CHANGELOG.md` assembled from the commit
   subjects since the last release, and an updated
   `.release-please-manifest.json`.
3. Merge that PR when you're ready to release. Release-please then creates
   the git tag (`vX.Y.Z`) and a matching GitHub Release with the changelog
   body.
4. The `publish` job in the same workflow runs `yarn prepare` (bob build)
   and `npm publish` with npm provenance attached via OIDC.

### One-time npm setup

On npmjs.com → `@panter/react-native-motiontag` → *Settings* →
*Trusted Publisher* → *Add*:

- Publisher: GitHub Actions
- Organization: `panter`
- Repository: `react-native-motiontag`
- Workflow filename: `release-please.yml`
- Environment: *(leave blank)*

No `NPM_TOKEN` secret is required.

### Hotfix / manual override

If you need to publish a version that release-please can't produce (e.g. a
hotfix from a non-`main` branch), bump `package.json` + push manually:

```sh
yarn prepare
npm publish --access public
```

You'll need a local npm auth token for the manual path — Trusted
Publishing only covers the GitHub Actions workflow.
