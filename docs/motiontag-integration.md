# MotionTag SDK Integration

> **Pre-refactor snapshot.** This document describes the in-app `TrackingSDK`
> bridge that existed before the refactor. The bridge has since been
> extracted into the workspace package `modules/react-native-motiontag/` —
> see [`plan-react-native-motiontag.md`](./plan-react-native-motiontag.md)
> for the post-refactor architecture and the package's `README.md` for the
> public API. This file is kept as historical context; it does **not**
> reflect the current code layout.

This document describes how the MotionTag tracking SDK is wired into the
cyclomania React Native app, end-to-end, with the level of detail needed to
plan a refactor. It captures every file involved, every event/method, every
asymmetry between iOS and Android, and the known smells.

> Heads up for a refactor: there is **no** stand-alone RN library for
> MotionTag. The folder `modules/react-native-motiontag/` is empty and unused.
> The bridge is hand-written inside the iOS and Android app targets and
> exposes a single native module called `TrackingSDK` to JS.

---

## 1. Birds-eye view

```
┌───────────────────────────────── JavaScript ──────────────────────────────────┐
│                                                                               │
│  src/modules/navigation/.../MainNavigation.tsx                                │
│       │ on mount                                                              │
│       ▼                                                                       │
│  store.tracking.initTrackingSdk  (src/modules/tracking/model.ts)              │
│       │                                                                       │
│       ▼                                                                       │
│  src/lib/TrackingSDK.ts                                                       │
│   - initTrackingSDK()                 ──► native initializeTracking           │
│   - registerLogger(cb)                ──► subscribes to 'TrackingLogger'      │
│   - startTracking({ jwt })            ──► native startTracking(jwt)           │
│   - stopTracking()                    ──► native stopTracking                 │
│   - setUserToken(jwt)                 ──► native setUserToken(jwt)            │
│   - isLocationTrackingEnabled()       ──► native isLocationTrackingEnabled    │
│                                                                               │
│  src/hooks/useTrackingChecks.ts  (3s polling reconciler)                      │
│  src/modules/tracking/components/TrackingDeactivatedDialog.tsx                │
│  src/modules/tracking/components/TrackingIssueDialog.tsx                      │
│                                                                               │
└──────────────────────────────────┬────────────────────────────────────────────┘
                                   │ NativeModules.TrackingSDK   /
                                   │ NativeEventEmitter('TrackingLogger')
                                   ▼
┌──────────────── iOS ─────────────┐         ┌──────────────── Android ───────────────┐
│  ios/AppDelegate.swift           │         │  MainApplication.kt                    │
│   motionTag.initialize(using:    │         │   motionTag.initialize(this,           │
│       motionTagManager,          │         │       notification, motionTagManager)  │
│       launchOption: launch…)     │         │                                        │
│                                  │         │  MainActivity.kt (no MT-specific code) │
│  ios/TrackingSDK.{h,m}           │         │                                        │
│   RCTEventEmitter — JS bridge    │         │  MotionTagModule.kt                    │
│                                  │         │   ReactContextBaseJavaModule           │
│  ios/MotionTagManager.swift      │         │   getName() = "TrackingSDK"            │
│   MotionTagDelegate singleton    │         │                                        │
│                                  │         │  MotionTagManager.kt                   │
│  ios/cyclomania-Bridging-Header  │         │   MotionTag.Callback singleton         │
│   exposes TrackingSDK.h to Swift │         │                                        │
│                                  │         │  MotionTagPackage.java                 │
│  Pod: MotionTagSDK ~> 7.0.0      │         │   ReactPackage registering the module  │
│                                  │         │  Dep: de.motiontag:tracker:7.2.5       │
└──────────────────────────────────┘         └────────────────────────────────────────┘
```

Both platforms expose a native module named **`TrackingSDK`** with the same JS
surface, but the underlying SDKs are different major versions and use
different APIs (delegate-based vs. event/callback-based). All asymmetries are
called out below — the JS side glosses over them, which is fine today but is
the main reason a refactor will need to be careful.

---

## 2. Native dependencies

| Platform | Dependency | Version | Source |
| --- | --- | --- | --- |
| iOS | `MotionTagSDK` | `~> 7.0.0` | CocoaPods (`ios/Podfile:35`) |
| Android | `de.motiontag:tracker` | `7.2.5` | Azure DevOps Maven repo (`android/build.gradle:27-29`) |

The iOS framework is also referenced as a binary in `ios/Frameworks/` and
embedded into the app target — see the pbxproj entries
`MotionTagSDK.xcframework` (id `69B6A6A6251A53B9004842BC`) and
`MotionTagSDK.framework` (id `69EFAEA9243E8C0E00F468BD`) at
`ios/cyclomania.xcodeproj/project.pbxproj:62,66,89,130,132,338,351`.

The Android Maven repo is declared inside the **buildscript → allprojects**
block (`android/build.gradle:24-31`). That is unusual — `allprojects` is
typically a top-level block, not nested inside `buildscript`. It works because
of how Gradle evaluates the file, but it's brittle and easy to break when
someone restructures the file.

> **Refactor note:** iOS is on the v6 SDK, Android on v7. If the refactor
> involves bumping either side, expect API drift on both delegates/callbacks
> and event types. They are not 1:1 today.

---

## 3. iOS bridge

### 3.1 Files

| File | Purpose |
| --- | --- |
| `ios/AppDelegate.swift` | Initialises `MotionTagCore` before RN starts and forwards background-URL-session events |
| `ios/TrackingSDK.h` | Declares the ObjC bridge module class (subclass of `RCTEventEmitter`) |
| `ios/TrackingSDK.m` | Implements the bridge methods and event emitter |
| `ios/MotionTagManager.swift` | Swift singleton that owns `MotionTagCore.sharedInstance` and conforms to `MotionTagDelegate` |
| `ios/cyclomania-Bridging-Header.h` | Imports `TrackingSDK.h` so Swift can see the ObjC class (and thus the auto-generated `cyclomania-Swift.h` can pick up `MotionTagManager`) |

### 3.2 App startup — `ios/AppDelegate.swift`

```swift
let motionTag: MotionTag = MotionTagCore.sharedInstance         // line 17
let motionTagManager = MotionTagManager.sharedInstance          // line 18

func application(_ application: UIApplication,
                 didFinishLaunchingWithOptions launchOptions: …) -> Bool {
  // MUST run before React Native starts up.
  motionTag.initialize(using: motionTagManager,                 // line 25
                       launchOption: launchOptions)
  …
  factory.startReactNative(withModuleName: "cyclomania", …)     // line 36
}

func application(_ application: UIApplication,
                 handleEventsForBackgroundURLSession identifier: String,
                 completionHandler: @escaping () -> Void) {
  // Required so the SDK can finish background uploads on cold-launch wake-ups.
  motionTag.processBackgroundSessionEvents(                     // line 57
      with: identifier, completionHandler: completionHandler)
}
```

Key points:
- The SDK's delegate is the singleton `MotionTagManager.sharedInstance`. The
  RN bridge module (`TrackingSDK.m`) does **not** play the delegate role.
- `processBackgroundSessionEvents` is the only place this app handles
  background URLSession identifiers, so any future background networking
  added to the app must not collide with the MotionTag identifier.

### 3.3 Bridge module — `ios/TrackingSDK.{h,m}`

Header (`TrackingSDK.h`):

```objc
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#import <MotionTagSDK/MotionTagSDK.h>

@interface TrackingSDK : RCTEventEmitter <RCTBridgeModule>
+ (TrackingSDK *) sharedInstance;
@end
```

Implementation (`TrackingSDK.m`) is a standard RN ObjC bridge module:

| ObjC | JS | Notes |
| --- | --- | --- |
| `RCT_EXPORT_MODULE();` | `NativeModules.TrackingSDK` | Registers under the default name `TrackingSDK` |
| `supportedEvents` returns `@[@"TrackingLogger"]` | `NativeEventEmitter` event name | The single event channel |
| `startObserving` / `stopObserving` set a `bool hasListeners` | — | Used to gate `sendEventWithName` |
| `RCT_EXPORT_METHOD(initializeTracking)` | `initializeTracking()` | Installs the logging callback on `MotionTagManager.sharedInstance` |
| `RCT_EXPORT_METHOD(startTracking:(NSString*)jwt)` | `startTracking(jwt)` | **Fire-and-forget**, no promise |
| `RCT_EXPORT_METHOD(isLocationTrackingEnabled:rejecter:)` | `isLocationTrackingEnabled()` | Promise-based, resolves `{ isEnabled: BOOL }` |
| `RCT_EXPORT_METHOD(stopTracking)` | `stopTracking()` | Fire-and-forget |
| `RCT_EXPORT_METHOD(setUserToken:(NSString*)jwt)` | `setUserToken(jwt)` | Fire-and-forget |

Implementation details to be aware of:

1. **Singleton is unused at runtime.** `+ (TrackingSDK *)sharedInstance` exists
   in the header and `.m` (`TrackingSDK.m:30-38`), but RN instantiates its own
   instance of the module — that's the one that receives JS calls. The
   singleton method is dead code today.

2. **`initializeTracking` registers a block on the *manager*, not the bridge.**
   `TrackingSDK.m:46-55`:

   ```objc
   RCT_EXPORT_METHOD(initializeTracking) {
     [[MotionTagManager sharedInstance] setLoggingCallback:^(NSString *message) {
         RCTLogInfo(@"%@", message);
         if (self->hasListeners) {
             [self sendEventWithName:@"TrackingLogger" body:@{@"msg": message}];
         }
     }];
   }
   ```

   The block captures `self` strongly. Because `MotionTagManager` is a
   singleton that lives forever, the bridge module is also retained forever
   via the closure. That's not a leak you'll see in Instruments (the singleton
   never deallocates), but it does mean re-loads of the JS bundle replace the
   bridge instance and the *new* one cannot install a new callback without
   going through `initializeTracking` again. JS does call
   `initializeTracking` on every mount of `MainNavigation`, so this works,
   but the previous closure (and its `self`) sticks around.

3. **`hasListeners` gating only on iOS.** Android emits the log event
   unconditionally; iOS drops it when nothing is listening. JS calls
   `registerLogger` early so this is mostly a nuance, but worth knowing for
   tests / mock harnesses.

4. **`startTracking` hops to the main thread synchronously**
   (`TrackingSDK.m:62-65`):

   ```objc
   dispatch_sync(dispatch_get_main_queue(), ^{
     [[MotionTagManager sharedInstance] setUserToken: jwt];
     [[MotionTagManager sharedInstance] startTracking];
   });
   ```

   `dispatch_sync` is a deadlock waiting to happen if RN ever marshals this
   call from the main thread — today RN methods run on its own bridge queue,
   so it's safe, but this is brittle and the Android side uses an async
   `Handler.post` instead.

### 3.4 Manager — `ios/MotionTagManager.swift`

A Swift singleton (`MotionTagManager.sharedInstance`) that:

- Owns `MotionTagCore.sharedInstance` and proxies the high-level API:
  `setUserToken`, `startTracking`, `stopTracking`, `isTrackingActive`.
- Exposes a `loggingCallback: ((String) -> Void)?` set by the bridge in
  `initializeTracking`.
- Conforms to `MotionTagDelegate` and converts each delegate callback into a
  log line:

  | Delegate method | Log format |
  | --- | --- |
  | `trackingStatusChanged(_:)` | `SDK TrackingStatusChanged: <bool>` |
  | `locationAuthorizationStatusDidChange(_:precise:)` | `SDK CLAuthorizationStatus: <raw> precise: <bool>` |
  | `motionActivityAuthorized(_:)` | `SDK MotionActivityAuthorized: <bool>` |
  | `didTrackLocation(_:)` | `SDK Location: <CLLocation>` |
  | `dataUploadWithTracked(from:to:didCompleteWithError:)` | `SDK Transmission Success/Error - startDate: …, endDate: … <error>` |

- **401 handling** (`MotionTagManager.swift:64-67`): when
  `dataUploadWithTracked` reports an `NSError` with `code == 401`, the manager
  logs `"SDK Error - Deactivate Tracking due to Unauthorized token"` and calls
  `stopTracking()`. JS picks this up via the next
  `isLocationTrackingEnabled` poll in `useTrackingChecks` (see §6.2).

- The class is annotated `@objc` with `@objc public static let sharedInstance`
  so it's visible to the ObjC bridge through the auto-generated
  `cyclomania-Swift.h` (imported by `TrackingSDK.m:11`).

### 3.5 Bridging header — `ios/cyclomania-Bridging-Header.h`

```objc
#import <Foundation/Foundation.h>
#import <React/RCTBundleURLProvider.h>
#import <React/RCTRootView.h>
#import "TrackingSDK.h"
```

The only MotionTag-relevant line here is `#import "TrackingSDK.h"`. That
exposes the ObjC class to Swift. The Swift side is exposed back to ObjC
through `cyclomania-Swift.h`, which is imported by `TrackingSDK.m:11`.

### 3.6 Permissions / Info.plist keys (iOS)

Configured in `ios/Podfile:39-60` via `react-native-permissions`'s
`setup_permissions`:

- `LocationAccuracy`
- `LocationAlways`
- `LocationWhenInUse`
- `Motion`

Corresponding Info.plist keys present in `ios/cyclomania/Info.plist` (lines
67–80): `NSLocationAlwaysAndWhenInUseUsageDescription`,
`NSLocationAlwaysUsageDescription`,
`NSLocationTemporaryUsageDescriptionDictionary`, `NSLocationUsageDescription`,
`NSLocationWhenInUseUsageDescription`, `NSMotionUsageDescription`.

### 3.7 Background modes

Background uploads rely on `application(_:handleEventsForBackgroundURLSession:completionHandler:)`
forwarding to `motionTag.processBackgroundSessionEvents` (§3.2). The Xcode
project must therefore have **Background Modes → Location updates**,
**Background fetch** and **Background processing** enabled (verify in
`cyclomania.xcodeproj` under Capabilities).

The relevant `Info.plist` keys are version-controlled in
`ios/cyclomania/Info.plist`:

```xml
<key>UIBackgroundModes</key>
<array>
    <string>location</string>
    <string>fetch</string>
    <string>processing</string>
</array>
<key>BGTaskSchedulerPermittedIdentifiers</key>
<array>
    <string>com.motiontag.sdk.backgroundrefresh</string>
    <string>com.motiontag.sdk.backgroundtask</string>
</array>
```

Starting from MotionTag iOS SDK 6.5.0, `BGTaskSchedulerPermittedIdentifiers`
is **required** — the SDK registers `com.motiontag.sdk.backgroundrefresh`
(`BGAppRefreshTask`) and `com.motiontag.sdk.backgroundtask`
(`BGProcessingTask`) at launch, and registration throws if the identifiers
are not whitelisted in the plist. The two new `UIBackgroundModes` entries
(`fetch`, `processing`) are also required for `BGTaskScheduler` to function.

`FirebaseAppDelegateProxyEnabled` is set to `false` in the same file so
Firebase's swizzling does not interfere with the SDK's background URLSession
forwarding.

---

## 4. Android bridge

### 4.1 Files

| File | Purpose |
| --- | --- |
| `android/app/src/main/java/ch/cyclomania/MainApplication.kt` | Initialises `MotionTag` with the foreground notification + manager callback before RN runs |
| `android/app/src/main/java/ch/cyclomania/MainActivity.kt` | Currently has no MotionTag-specific code |
| `android/app/src/main/java/ch/cyclomania/MotionTagModule.kt` | RN `ReactContextBaseJavaModule` exposing the `TrackingSDK` JS API |
| `android/app/src/main/java/ch/cyclomania/MotionTagManager.kt` | Singleton implementing `MotionTag.Callback` (event handler) |
| `android/app/src/main/java/ch/cyclomania/MotionTagPackage.java` | `ReactPackage` registering `MotionTagModule` |
| `android/app/src/main/AndroidManifest.xml` | Declares the SDK-required permissions |
| `android/app/src/main/res/values/strings.xml` (+ locale variants) | Notification channel/content strings |

### 4.2 App startup — `MainApplication.kt`

```kotlin
private val motionTag: MotionTag by lazy { MotionTag.getInstance() }

override fun onCreate() {
    super.onCreate()
    loadReactNative(this)
    val notification = createNotification()
    val motionTagManager = MotionTagManager.getInstance()
    motionTag.initialize(this, notification, motionTagManager)   // line 55
}
```

The notification is built in `createNotification()` / `createNotificationChannel()`
(`MainApplication.kt:62-84`) and is **mandatory** — the v7 Android SDK runs as
a foreground service and the framework requires a `Notification` for that
service.

Notification resource dependencies (must be kept in sync if anything is
renamed):

| Resource | Where |
| --- | --- |
| Channel ID `ch.cyclomania.tracking` | `MainApplication.kt:22` (also duplicated in `MotionTagManager.kt:16`, currently unused there) |
| Small icon `R.drawable.ic_notification` | `android/app/src/main/res/drawable*` |
| Title `R.string.notification_channel_name` | `res/values/strings.xml:8` (`Cyclomania`), translated in `values-de`, `values-fr`, `values-it` |
| Text `R.string.notification_tracking_active` | `res/values/strings.xml:3` (`Movement tracking is active`), translated in locale variants |

> **Refactor smell:** `CHANNEL_ID` is declared in **both** `MainApplication.kt`
> and `MotionTagManager.kt`. The one in `MotionTagManager.kt` is a left-over —
> the manager doesn't build notifications anywhere. It also imports
> `Notification`, `NotificationChannel`, `NotificationManager`,
> `NotificationCompat`, `Build`, `Context`, all unused. Same with
> `MotionTagModule.kt`, which has the same unused imports plus an unused
> `LOG_TAG`.

### 4.3 Bridge module — `MotionTagModule.kt`

```kotlin
class MotionTagModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    private val motionTagManager by lazy { MotionTagManager.getInstance() }

    override fun getName(): String = "TrackingSDK"   // matches iOS module name

    @ReactMethod fun initializeTracking()                                { … }
    @ReactMethod fun startTracking(jwt: String, promise: Promise)        { … }
    @ReactMethod fun isLocationTrackingEnabled(promise: Promise)         { … }
    @ReactMethod fun stopTracking()                                      { … }
    @ReactMethod fun setUserToken(jwt: String)                           { … }
}
```

Method-by-method details:

- **`initializeTracking`**: registers a `LoggerCallback` on the manager that
  re-emits each log message on the `RCTDeviceEventEmitter` event
  `TrackingLogger` with body `{ msg: <string> }`. Uses the captured
  `reactContext` (see smell below).
- **`startTracking(jwt)`**: returns a `Promise` (resolves with `null`).
  Delegates to `motionTagManager.startTracking(jwt)` which posts to the main
  looper. **Asymmetry vs iOS**: iOS is fire-and-forget; Android is
  Promise-returning. JS treats both the same (see §5).
- **`isLocationTrackingEnabled(promise)`**: resolves with
  `{ isEnabled: <bool> }`. Same shape as iOS.
- **`stopTracking`**, **`setUserToken(jwt)`**: fire-and-forget.

Smells worth flagging for the refactor:

```kotlin
companion object {
    private var reactContext: ReactApplicationContext? = null
}
init {
    reactContext = context
}
```

Storing `reactContext` in a static (companion) `var` is wrong: it's
mutable, shared across all module instances, and never cleared on bridge
re-creation (e.g. dev-server reloads). The instance has a perfectly good
`getReactApplicationContext()` from the parent class. This should just use
that.

### 4.4 Manager — `MotionTagManager.kt`

A double-checked-locking singleton implementing `MotionTag.Callback`. API:

```kotlin
fun setLoggerCallback(callback: LoggerCallback)
fun setUserToken(jwt: String)
fun startTracking(jwt: String)   // posts to main looper, sets token, then start()
fun stopTracking()
fun isTrackingActive(): Boolean
override fun onEvent(event: Event)
```

`onEvent` (`MotionTagManager.kt:64-83`) pattern-matches the v7 SDK event
hierarchy into log strings:

| Event class | Log prefix |
| --- | --- |
| `AutoStartEvent` | `SDK AutoStart: …` |
| `AutoStopEvent` | `SDK AutoStop: …` |
| `LocationEvent` | `SDK Location: …` |
| `TransmissionEvent.Success` | `SDK Transmission Success: …` |
| `TransmissionEvent.Error` | `SDK Transmission Error: …` |
| `BatteryOptimizationsChangedEvent` | `SDK Battery Optimizations Changed: …` |
| `PowerSaveModeChangedEvent` | `SDK Power Save Mode Changed: …` |
| else | `Other issue …` |

Events are also written to logcat with tag `MotionTag-Tracking`.

**401 handling** (`MotionTagManager.kt:77-82`): when a `TransmissionEvent.Error`
arrives with `errorCode == 401`, the manager logs the same
`"SDK Error - Deactivate Tracking due to Unauthorized token"` line as iOS and
calls `stopTracking()`. The reaction on the JS side is identical (see §6.2).

Other smells:

- `LoggerCallback` is a `fun interface` defined in this file; it's effectively
  `(String) -> Unit`. Worth replacing with a plain Kotlin lambda type.
- `companion object.initialize()` exists and just calls `getInstance()`. It is
  not called anywhere — `MainApplication.onCreate` calls
  `MotionTagManager.getInstance()` directly.

### 4.5 Package registration — `MotionTagPackage.java`

Standard `ReactPackage` returning a single `MotionTagModule`. Registered
manually in `MainApplication.kt:34` (`add(MotionTagPackage())`). It is **not**
autolinked — autolinking would require packaging it as an npm dep.

### 4.6 Permissions — `AndroidManifest.xml`

Relevant uses-permission entries (lines 2-10):

```
INTERNET
ACCESS_BACKGROUND_LOCATION
ACCESS_FINE_LOCATION
ACTIVITY_RECOGNITION
ACCESS_COARSE_LOCATION
FOREGROUND_SERVICE_LOCATION
```

`READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE` and `READ_CONTACTS` are also
declared but are not MotionTag-related.

The runtime permission set used by JS (`src/modules/tracking/model.ts:27-32`)
is `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`,
`ACTIVITY_RECOGNITION`, `ACCESS_COARSE_LOCATION`. Notably it does **not**
request `FOREGROUND_SERVICE_LOCATION` at runtime — it's a manifest-level
declaration only, which is correct for that permission.

### 4.7 Build configuration

- `android/build.gradle:24-31`: adds the MotionTag Maven repo
  (`https://pkgs.dev.azure.com/motiontag/releases/_packaging/releases/maven/v1`).
- `android/app/build.gradle:148`: `implementation 'de.motiontag:tracker:7.2.5'`.
- `compileSdk` 36, `minSdk` 24 (`android/build.gradle:5-7`).

---

## 5. JavaScript surface — `src/lib/TrackingSDK.ts`

```ts
const TrackingSDK = NativeModules.TrackingSDK
const trackingSDKEventEmitter = new NativeEventEmitter(TrackingSDK)

initTrackingSDK()                        // sync, fire-and-forget
registerLogger((msg) => …)               // sync; replaces any existing listener
startTracking({ jwt })                   // async, but iOS resolves immediately and Android resolves null
stopTracking()                           // sync
isLocationTrackingEnabled(): Promise<boolean>   // unwraps {isEnabled} to plain boolean
setUserToken(jwt): Promise<unknown>      // declared async; native methods are not promise-returning on either side
```

Things to keep in mind:

- **`registerLogger` calls `removeAllListeners('TrackingLogger')` first.**
  That's an explicit "single subscriber" contract. If a refactor wants
  multiple JS listeners (e.g. the debug screen + an analytics sink) this
  needs to change.
- **`registerLogger` lets you swap callbacks**, but the *native* logging
  callback installed by `initializeTracking` keeps pointing at the same
  `MotionTagManager.loggingCallback` slot — so the bridge keeps emitting
  `TrackingLogger` events regardless, and the JS listener decides what to do
  with them.
- **`setUserToken` is `async` in the JS wrapper but the native methods are
  not promise-returning** on either platform (they're `RCT_EXPORT_METHOD`
  with no resolve/reject on iOS and `@ReactMethod fun setUserToken(jwt:
  String)` with no `Promise` on Android). The wrapper's `async` makes it
  return `Promise<undefined>` which is fine but a bit misleading.
- **`startTracking` is also declared `async`** but nothing on the native
  side is awaited — iOS doesn't even pass a promise through, Android resolves
  to `null`. The `await` in `useTrackingChecks` (`startTracking({ jwt })`,
  `useTrackingChecks.ts:72`) basically always microtasks and continues.

---

## 6. JS-side wiring

### 6.1 Easy-peasy slice — `src/modules/tracking/model.ts`

Stored fields relevant to MotionTag:

| Field | Meaning |
| --- | --- |
| `isTracking` | User-intent: should we be tracking? Persisted via `easy-peasy/persist`. |
| `isSdkTracking` | Mirror of the SDK's actual state, refreshed every 3 s by `useTrackingChecks`. |
| `trackingError` | Last error from a start attempt. |
| `trackingStartRetryCount` | Counts consecutive failures of `startTracking`. |
| `showTrackingIssueDialog` | Becomes true after `MAX_START_TRACKING_RETRIES` (3) consecutive failures. |
| `showTrackingDeactivatedDialog` | True when the JWT is expired; surfaces a re-login prompt. |
| `permissionStatuses` | OS permission map from `react-native-permissions`. |

Thunks involving the SDK:

```ts
initTrackingSdk: thunk(() => {
  TrackingSDK.initTrackingSDK()
  TrackingSDK.registerLogger(message => storeActions.debug.log(message))
})

startTracking: thunk(actions => {
  actions.setIsTracking(true)
  storeActions.tracking.checkPermissions()
  // NOTE: the actual TrackingSDK.startTracking call lives in useTrackingChecks
})

stopTracking: thunk(actions => {
  actions.setIsTracking(false)
  actions.resetTrackingError()
  actions.setIsSdkTracking(false)
  TrackingSDK.stopTracking()
})
```

Persistence: only `isTracking` is persisted (`model.ts:142-145`). On app
relaunch, the stored intent drives `useTrackingChecks` to bring the SDK back
up.

### 6.2 The 3-second reconciler — `src/hooks/useTrackingChecks.ts`

Mounted once in `MainNavigation` (`MainNavigation.tsx:72`). It runs every
**3 seconds** (`useTrackingChecks.ts:9`) and reconciles three pieces of
state:

1. JS intent (`isTracking`)
2. SDK reality (`await TrackingSDK.isLocationTrackingEnabled()`)
3. Token validity (`isTokenValid(motiontagToken)`)

Decision table:

| Intent | SDK | Token valid? | Action |
| --- | --- | --- | --- |
| ✅ | ❌ | ✅ | `startTracking({ jwt })`, then verify; if still off → throw `tracking_start_failed` (counts toward retry → eventually shows `TrackingIssueDialog`) |
| ❌ | ✅ | — | `stopTracking()` |
| ✅ | — | ❌ | `setShowTrackingDeactivatedDialog(true)` |

Other behaviours:

- Permissions are re-checked on app focus (`AppState` change to `active`) and
  on first mount (`useTrackingChecks.ts:33-48`).
- The `motiontagToken` from `useMe()` is pushed into the SDK via
  `TrackingSDK.setUserToken` whenever it changes
  (`useTrackingChecks.ts:52-56`). This is what handles JWT refresh while
  tracking is already running.

### 6.3 App startup ordering

```
Native init (AppDelegate / MainApplication.onCreate)
   └─ MotionTag SDK initialise + delegate/callback wired
        └─ React Native bridge starts
             └─ JS App.tsx mounts (Provider, ApolloProvider, …)
                  └─ MainNavigation mounts
                       ├─ useEffect → initTrackingSdk thunk
                       │     ├─ TrackingSDK.initializeTracking      (installs native logger callback)
                       │     └─ TrackingSDK.registerLogger(…)       (subscribes JS listener)
                       └─ useTrackingChecks() hook starts the 3s loop
```

The crucial ordering invariant: **SDK initialisation must complete before
React Native starts**, because RN's first JS frames will already be
calling into `TrackingSDK.*`. iOS guarantees this by calling
`motionTag.initialize(…)` *before* `factory.startReactNative(…)`
(`AppDelegate.swift:25` and `:36`). Android guarantees it by doing
`MotionTag.initialize` inside `Application.onCreate`, which always runs
before the first `Activity` (`MainApplication.kt:55`).

### 6.4 Dialogs / UI

- **`TrackingIssueDialog`** (mounted in `App.tsx:40`): shown when
  `trackingStartRetryCount >= 3`. Triggered from `useTrackingChecks` catching
  the synthetic `tracking_start_failed` error.
- **`TrackingDeactivatedDialog`** (mounted in `App.tsx:41`): shown when the
  `motiontagToken` is expired. Note the JS dialog is **not** triggered by the
  native 401 deactivation directly — the native side stops tracking on a 401,
  but the dialog only opens when JS notices the JWT is expired
  (`isTokenValid` returns false). If the server returns a 401 for some other
  reason while the JWT is still locally valid, JS would just keep retrying
  `startTracking` until `MAX_START_TRACKING_RETRIES` and then show the
  generic `TrackingIssueDialog`.

### 6.5 Other JS consumers

- `src/modules/debug/components/DebugInfo.tsx:9` — imports
  `isLocationTrackingEnabled` for the debug screen.
- `src/modules/icons/components/MotionTagLogo.tsx`,
  `src/modules/icons/components/AseLogo.tsx` — branding only.
- `src/modules/settings/components/PartnersSection.tsx:8,67` — branding only.

---

## 7. Cross-platform asymmetries (relevant for the refactor)

| Concern | iOS | Android |
| --- | --- | --- |
| SDK major version | 7 (`MotionTagSDK ~> 7.0.0`) | 7 (`de.motiontag:tracker:7.2.5`) |
| Integration style | `MotionTagDelegate` (callback methods on a delegate object) | `MotionTag.Callback` with sealed `Event` hierarchy in `onEvent(event)` |
| Module init point | `AppDelegate.didFinishLaunchingWithOptions` | `MainApplication.onCreate` |
| Foreground service | not applicable | required `Notification` passed to `MotionTag.initialize` |
| Background uploads | `application(_:handleEventsForBackgroundURLSession:completionHandler:)` forwards to `processBackgroundSessionEvents` | handled by the SDK's foreground service |
| Threading of `startTracking` | `dispatch_sync` to main queue (synchronous) | `Handler(Looper.getMainLooper()).post { … }` (asynchronous) |
| `startTracking` JS contract | Fire-and-forget (no promise) | `Promise<null>` |
| Log-event gating | `hasListeners` boolean — drops events when no JS listener is subscribed | None — emits unconditionally |
| Logged event names | Per-delegate-method (`SDK TrackingStatusChanged`, `SDK Location`, `SDK Transmission Success/Error`, `SDK CLAuthorizationStatus`, `SDK MotionActivityAuthorized`) | Per-Event subclass (`SDK AutoStart/Stop`, `SDK Location`, `SDK Transmission Success/Error`, `SDK Battery Optimizations Changed`, `SDK Power Save Mode Changed`) |
| 401 reaction | Manager calls `stopTracking()` directly inside `dataUploadWithTracked` | Manager calls `stopTracking()` inside `onEvent` for `TransmissionEvent.Error` with `errorCode == 401` |
| Singleton on bridge module | `+ sharedInstance` declared but unused | Static `companion var reactContext` (unsafe pattern) |
| Manager singleton style | Swift `static let sharedInstance` | Kotlin double-checked locking |

These differences are not bugs — they reflect the underlying SDKs — but they
mean that refactoring "just one side" to a new pattern (e.g. TurboModules,
TypeScript codegen, replacing the manager with a thin wrapper) usually means
refactoring both sides and rewriting the event-name conversion table.

---

## 8. Known smells / cleanup candidates

These are not blockers, but worth addressing as part of any refactor. None
are functional bugs today.

1. **Empty placeholder package** `modules/react-native-motiontag/` — delete
   or actually move the bridge into it as a real package.
2. **iOS `+ (TrackingSDK *)sharedInstance`** — declared but never called.
   Either use it (e.g. for direct ObjC access from another module) or
   remove it.
3. **iOS `initializeTracking` retain cycle** — the logging-callback block
   captures the bridge instance strongly through a singleton-owned
   reference. Use `__weak typeof(self) weakSelf = self;` inside the block.
4. **iOS `dispatch_sync(main)` in `startTracking:`** — replace with
   `dispatch_async` to avoid potential deadlocks if RN ever changes
   threading.
5. **Android `MotionTagModule.companion object reactContext` static var** —
   replace with `getReactApplicationContext()` from the parent class.
6. **Duplicated `CHANNEL_ID` constant** — declared in both
   `MainApplication.kt` and `MotionTagManager.kt`; only the former is used.
7. **Unused `MotionTagManager.initialize()` companion function** — delete.
8. **Unused imports** in `MotionTagModule.kt` and `MotionTagManager.kt`
   (`Notification`, `NotificationChannel`, `NotificationManager`,
   `NotificationCompat`, `Build`, `Application`, `LOG_TAG`, etc.).
9. **`startTracking` / `setUserToken` JS wrappers declared `async`** but
   underlying native methods are sync. Either make the native side actually
   resolve a promise (so callers can rely on `await`) or drop the `async`.
10. **Single-listener contract in `registerLogger`** is implicit. Make it
    explicit (e.g. return an `unsubscribe` function and don't blow away
    other listeners) if multiple subscribers are needed.
11. **iOS uses `dispatch_sync` and Android uses async `Handler.post`** for
    the same operation — pick one mental model.
12. **Logging is string-based on both sides.** Events are formatted into
    free-text strings (`"SDK Transmission Success: …"`). For a refactor,
    consider passing structured data over the bridge (`{ kind: 'transmission',
    success: true, startDate, endDate }`) and let JS decide how to render it.
    Today, anything wanting to react to a specific event has to substring-match.
13. **401 deactivation is duplicated in the native code and underspecified
    in JS.** Native side stops tracking; JS side has a separate
    `showTrackingDeactivatedDialog` triggered only by JWT expiry, not by the
    native 401. Consider unifying: either bubble the 401 to JS as a
    structured event or move the deactivation decision into JS entirely.

---

## 9. File checklist for the refactor

Touch these and you're touching MotionTag:

```
src/lib/TrackingSDK.ts
src/modules/tracking/model.ts
src/modules/tracking/components/TrackingDeactivatedDialog.tsx
src/modules/tracking/components/TrackingIssueDialog.tsx
src/modules/tracking/utils/isTokenValid.ts
src/hooks/useTrackingChecks.ts
src/modules/debug/components/DebugInfo.tsx               (uses isLocationTrackingEnabled)

ios/AppDelegate.swift
ios/TrackingSDK.h
ios/TrackingSDK.m
ios/MotionTagManager.swift
ios/cyclomania-Bridging-Header.h
ios/Podfile                                              (MotionTagSDK pod, permissions)
ios/cyclomania.xcodeproj/project.pbxproj                 (xcframework references)
ios/Frameworks/MotionTagSDK.xcframework
ios/Frameworks/MotionTagSDK.framework
ios/cyclomania/Info.plist                                (NSLocation*, NSMotionUsageDescription)

android/build.gradle                                     (MotionTag maven repo)
android/app/build.gradle                                 (de.motiontag:tracker dep)
android/app/src/main/AndroidManifest.xml                 (permissions)
android/app/src/main/java/ch/cyclomania/MainApplication.kt
android/app/src/main/java/ch/cyclomania/MainActivity.kt  (no current MT code, but theme/launch)
android/app/src/main/java/ch/cyclomania/MotionTagModule.kt
android/app/src/main/java/ch/cyclomania/MotionTagManager.kt
android/app/src/main/java/ch/cyclomania/MotionTagPackage.java
android/app/src/main/res/drawable*/ic_notification.png
android/app/src/main/res/values/strings.xml              (notification_channel_name, notification_tracking_active)
android/app/src/main/res/values-de/strings.xml
android/app/src/main/res/values-fr/strings.xml
android/app/src/main/res/values-it/strings.xml

modules/react-native-motiontag/                          (currently empty placeholder)
```
