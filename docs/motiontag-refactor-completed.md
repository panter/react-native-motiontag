# MotionTag refactor — what shipped

Record of the work that landed on `feat/react-native-motiontag-package`,
implementing the plan in `plan-react-native-motiontag.md`. Pre-refactor
architecture is in `motiontag-integration.md` (kept as historical snapshot).

## Commits

| | Subject | Phase |
| --- | --- | --- |
| `64e8c97` | scaffold react-native-motiontag turbo module package | Step 1 |
| `5f7db7b` | define public MotionTag API and codegen spec | Step 2 |
| `4abd3fc` | lift-and-shift native bridge into the package | Steps 3 + 4 + 5 + 6 |
| `e0ca68d` | migrate app callers to MotionTag API, drop legacy shim | Step 7 |
| `bc04ad3` | package README, CLAUDE.md update, archive integration doc | Step 8 |
| `4108feb` | fix podspec homepage attribute, update Podfile.lock | follow-up |
| `868b580` | make iOS + Android builds compile end-to-end | follow-up |

## What's in `modules/react-native-motiontag/`

```
package.json                      private: true; main/types → src/index.ts; codegenConfig RNMotionTagSpec
react-native-motiontag.podspec    s.module_name = "RNMotionTag"; depends MotionTagSDK ~> 6.5.0
tsconfig.json                     bundler module resolution
README.md                         public API + host bootstrap contract
src/
  NativeMotionTag.ts              Turbo Module spec (start/stop/setUserToken/…)
  index.ts                        public MotionTag object + addListener via NativeEventEmitter
  types.ts                        MotionTagEvent discriminated union (Flutter-parity field names)
ios/
  MotionTagModule.{h,mm}          Turbo Module class extending RCTEventEmitter
                                  (filename intentionally not "MotionTag" — the SDK
                                  ships a header with that exact name)
  MotionTagBootstrap.swift        @objc public class — host AppDelegate calls bootstrap(launchOptions:)
                                  and processBackgroundSessionEvents(identifier:completionHandler:)
  MotionTagDelegateImpl.swift     MotionTagDelegate singleton; emits structured events;
                                  401 → stopTracking()
android/
  build.gradle                    declares MotionTag Maven repo + de.motiontag:tracker:7.2.5
  src/main/AndroidManifest.xml    SDK-required permissions (merged into host)
  …/MotionTagModule.kt            Turbo Module extending NativeMotionTagSpec
  …/MotionTagDelegateImpl.kt      object implementing MotionTag.Callback; structured WritableMap
                                  events; 401 → MotionTag.getInstance().stop()
  …/MotionTagBootstrap.kt         host MainApplication calls init(application, notification)
  …/MotionTagPackage.kt           BaseReactPackage registering the module (autolinked)
```

## Host changes

**iOS**

- `ios/AppDelegate.swift` — `import RNMotionTag`. `motionTag.initialize(...)` →
  `MotionTagBootstrap.bootstrap(launchOptions:)`.
  `motionTag.processBackgroundSessionEvents(...)` →
  `MotionTagBootstrap.processBackgroundSessionEvents(identifier:completionHandler:)`.
  Top-level `let motionTag` / `let motionTagManager` removed.
- `ios/cyclomania-Bridging-Header.h` — `#import "TrackingSDK.h"` removed.
- `ios/Podfile` — `pod 'MotionTagSDK', '~> 6.5.0'` removed (transitive via the package's podspec).
- `ios/cyclomania.xcodeproj/project.pbxproj` — file refs for `TrackingSDK.h`,
  `TrackingSDK.m`, `MotionTagManager.swift`, `MotionTagSDK.xcframework`,
  `MotionTagSDK.framework` removed via the `xcodeproj` Ruby gem (5 file refs
  → 0; build phase entries cleaned automatically).
- `ios/TrackingSDK.{h,m}` and `ios/MotionTagManager.swift` deleted.
- `ios/Podfile.lock` regenerated; `react-native-motiontag (0.1.0)` and
  `MotionTagSDK (6.5.0)` resolved via CocoaPods trunk.

**Android**

- `android/app/src/main/java/ch/cyclomania/MainApplication.kt` —
  `motionTag.initialize(this, notification, motionTagManager)` →
  `MotionTagBootstrap.init(this, createNotification())`. Manual
  `add(MotionTagPackage())` removed (now autolinked). The `private val
  motionTag` field is gone. `createNotification()` /
  `createNotificationChannel()` and notification resources stay
  host-owned.
- `android/build.gradle` — nested `allprojects { … }` Maven block
  removed (now declared in the package's gradle).
- `android/app/build.gradle` — `implementation 'de.motiontag:tracker:7.2.5'`
  removed.
- `android/app/src/main/AndroidManifest.xml` — `ACCESS_BACKGROUND_LOCATION`,
  `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACTIVITY_RECOGNITION`,
  `FOREGROUND_SERVICE_LOCATION` removed (manifest merger pulls them via
  the package). `INTERNET`, `READ_EXTERNAL_STORAGE`,
  `WRITE_EXTERNAL_STORAGE`, `READ_CONTACTS` kept.
- `android/app/src/main/java/ch/cyclomania/MotionTagModule.kt`,
  `MotionTagManager.kt`, `MotionTagPackage.java` deleted.

**App JS**

- `src/lib/TrackingSDK.ts` deleted entirely.
- `src/hooks/useTrackingChecks.ts` — `TrackingSDK.startTracking({jwt})` →
  `MotionTag.setUserToken(jwt)` then `MotionTag.start()`;
  `isLocationTrackingEnabled` → `MotionTag.isTrackingActive`; `setUserToken`
  / `stopTracking` renamed. New `useEffect` subscribes to
  `MotionTag.addListener` and triggers `setShowTrackingDeactivatedDialog(true)`
  directly when `event.type === 'transmissionError' && event.errorCode === 401`
  — eliminates the substring-match path through `isTokenValid`.
- `src/modules/tracking/model.ts` — `initTrackingSdk` thunk now only
  subscribes to the `'log'` event channel for diagnostic forwarding into
  `getStoreActions().debug.log`. `stopTracking` thunk calls `MotionTag.stop()`.
- `src/modules/debug/components/DebugInfo.tsx` — calls `MotionTag.isTrackingActive()`.

**Workspace**

- Root `package.json` — added `"workspaces": ["modules/*"]` and
  `"react-native-motiontag": "*"` dependency. Yarn 3 symlinks
  `node_modules/react-native-motiontag → modules/react-native-motiontag`.

**Docs**

- `CLAUDE.md` — long pre-refactor MotionTag block replaced with short
  pointer to the package README + bootstrap-call requirement + 401 handling
  note.
- `docs/motiontag-integration.md` — banner at top marking it as the
  pre-refactor snapshot.

## Key design decisions

1. **Source-only TS package, no `react-native-builder-bob`.** The workspace
   resolves `main: "./src/index.ts"` directly via Metro. Avoids a build step
   for a private package.
2. **iOS naming.** ObjC class `MotionTagModule` (not `MotionTag`) to dodge
   the SDK's own `MotionTag` type. Pod `s.module_name = "RNMotionTag"` so
   the host can `import RNMotionTag` from Swift.
3. **iOS: keep Swift for the delegate.** Ported `MotionTagManager.swift`
   verbatim into the package as `MotionTagDelegateImpl.swift` rather than
   rewriting in ObjC. Keeps the `MotionTagDelegate` interop straightforward.
4. **Structured events landed in the same commit as lift-and-shift**, not
   a follow-up. The legacy shim's `registerLogger` filters
   `event.type === 'log'` from the structured stream, so we only need one
   wire format from day one.
5. **Pre-RN events drop**, no ring buffer. Documented in the README. The
   3-second JS reconciler re-establishes state, so the loss is bounded.
6. **`addListener` allows multiple subscribers**, drops the implicit
   single-listener contract today's `registerLogger` had.
7. **Notification stays host-owned (Android).** `MotionTagBootstrap.init`
   takes a `Notification` as a parameter; channel id, copy, icon stay in
   the host. The package's README documents this contract.
8. **Smell fixes folded into the move:** iOS `dispatch_sync` →
   `dispatch_async`, `__weak self` in the event-callback closure;
   Android static `companion var reactContext` replaced with
   `reactApplicationContext` from the base class; duplicated `CHANNEL_ID`
   gone (only in `MainApplication.kt`); unused imports gone.

## Build-time gotchas surfaced (now fixed in `868b580`)

The first end-to-end build round flushed out three things the plan didn't
anticipate. Worth keeping handy for future SDK-bump work:

1. **Android Maven repo can't live in the package alone.** RN 0.85's
   `com.facebook.react.rootproject` plugin centralises dependency
   resolution and ignores subproject `repositories { … }` blocks, so the
   MotionTag azure repo is back at the root project's top-level
   `allprojects { repositories { … } }`. The package's own gradle still
   declares it (harmless redundancy if/when the centralisation behaviour
   changes), but the root is what actually takes effect.
2. **Android v7 SDK accessor names.** What I guessed vs. what `tracker-7.2.5.aar`
   actually exposes:
   - `TransmissionEvent.Error` has `errorMessage`, `errorCode`, `timestamp` only —
     **no** `error` field, **no** `trackedFrom` / `trackedTo`. Drop those
     from the structured event on Android (they stay populated on
     `transmissionSuccess`).
   - `BatteryOptimizationsChangedEvent.areBatteryOptimizationsEnabled` →
     `isEnabled`. Same for `PowerSaveModeChangedEvent.isPowerSaveModeEnabled`
     → `isEnabled`.
   - `MotionTag.isWifiOnlyDataTransferEnabled` → property
     `wifiOnlyDataTransfer`.
   - `MotionTag.clearData()` is asynchronous and takes a
     `Function0<Unit>` `onComplete` callback; resolve the JS promise
     from inside the callback.
3. **iOS header / Swift bridge interop.** Three fixes wrapped together:
   - `MotionTagSDK` ships a header named `MotionTag.h`. Our pod's header
     of the same name caused header-search-path collisions (whichever
     came first in the search order won). Renamed to `MotionTagModule.{h,mm}`.
   - The codegen-generated `<RNMotionTagSpec/RNMotionTagSpec.h>` is C++
     and poisons the pod's umbrella header if exposed there — Swift
     compilation in our pod fails with "must be compiled as Obj-C++".
     Moved the `<NativeMotionTagSpec>` protocol conformance from the
     public `@interface` into a class extension in `MotionTagModule.mm`.
   - The auto-generated Swift→ObjC bridge `RNMotionTag-Swift.h`
     references `MotionTagDelegate` (the SDK protocol) because
     `MotionTagDelegateImpl: NSObject, MotionTagDelegate` is `@objc`.
     ObjC consumers of that bridge need the SDK header imported first;
     `MotionTagModule.mm` now `#import <MotionTagSDK/MotionTagSDK.h>`
     before `<RNMotionTag/RNMotionTag-Swift.h>`.

iOS v6 SDK does not expose `getUserToken` / `clearData` /
`setWifiOnlyDataTransfer` per the plan doc; those resolve to
`NSNull` / `false` or reject `'UNSUPPORTED'`.

## What was verified locally

- `yarn install` — workspace symlink created cleanly.
- `npx react-native config` — autolinking detects the package on iOS and
  Android.
- `yarn lint` — 0 errors (only pre-existing warnings).
- `yarn test` — passes (no tests).
- `npx tsc --noEmit` — 0 new errors from changed files.
- `pod install` — codegen ran (`RNMotionTagSpec` generated),
  `react-native-motiontag` resolved as workspace path-dep,
  `MotionTagSDK 6.5.0` resolved transitively from CocoaPods trunk.
- **Android `./gradlew assembleDebug`** — full APK builds clean
  (`BUILD SUCCESSFUL`, 704 actionable tasks).
- **iOS `xcodebuild -workspace cyclomania.xcworkspace -scheme cyclomania
  -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' build`**
  — `** BUILD SUCCEEDED **`.

## What still needs verification

Smoke tests on real devices — see plan doc §9. Load-bearing checks:
cold start with valid JWT → `isSdkTracking` true within ~6 s; toggle
off → false within one polling cycle; JWT expiry → deactivation dialog;
401 from server → `transmissionError` flips the dialog *directly* (new
behaviour from this refactor); 5-min background → `transmissionSuccess`
events still arriving (foreground service on Android, background
URLSession on iOS); force-quit relaunch → tracking auto-resumes.
