# AGENTS.md

Project conventions for AI coding agents working in this repo. Read this
before making changes — most of it is not derivable from the code alone.

## What this repo is

A React Native Turbo Module (`@panter/react-native-motiontag`) wrapping
the MotionTag tracking SDKs (iOS 7.0.x, Android 7.2.x). New architecture
only. JS surface mirrors the official Flutter SDK so payloads stay
interchangeable.

Repo layout: see [README.md → Repo layout](README.md#repo-layout).

## Commit conventions

This repo uses [Conventional Commits](https://www.conventionalcommits.org/),
enforced by release-please. **Every commit subject to `main` must follow the
format** or it won't appear in the changelog and may break automated
versioning.

| Prefix | Meaning | Version bump |
| --- | --- | --- |
| `feat:` | New user-facing feature | minor |
| `fix:` | Bug fix | patch |
| `feat!:` / `fix!:` / `BREAKING CHANGE:` body | Breaking change | major |
| `chore:` | Tooling, deps, internal cleanup | none |
| `docs:` | Documentation only | none |
| `refactor:` | Internal restructure, no behaviour change | none |
| `test:` | Test-only changes | none |
| `ci:` | CI / workflow changes | none |
| `build:` | Build system changes | none |

Optional scope in parentheses: `feat(plugin): add channelId option`,
`fix(android): handle null permission result`.

Do **not** add a trailing summary paragraph in commit bodies that repeats
the subject. Body explains *why*; subject already says *what*.

## Release flow

Releases are automated — agents must not run `npm publish` directly or
push tags manually. See [README → Releasing](README.md#releasing) for the
full flow. TL;DR: commit with Conventional Commits → release-please opens
a release PR → merging it tags + publishes via GitHub Actions OIDC.

## Working with the code

- **Library source**: `src/` — TypeScript, no transpilation in the example
  (uses the `react-native` field in `package.json` to consume `src/` directly).
- **Native modules**: `android/` (Kotlin) and `ios/` (Swift + ObjC++).
  Changing the TS spec (`src/NativeMotionTag.ts`) regenerates the codegen
  contract — both native sides must be updated to match.
- **Expo config plugin**: `plugin/` (plain JS, no build). Injected blocks
  are wrapped in `@generated` markers and de-duplicated on `expo prebuild`
  re-runs.
- **Example app**: `example/` is a Standalone Expo dev-client app. It
  declares the library via `"file:.."` so edits to `src/` hot-reload via
  Fast Refresh. Metro config in `example/metro.config.js` blocks duplicate
  `react` / `react-native` copies — do not change without understanding
  why.

## Build / verify

- TypeScript build: `yarn prepare` (runs `react-native-builder-bob`,
  outputs `lib/{commonjs,module,typescript}`).
- Typecheck only: `npx tsc -p tsconfig.build.json --noEmit`.
- Lint: none configured yet. Don't add one without asking.
- Tests: none yet. Don't add a test framework speculatively.
- The CI workflow (`.github/workflows/ci.yml`) runs `yarn prepare` on PRs;
  if your change touches `src/`, make sure it builds cleanly locally first.

## What to avoid

- Don't bump `version` in `package.json` by hand — release-please owns it.
- Don't edit `CHANGELOG.md` by hand — release-please owns it.
- Don't edit `.release-please-manifest.json` unless intentionally
  bootstrapping (extremely rare).
- Don't add a `prepublishOnly` or other publish-side hook that would race
  with `prepare` in the GitHub Actions workflow.
- Don't add Expo Go support — the library has native code and requires a
  development client build. Documentation that suggests otherwise is wrong.
- Don't align the iOS and Android SDK versions opportunistically. Version
  drift is intentional pending a separate evaluation (tracked as a
  follow-up). Touch only when explicitly asked.
- Don't introduce a monorepo tool (Lerna, Nx, Turborepo). The
  library + `example/` two-package layout is deliberate.

## Native dependency versions

Hard-coded; see [README → Native dependency versions](README.md#native-dependency-versions).
Bumping these is a feature change with cross-platform implications —
treat as a `feat:` (or `feat!:` if API-incompatible) and update both
platforms in the same PR.

## When in doubt

Ask. The MotionTag SDK has thin, sometimes surprising native contracts
(pre-RN init requirements, background task identifiers, foreground-service
ownership) that aren't obvious from the JS surface — better to confirm
than to guess.
