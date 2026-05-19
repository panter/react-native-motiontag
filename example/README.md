# MotionTag Demo (Expo)

Small Expo app that exercises the `@panter/react-native-motiontag` library: paste a JWT,
grant permissions, start tracking, and watch events stream in.

This app is **not** Expo-Go-compatible — it depends on a native Turbo Module
(MotionTag SDKs) so you need a development client build.

## Requirements

- Node 18+ and Yarn 1.x (workspaces).
- Xcode + CocoaPods for iOS, Android Studio for Android.
- A **real device** for end-to-end testing. Simulators/emulators don't generate
  motion-sensor data and won't trigger most MotionTag events.
- A valid MotionTag JWT (ask your account contact).

## First run

From the repository root:

```sh
yarn install
cd demo
npx expo prebuild --clean    # generates ios/ and android/ using the plugin
npx expo run:ios --device    # or: npx expo run:android --device
```

The `@panter/react-native-motiontag` Expo config plugin (in
`../app.plugin.js`) wires the iOS AppDelegate
bootstrap, Android `MainApplication.onCreate` bootstrap, Info.plist keys,
foreground-service notification, and the Azure DevOps Maven repo for you.

## Using the demo

1. Tap **Request permissions** — grant **always** location (background) and
   motion. On Android 13+ also grant the notification permission.
2. Paste your MotionTag JWT into the text input and tap **Save token**.
3. Tap **Start tracking**. The status pill flips to "Tracking active" and the
   event log starts filling. On Android a foreground-service notification
   appears.
4. To stop, tap **Stop tracking**.

## Re-running prebuild

The plugin is idempotent — re-running `npx expo prebuild` won't duplicate
injected blocks. If you change `app.json` plugin options or upgrade the
library, re-run with `--clean` to start from a fresh `ios/`/`android/`.

## Troubleshooting

- **Tracking flips off shortly after starting on Android**: check the *Android
  health* section in the demo. Battery optimisations or power-save mode will
  silently stop the foreground service.
- **No events appear**: ensure the JWT is valid and that you granted both
  foreground *and* background location permission. On iOS, the OS only prompts
  for "Always" the first time you call `start()` — restart the app if you got
  stuck on "When in use".
- **Build fails with `de.motiontag:tracker` not found**: the plugin injected
  the Azure DevOps Maven repo into `android/build.gradle`. Verify with
  `grep azure android/build.gradle`. If missing, re-run prebuild with
  `--clean`.
