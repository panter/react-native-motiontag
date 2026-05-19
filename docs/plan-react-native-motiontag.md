# Plan: stand-alone `react-native-motiontag` package

A plan for extracting the in-app MotionTag bridge (currently hand-written
inside the iOS and Android app targets) into an independent npm package that
can be consumed via autolinking, with a modern Turbo Module surface that
mirrors the [official Flutter SDK](https://github.com/MOTIONTAG/motiontag-sdk-flutter).

The current integration is fully documented in [`motiontag-integration.md`](./motiontag-integration.md);
this plan assumes that as the starting point and only re-states facts when
they drive a decision.

---

## 1. Goal & non-goals

**Goal.** Ship `react-native-motiontag@0.1.0` as a private package (initially
a workspace path-dep at `modules/react-native-motiontag/`) that:

- Exposes the same functionality as today's `TrackingSDK` JS module, plus
  parity with the Flutter SDK (`getUserToken`, `clearData`, structured
  events).
- Uses the **New Architecture** (Turbo Modules + JSI) — RN 0.85 in this app
  already has `newArchEnabled=true` (`android/gradle.properties`) and ships
  the new `RCTReactNativeFactory` boot path on iOS (`ios/AppDelegate.swift`),
  so there is no reason to build legacy-bridge code paths.
- Is autolinked on both platforms (no manual `MotionTagPackage()` add in
  `MainApplication.kt`, no manual files in the iOS app target).
- Replaces the `TrackingLogger` stringly-typed event channel with a
  structured event API while keeping a back-compat shim so the JS callers
  in `src/modules/tracking/model.ts` and `src/hooks/useTrackingChecks.ts`
  can be migrated incrementally.

**Non-goals.**

- Aligning the iOS and Android native SDK versions. iOS uses MotionTag v6,
  Android uses v7 (see integration doc §2). The package will keep the same
  versions and isolate the divergence behind a shared TS contract.
- Publishing to npm. Stay private (workspace path dep, then later a private
  registry if needed).
- Open-sourcing. The bridge is project-specific code wrapping a vendor SDK
  with credentialed Maven access.
- Becoming an Expo module. See §2 for the rationale.

---

## 2. Approach: Turbo Module via `create-react-native-library`

Three viable options were considered:

| Option | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| **`create-react-native-library --type module-new`** (Callstack) | Zero runtime deps. Generates Turbo-Module spec + Kotlin/Swift skeletons. Standard RN library layout. Codegen wired in `package.json`. | Slightly more boilerplate than Expo's DSL. | ✅ **Recommended** |
| `create-expo-module` | Nicer Swift/Kotlin DSL (`Module { Function(…) Events(…) }`). Auto-handles new-arch + old-arch. | Forces `expo` runtime as a transitive dep on this app. The app currently uses **no** Expo packages — adding the `expo` package, its `install-expo-modules` config, the iOS deployment-target bump to 15.1, and the AppDelegate subspec wiring is a meaningful footprint just for this one module. | ❌ Too much footprint for a single module |
| Hand-rolled Turbo Module | Full control. | Re-implements what the templates already do correctly. Easy to drift from RN 0.85 conventions. | ❌ |

Decision: **`create-react-native-library --type module-new`** (Turbo Module,
new-arch only). Rationale: matches the app's current architecture, no
runtime deps, well-documented community standard, the codegen pipeline is
already battle-tested in RN 0.85.

If we ever migrate the app to Expo, the package can be repackaged later —
the JS surface and native logic are independent of the wrapper choice.

---

## 3. Target public API

Designed to be a strict superset of today's `src/lib/TrackingSDK.ts` and to
match Flutter's public API where it makes sense.

### 3.1 TypeScript spec — `src/NativeMotionTag.ts`

```ts
import type { TurboModule } from 'react-native'
import { TurboModuleRegistry } from 'react-native'

export interface Spec extends TurboModule {
  // Lifecycle — token must be set before start()
  start(): Promise<void>
  stop(): Promise<void>

  // Auth
  setUserToken(jwt: string): Promise<void>
  getUserToken(): Promise<string | null>

  // State
  isTrackingActive(): Promise<boolean>
  isPowerSaveModeEnabled(): Promise<boolean>          // android-only; resolves false on iOS
  isBatteryOptimizationsEnabled(): Promise<boolean>   // android-only; resolves false on iOS

  // Configuration
  getWifiOnlyDataTransfer(): Promise<boolean>
  setWifiOnlyDataTransfer(wifiOnly: boolean): Promise<void>

  // Data
  clearData(): Promise<void>

  // Event subscription is handled via the EventEmitter API on RN 0.85
  // (replaces RCTEventEmitter / DeviceEventManagerModule.RCTDeviceEventEmitter).
  addListener(eventName: string): void
  removeListeners(count: number): void
}

export default TurboModuleRegistry.getEnforcing<Spec>('MotionTag')
```

`addListener` / `removeListeners` are the codegen-required no-op stubs for
event-emitting Turbo Modules in RN 0.85.

### 3.2 Public JS surface — `src/index.ts`

```ts
import NativeMotionTag from './NativeMotionTag'
import { EventEmitter, type EventSubscription } from 'react-native'

// Field names mirror the Flutter SDK (LocationEvent.latitude / longitude /
// horizontalAccuracy / speed / altitude / bearing, TransmissionSuccess.trackedFrom /
// trackedTo, TransmissionError.error) so a third-party app porting from Flutter
// can swap `setObserver` → `addListener` and reuse the same event payloads.
export type MotionTagEvent =
  | { type: 'started' }
  | { type: 'stopped' }
  | {
      type: 'location'
      timestamp: number          // epoch ms (Flutter exposes a DateTime built from the same value)
      latitude: number
      longitude: number
      horizontalAccuracy: number
      speed: number
      altitude: number
      bearing: number
    }
  | { type: 'transmissionSuccess'; trackedFrom: number; trackedTo: number }
  | {
      type: 'transmissionError'
      error: string                // Flutter parity: stringified native error
      errorCode?: number           // RN extension — iOS/Android both expose it (e.g. 401)
      trackedFrom?: number         // RN extension — both native sides know the window
      trackedTo?: number
    }
  | { type: 'authorization'; status: 'granted' | 'denied' | 'restricted' | 'whenInUse'; precise?: boolean } // ios-only
  | { type: 'powerSaveModeChanged'; enabled: boolean }       // android-only
  | { type: 'batteryOptimizationsChanged'; enabled: boolean } // android-only
  // Free-text fall-through for events the wrapper does not yet model.
  | { type: 'log'; message: string }

const emitter = new EventEmitter()

export const MotionTag = {
  start: () => NativeMotionTag.start(),
  stop: () => NativeMotionTag.stop(),
  setUserToken: (jwt: string) => NativeMotionTag.setUserToken(jwt),
  getUserToken: () => NativeMotionTag.getUserToken(),
  isTrackingActive: () => NativeMotionTag.isTrackingActive(),
  isPowerSaveModeEnabled: () => NativeMotionTag.isPowerSaveModeEnabled(),
  isBatteryOptimizationsEnabled: () => NativeMotionTag.isBatteryOptimizationsEnabled(),
  getWifiOnlyDataTransfer: () => NativeMotionTag.getWifiOnlyDataTransfer(),
  setWifiOnlyDataTransfer: (wifiOnly: boolean) => NativeMotionTag.setWifiOnlyDataTransfer(wifiOnly),
  clearData: () => NativeMotionTag.clearData(),

  addListener: (cb: (e: MotionTagEvent) => void): EventSubscription =>
    emitter.addListener('MotionTagEvent', cb),
}

export default MotionTag
```

Two notable departures from today's API:

- **No `initializeTracking()` JS call.** Initialisation is a *native* concern
  (it has to run before RN starts) and is now done by the host
  `AppDelegate` / `MainApplication` calling a single bootstrap method on
  the package. See §5.
- **Multiple subscribers are allowed.** Today's `registerLogger` clobbers
  any existing listener (see integration doc §5). The new API returns an
  `EventSubscription` that the caller `.remove()`s.

### 3.3 Mapping to Flutter

Goal: a third-party app currently on the Flutter SDK should be able to drop
the package in and reuse the same code with only the listener-registration
shape changed. Field names inside events match Flutter exactly.

| Flutter `MotionTag` | This package | Notes |
| --- | --- | --- |
| `start()` | `MotionTag.start()` | identical |
| `stop()` | `MotionTag.stop()` | identical |
| `setUserToken(String)` | `MotionTag.setUserToken(jwt)` | identical |
| `getUserToken()` | `MotionTag.getUserToken()` | new — not in current bridge; trivial to add since both SDKs expose it |
| `isTrackingActive()` | `MotionTag.isTrackingActive()` | renamed from `isLocationTrackingEnabled` and unwrapped to `Promise<boolean>` (today returns `{isEnabled}`) |
| `isPowerSaveModeEnabled()` | `MotionTag.isPowerSaveModeEnabled()` | identical; resolves `false` on iOS like Flutter does |
| `isBatteryOptimizationsEnabled()` | `MotionTag.isBatteryOptimizationsEnabled()` | identical; resolves `false` on iOS like Flutter does |
| `getWifiOnlyDataTransfer()` | `MotionTag.getWifiOnlyDataTransfer()` | identical |
| `setWifiOnlyDataTransfer(bool)` | `MotionTag.setWifiOnlyDataTransfer(v)` | identical |
| `setObserver(cb)` | `MotionTag.addListener(cb)` | RN convention — listener add returns `EventSubscription`; multiple subscribers allowed |
| `clearData()` | `MotionTag.clearData()` | new |
| `StartedEvent` / `StoppedEvent` | `{ type: 'started' }` / `{ type: 'stopped' }` | discriminated union instead of class hierarchy |
| `LocationEvent { timestamp, latitude, longitude, horizontalAccuracy, speed, altitude, bearing }` | `{ type: 'location', … }` with the same field names | `timestamp` stays as epoch ms (Flutter wraps it in `DateTime` on top of the same value) |
| `TransmissionSuccessEvent { trackedFrom, trackedTo }` | `{ type: 'transmissionSuccess', trackedFrom, trackedTo }` | identical fields |
| `TransmissionErrorEvent { error }` | `{ type: 'transmissionError', error, errorCode?, trackedFrom?, trackedTo? }` | `error` matches Flutter; `errorCode` / `trackedFrom` / `trackedTo` are RN-only extensions exposed by both native SDKs (e.g. lets JS branch on 401 directly) |

### 3.4 Back-compat shim for existing app code

To keep `src/lib/TrackingSDK.ts`, `src/hooks/useTrackingChecks.ts`,
`src/modules/tracking/model.ts`, and `src/modules/debug/components/DebugInfo.tsx`
working through the migration window, the package ships a thin compat
module:

```ts
// react-native-motiontag/src/legacy.ts
import MotionTag, { type MotionTagEvent } from './index'

export const initTrackingSDK = () => {} // no-op — native handles init now

export const registerLogger = (cb: (msg: string) => void) => {
  return MotionTag.addListener((e: MotionTagEvent) => {
    cb(e.type === 'log' ? e.message : `SDK ${e.type}: ${JSON.stringify(e)}`)
  })
}

export const startTracking = ({ jwt }: { jwt: string }) =>
  MotionTag.setUserToken(jwt).then(() => MotionTag.start())

export const stopTracking = () => MotionTag.stop()

export const setUserToken = (jwt: string) => MotionTag.setUserToken(jwt)

export const isLocationTrackingEnabled = () => MotionTag.isTrackingActive()
```

The shim only covers what the current app needs. The new Flutter-parity
methods (`getUserToken`, `clearData`, `isPowerSaveModeEnabled`,
`isBatteryOptimizationsEnabled`, `getWifiOnlyDataTransfer`,
`setWifiOnlyDataTransfer`) are reachable via the modern `MotionTag` import
only — they have no legacy equivalents to mirror.

Then `src/lib/TrackingSDK.ts` becomes a one-liner re-export of
`react-native-motiontag/legacy` and existing call sites stay unchanged.

---

## 4. Package layout

Following the `create-react-native-library --type module-new` template,
trimmed to what we actually need:

```
modules/react-native-motiontag/
├── package.json
├── react-native.config.js
├── tsconfig.json
├── react-native-motiontag.podspec
├── src/
│   ├── index.ts                ← public JS entrypoint (MotionTag)
│   ├── legacy.ts               ← back-compat shim for current app code
│   ├── NativeMotionTag.ts      ← Turbo-Module spec (codegen input)
│   └── types.ts                ← MotionTagEvent + helpers
├── ios/
│   ├── MotionTag.h             ← bootstrap header (host AppDelegate imports this)
│   ├── MotionTag.mm            ← Turbo-Module class + bootstrap impl
│   └── MotionTagDelegateImpl.swift ← MotionTagDelegate; emits structured events
├── android/
│   ├── build.gradle
│   ├── src/main/AndroidManifest.xml   ← permissions merged into host manifest
│   └── src/main/java/com/motiontag/rn/
│       ├── MotionTagModule.kt          ← Turbo-Module impl
│       ├── MotionTagPackage.kt         ← BaseReactPackage / TurboReactPackage
│       └── MotionTagBootstrap.kt       ← static init helper (host MainApplication calls)
└── lib/                        ← built JS (gitignored, tsc output)
```

`package.json` essentials:

```jsonc
{
  "name": "react-native-motiontag",
  "version": "0.1.0",
  "private": true,
  "main": "lib/commonjs/index.js",
  "module": "lib/module/index.js",
  "types": "lib/typescript/src/index.d.ts",
  "files": ["src", "lib", "android", "ios", "*.podspec", "react-native.config.js"],
  "codegenConfig": {
    "name": "RNMotionTagSpec",
    "type": "modules",
    "jsSrcsDir": "src",
    "android": { "javaPackageName": "com.motiontag.rn" }
  },
  "peerDependencies": { "react": "*", "react-native": "*" }
}
```

`react-native.config.js` for autolinking:

```js
module.exports = {
  dependency: {
    platforms: {
      ios: { podspecPath: __dirname + '/react-native-motiontag.podspec' },
      android: { sourceDir: './android' },
    },
  },
}
```

---

## 5. The init-before-RN constraint (most important detail)

Both platforms require that `MotionTag.initialize(…)` runs *before* React
Native starts (integration doc §6.3). Turbo Modules are instantiated lazily
on first JS access — they cannot run pre-RN init themselves. The package
therefore exposes a small **bootstrap entry point** that the host app calls
from `AppDelegate` / `MainApplication`. This is unavoidable; mirror what
e.g. `react-native-firebase` does for `FirebaseApp.configure()`.

### 5.1 iOS bootstrap

`ios/MotionTag.h` (public — imported by the host `AppDelegate`):

```objc
#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

@interface MotionTag : NSObject
+ (void)bootstrapWithLaunchOptions:(NSDictionary *)launchOptions;
+ (void)processBackgroundSessionEventsWithIdentifier:(NSString *)identifier
                                  completionHandler:(void (^)(void))completionHandler;
@end
```

Host `ios/AppDelegate.swift` change (replaces today's MotionTag block):

```swift
import react_native_motiontag    // module-map name from the podspec

func application(_ application: UIApplication,
                 didFinishLaunchingWithOptions launchOptions: …) -> Bool {
  MotionTag.bootstrap(withLaunchOptions: launchOptions)   // ← was motionTag.initialize(using:launchOption:)
  // … unchanged React Native bootstrap …
}

func application(_ application: UIApplication,
                 handleEventsForBackgroundURLSession identifier: String,
                 completionHandler: @escaping () -> Void) {
  MotionTag.processBackgroundSessionEvents(withIdentifier: identifier,
                                           completionHandler: completionHandler)
}
```

Inside the package, `MotionTagDelegateImpl.swift` (the `MotionTagDelegate`)
publishes structured events into a process-wide queue. The Turbo-Module
class (`MotionTag.mm`) reads from that queue and emits via `EventEmitter` —
this decouples init (which must happen pre-RN) from the JS bridge (which
appears later). Use a small thread-safe ring buffer keyed by event id so
events delivered before JS subscribes are not lost.

### 5.2 Android bootstrap

`MotionTagBootstrap.kt`:

```kotlin
object MotionTagBootstrap {
  fun init(application: Application, notification: Notification) {
    val callback = MotionTagDelegateImpl  // emits structured events
    MotionTag.getInstance().initialize(application, notification, callback)
  }
}
```

Host `MainApplication.kt` change:

```kotlin
override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    MotionTagBootstrap.init(this, createNotification())  // ← was motionTag.initialize(...)
}
```

The notification stays in the host app for now — it owns the
channel id (`ch.cyclomania.tracking`), the `R.string.notification_*`
resources, and the `R.drawable.ic_notification` asset (integration doc
§4.2). Moving them into the package would mean the package owns user-facing
copy + branding, which is wrong. Document this explicitly in the package
README: *the host app must build and pass a `Notification`*.

The `MotionTagPackage` is autolinked via the `package.json` codegen config,
so the manual `add(MotionTagPackage())` line in
`MainApplication.kt:34` goes away.

---

## 6. Native implementation — what changes vs today

This is mostly a **lift-and-shift** of the files in §3–§4 of the
integration doc, with these substantive changes:

### 6.1 iOS

| Today | After |
| --- | --- |
| `ios/TrackingSDK.{h,m}` (RCTEventEmitter, ObjC bridge module) | `ios/MotionTag.mm` — Turbo Module conforming to the codegen-generated `RNMotionTagSpec` protocol; emits via `EventEmitter` (RN 0.85 replacement for `RCTEventEmitter`) |
| `ios/MotionTagManager.swift` (delegate + log-string formatter) | `ios/MotionTagDelegateImpl.swift` — same delegate, but emits **structured** events (`{ type: 'transmissionError', error, errorCode: 401, … }`) instead of preformatted strings |
| `ios/cyclomania-Bridging-Header.h` includes `TrackingSDK.h` | nothing — package is self-contained; its umbrella header lives in the pod |
| Pod added in app `ios/Podfile` (`pod 'MotionTagSDK', '~> 6.5.0'`) | Pod added in `react-native-motiontag.podspec` via `s.dependency 'MotionTagSDK', '~> 6.5.0'`; auto-resolved on `pod install` after autolinking |
| `xcframework`/`framework` references in `cyclomania.xcodeproj/project.pbxproj` | removed — CocoaPods owns the framework lookup |
| `dispatch_sync(main)` in `startTracking:` | `dispatch_async(main, ^{ … })` — fixes the latent deadlock (integration doc §3.3 / smell #4) |
| Logger callback strongly captures `self` | `__weak typeof(self) weakSelf = self;` capture — fixes retain extension (smell #3) |
| `initializeTracking` as a JS-callable method | gone — init is the native bootstrap (§5) |

Podspec sketch:

```ruby
Pod::Spec.new do |s|
  s.name         = "react-native-motiontag"
  s.version      = "0.1.0"
  s.platforms    = { :ios => "13.0" }
  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.dependency   "MotionTagSDK", "~> 6.5.0"
  install_modules_dependencies(s)   # codegen + RN deps
end
```

### 6.2 Android

| Today | After |
| --- | --- |
| `MotionTagModule.kt` (`ReactContextBaseJavaModule`) | Same class name, but extends the codegen-generated `NativeMotionTagSpec` (Turbo) under `com.motiontag.rn` |
| `MotionTagManager.kt` (singleton + `MotionTag.Callback` formatting log strings) | `MotionTagDelegateImpl.kt` — same callback, emits structured events |
| `MotionTagPackage.java` registered manually in `MainApplication.kt` | `MotionTagPackage.kt` auto-registered by codegen (drop `add(MotionTagPackage())`) |
| Module stores `reactContext` in `companion object var` | Use `reactApplicationContext` from base class (smell #5) |
| Maven repo declared in `android/build.gradle` `allprojects` (nested in `buildscript`, awkward) | Declared in the package's `android/build.gradle` (so the package is self-contained), and the host `android/build.gradle` reduces to whatever is needed for autolinking |
| `de.motiontag:tracker:7.2.5` in app `app/build.gradle` | Same dep declared in the package's `build.gradle` |
| Permissions in app `AndroidManifest.xml` | Declared in the package's `AndroidManifest.xml`; merged into the host manifest by Gradle. Document any non-default permissions (esp. `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION`) so Play Console reviews aren't surprising |

Codegen-generated spec class will be `NativeMotionTagSpec` under
`com.motiontag.rn`; the implementation class (`MotionTagModule`) implements
it.

### 6.3 Notification ownership (Android)

The foreground-service notification stays in the host app (see §5.2). The
package's README must document the contract:

> **Required host setup (Android):** call
> `MotionTagBootstrap.init(this, notification)` from `Application.onCreate`.
> The `Notification` must be on a channel created by your app and is shown
> for as long as tracking is active.

Optionally provide a small helper `MotionTagBootstrap.defaultNotification(context, channelId, title, text, smallIcon)` to reduce boilerplate, but
do not impose copy/branding from the package.

---

## 7. Structured events — wire format

Today's bridge collapses everything into `{ msg: string }` (integration
doc §6/§7). Replace with a discriminated-union JSON event:

Field names match the Flutter SDK so payloads are interchangeable.

| iOS source | Android source | JS event |
| --- | --- | --- |
| `MotionTagDelegate.trackingStatusChanged(true)` | `AutoStartEvent` | `{ type: 'started' }` |
| `MotionTagDelegate.trackingStatusChanged(false)` | `AutoStopEvent` | `{ type: 'stopped' }` |
| `MotionTagDelegate.didTrackLocation(_:)` | `LocationEvent` | `{ type: 'location', timestamp, latitude, longitude, horizontalAccuracy, speed, altitude, bearing }` |
| `MotionTagDelegate.dataUploadWithTracked(from:to:didCompleteWithError:nil)` | `TransmissionEvent.Success` | `{ type: 'transmissionSuccess', trackedFrom, trackedTo }` |
| same with `error` | `TransmissionEvent.Error` | `{ type: 'transmissionError', error, errorCode, trackedFrom, trackedTo }` |
| `MotionTagDelegate.locationAuthorizationStatusDidChange(_:precise:)` | (n/a — Android handles auth differently) | `{ type: 'authorization', status, precise }` |
| (n/a) | `BatteryOptimizationsChangedEvent` | `{ type: 'batteryOptimizationsChanged', enabled }` |
| (n/a) | `PowerSaveModeChangedEvent` | `{ type: 'powerSaveModeChanged', enabled }` |
| anything else | anything else | `{ type: 'log', message: <stringified> }` |

This unblocks `useTrackingChecks` reacting *directly* to a 401 (today it
substring-matches `"Unauthorized token"`, integration doc §6.4 / smell
#13). With a structured event, JS can do:

```ts
MotionTag.addListener(e => {
  if (e.type === 'transmissionError' && e.errorCode === 401) {
    storeActions.tracking.setShowTrackingDeactivatedDialog(true)
  }
})
```

…and we can finally remove the duplicated 401-stop logic from the native
side (or keep it as defence-in-depth and document it).

---

## 8. Migration plan inside this app

Phased so each step is independently shippable.

**Phase 0 — scaffold.** Run `npx create-react-native-library@latest
react-native-motiontag --type module-new --languages kotlin-objc` into
`modules/react-native-motiontag/`. Wire it as a Yarn workspace path-dep
(`"react-native-motiontag": "*"` in root `package.json`, plus a workspaces
entry covering `modules/*`).

**Phase 1 — bring native code over, keep JS surface identical.**
- Move `ios/TrackingSDK.{h,m}`, `ios/MotionTagManager.swift` into the
  package as Turbo-Module sources; rename module to `MotionTag` but keep
  emitting the legacy `TrackingLogger` event for now.
- Move the Android files into the package; keep JS module name
  `TrackingSDK` for one release.
- Replace app-side init with `MotionTag.bootstrap(...)`.
- Replace `src/lib/TrackingSDK.ts` with a re-export of the package's
  legacy shim.
- App still uses `initTrackingSDK / registerLogger / startTracking({jwt})`
  exactly as today (integration doc §5).
- Verify on iOS + Android (golden path, plus 401 → re-login flow).

**Phase 2 — switch to structured events.**
- Add the structured event emitter on both platforms.
- Update `useTrackingChecks` to consume structured events directly for the
  401 case; remove the `"Unauthorized token"` substring match.
- Remove the legacy shim's string formatting; `registerLogger` now
  receives a stringified structured event for diagnostic logging only.

**Phase 3 — adopt the new public API.**
- Migrate `src/modules/tracking/model.ts`, `src/hooks/useTrackingChecks.ts`,
  `src/modules/debug/components/DebugInfo.tsx` to import from
  `react-native-motiontag` directly:
  - `TrackingSDK.startTracking({ jwt })` → `MotionTag.setUserToken(jwt).then(MotionTag.start)`
  - `TrackingSDK.isLocationTrackingEnabled()` → `MotionTag.isTrackingActive()`
  - `TrackingSDK.registerLogger(cb)` → `MotionTag.addListener(cb)`
- Delete `src/lib/TrackingSDK.ts` and the package's `legacy.ts`.

**Phase 4 — cleanup.** Address all the smells in integration doc §8 that
were not already absorbed (`@async`-but-sync wrappers, `dispatch_sync`,
unused imports, single-listener implicit contract, etc.).

---

## 9. Testing & rollout

- **Unit tests in the package.** Jest + a `__mocks__/NativeMotionTag.ts`
  that fakes the Turbo Module so JS-side logic is testable. The app's Jest
  config already runs with `--passWithNoTests` so adding real tests does
  not cost us.
- **Smoke tests on devices.** The 3-second reconciler in
  `useTrackingChecks` (integration doc §6.2) is the integration test in
  practice. Manual checklist for each phase:
  1. Cold start with valid JWT → SDK reports `isTrackingActive=true`
     within ~6 s.
  2. Toggle `TrackingSwitch` off → SDK reports `false`.
  3. Force-expire the JWT → `TrackingDeactivatedDialog` appears; verify
     the native side has stopped tracking.
  4. Background the app for 5 min → `transmission` events still arriving
     (foreground service on Android, background URLSession on iOS).
  5. Kill + relaunch with `isTracking` persisted → tracking auto-resumes.
- **Beta channels.** Ship Phase 1 to an internal Cyclomania TestFlight /
  Play internal track build before merging to `master`. Phase 2/3 can
  ride the normal release train.

---

## 10. Expo compatibility

The library is a standard Turbo Module, so it travels well — but the
bootstrap requirement (§5) means *managed-workflow* consumers will need an
Expo config plugin. Below is what works today and what needs to be added
later.

| Consumer | Works out of the box? | What's needed |
| --- | --- | --- |
| Plain React Native (this app) | ✅ | Manual `MotionTag.bootstrap(…)` calls in `AppDelegate.swift` / `MainApplication.kt`, as documented in §5. |
| Expo **bare** workflow | ✅ | Same manual edits as above — bare-workflow apps own their native projects. Autolinking via `react-native.config.js` picks up the package automatically. |
| Expo **prebuild / managed** workflow (EAS Build) | ⚠️ Needs a config plugin | Managed-workflow consumers can't hand-edit `AppDelegate` / `MainApplication`. The package must ship an `app.plugin.js` that injects the bootstrap calls + Info.plist keys + Android permissions at `expo prebuild` time. |
| Expo Go | ❌ Never | Custom native code is incompatible with Expo Go by design. This already excludes most of the deps in this app, so it's not a regression. |

### 10.1 What the config plugin would do

A purely additive `app.plugin.js` at the package root, ~50–80 lines, using
the helpers from `@expo/config-plugins`:

- **iOS** (`withAppDelegate`): inject `import react_native_motiontag` and
  the two `MotionTag.bootstrap(...)` / `processBackgroundSessionEvents`
  calls into `AppDelegate.swift` at the right insertion points.
- **iOS** (`withInfoPlist`): write the location/motion usage description
  keys (`NSLocationAlwaysAndWhenInUseUsageDescription`,
  `NSLocationWhenInUseUsageDescription`, `NSMotionUsageDescription`).
  Strings come from plugin options so the host app controls the copy.
- **iOS** (`withEntitlementsPlist` / `withXcodeProject`): enable
  Background Modes — Location updates and Background fetch.
- **Android** (`withMainApplication`): inject the
  `MotionTagBootstrap.init(this, createNotification())` call into
  `onCreate`, plus a `createNotification()` helper.
- **Android** (`withAndroidManifest`): merge the SDK-required permissions
  (`ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`,
  `ACTIVITY_RECOGNITION`, `ACCESS_COARSE_LOCATION`,
  `FOREGROUND_SERVICE_LOCATION`).
- **Android** (`withStringsXml`): write `notification_channel_name` /
  `notification_tracking_active` strings (taken from plugin options for
  i18n).

Plugin shape consumers would use:

```js
// app.json
{
  "expo": {
    "plugins": [
      ["react-native-motiontag", {
        "iosLocationUsage": "We track your trips to award challenges.",
        "iosMotionUsage": "We use motion data to detect cycling.",
        "androidNotification": {
          "title": "Cyclomania",
          "text": "Movement tracking is active",
          "channelId": "ch.cyclomania.tracking"
        }
      }]
    ]
  }
}
```

### 10.2 Why ship the plugin later, not now

The plugin is **purely additive** — it doesn't change the JS API, the
native code, the autolinking config, or the bare-workflow integration.
Adding it later is a non-breaking minor-version bump. There is no Expo
managed-workflow consumer today (this app is plain RN, no `expo` package
installed), so spending time on a plugin we can't smoke-test against a
real consumer is premature.

The plan: ship Phases 0–4 as written; add the config plugin when a
concrete Expo managed-workflow consumer materialises (or pre-emptively
once the library API is frozen at v1.0).

---

## 11. Risks & open questions

1. **iOS New-Arch + `EventEmitter` API.** RN 0.85 changed the recommended
   event-emitter API; verify that the `EventEmitter` instance set up in
   `MotionTag.mm` correctly bridges to JS without the legacy
   `RCTEventEmitter` machinery. If something blocks, fall back to the
   `RCTEventEmitter` interop until the package goes pure-JSI.

2. **MotionTag SDK v6 vs v7 API differences** (integration doc §7) —
   confirm both expose `getUserToken` and `clearData`. If iOS v6 doesn't
   expose `clearData`, the package can either upgrade iOS to v7 (separate
   risk) or document the method as Android-only (`Promise.reject('UNSUPPORTED')`
   on iOS).

3. **Pod source for `MotionTagSDK`.** Confirm whether `MotionTagSDK ~>
   6.5.0` resolves from CocoaPods trunk or whether a private spec repo is
   required. Currently the app embeds the framework binary directly under
   `ios/Frameworks/` (integration doc §2). If trunk is unavailable, the
   podspec needs `s.vendored_frameworks` pointing at a copy of the
   xcframework checked into the package.

4. **Maven repo credentials.** The Android dep is on
   `pkgs.dev.azure.com/motiontag/releases` (integration doc §4.7). The
   package's `build.gradle` will declare that repo, but credentialed
   resolution still happens via the host's `~/.gradle/gradle.properties`.
   Document the env-var setup the same as today.

5. **Bootstrap call ordering.** Any host that forgets to call
   `MotionTag.bootstrap(…)` in `AppDelegate` / `MainApplication` will see
   a silent failure (the SDK is never initialised, JS calls hit an
   uninitialised state). Mitigation: throw a recognisable error from
   `start()` if `bootstrap` was not called, and put a loud README warning.

6. **Notification ownership boundary on Android.** If Play Console policy
   ever requires the SDK provider to own the foreground notification copy
   (it doesn't today), revisit §5.2.

---

## 12. Out-of-scope follow-ups

Tracked here so they don't get lost when the refactor ships:

- Move iOS to MotionTag SDK v7 to align with Android; adopt v7's event
  hierarchy directly so the structured-event mapping is 1:1.
- Replace the 3-second polling reconciler in `useTrackingChecks` with
  reactive subscription to `MotionTag.addListener` — the polling exists
  today only because the bridge has no reliable "started/stopped" event.
- Publish the package to an internal npm registry once the API stabilises,
  so other Panter apps can consume it.
- Ship the Expo config plugin (§10) when a managed-workflow consumer
  appears, or pre-emptively at v1.0.
