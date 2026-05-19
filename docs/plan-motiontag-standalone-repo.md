# Plan: extract `react-native-motiontag` into a standalone repo

What it would take to move `modules/react-native-motiontag/` out of this
repo, host it on GitHub under external maintainership, publish it to a
registry, and consume it back here as a regular npm dependency.

This is exploratory — the post-refactor architecture (after the merge of
`feat/react-native-motiontag-package`) is in
`motiontag-refactor-completed.md`; the in-repo bridge is in
`modules/react-native-motiontag/` until/unless this extraction happens.

---

## 1. What moves to the new repo

The package directory ships verbatim:

```
modules/react-native-motiontag/
├── package.json
├── react-native-motiontag.podspec
├── README.md
├── tsconfig.json
├── .gitignore
├── src/                           ← public TS API + codegen spec
├── ios/                           ← Swift delegate + ObjC++ Turbo Module
└── android/                       ← Kotlin Turbo Module + bootstrap
```

Nothing else moves. The host-side bootstrap calls (`AppDelegate.swift`,
`MainApplication.kt`) and the JS callers stay in the consumer.

## 2. Changes required *in* the new repo

### `package.json`

- Drop `"private": true`.
- Pick a real version and tag from there: `"version": "0.1.0"`.
- Pick a name. The unscoped `react-native-motiontag` may already be on
  npm — check first. Safer is a scoped name (e.g.
  `@panter/react-native-motiontag` or your personal scope), which also
  lets you publish private without ambiguity.
- Add `"repository"`, `"bugs"`, `"homepage"` pointing at the new GitHub
  repo. The current placeholders point at the cyclomania-app GitLab.
- Tighten `peerDependencies` from `"*"` to a real range
  (`"react-native": ">=0.85.0"` etc.) — Turbo Modules pin to the codegen
  ABI, so the range matters.

### License

Currently `"UNLICENSED"`. For:

- **Public npm** — set a real OSI license (MIT / Apache-2.0) and add a
  `LICENSE` file. `npm publish` for scoped packages defaults to private;
  use `--access public`.
- **Private** (GitHub Packages or a private registry) — `UNLICENSED`
  stays fine; consumer needs `.npmrc` auth.

### Build pipeline

The in-repo version is **source-only** (`"main": "./src/index.ts"`).
Metro resolves TS directly inside a Yarn workspace, but a published
package should ship transpiled JS so it works for any consumer toolchain.

Add `react-native-builder-bob` (the `create-react-native-library`
default that I dropped during extraction). Outputs three targets:

```jsonc
{
  "main": "./lib/commonjs/index.js",
  "module": "./lib/module/index.js",
  "types": "./lib/typescript/src/index.d.ts",
  "scripts": {
    "prepare": "bob build"
  }
}
```

The codegen spec at `src/NativeMotionTag.ts` continues to be discovered
by RN's codegen via `package.json:codegenConfig` — that doesn't change.

### Java / iOS package names — neutral, not host-specific

The in-repo version hard-codes cyclomania-flavoured names that are awkward
for an external consumer:

- `package.json:codegenConfig.android.javaPackageName` → `ch.cyclomania.motiontag`
- `android/build.gradle:namespace` → `ch.cyclomania.motiontag`
- `android/.../MotionTagModule.kt` etc. → `package ch.cyclomania.motiontag`
- `react-native-motiontag.podspec:module_name` → `RNMotionTag`

Rename these to neutral names — e.g. `tech.motiontag.rn` (or whichever
you control) for the Java package, keep `RNMotionTag` for the iOS module
name. After the rename, the consumer's Kotlin import path changes
(`import tech.motiontag.rn.MotionTagBootstrap`) and the iOS pod's
generated Swift module name changes accordingly.

### README

The current one cites cyclomania-specific paths:

- Notification channel id `ch.cyclomania.tracking`
- Bootstrap call site `MainApplication.onCreate` (cyclomania-styled)
- `import RNMotionTag` from the host's Swift

Generalise these into "the host configures": channel id is consumer's
choice; bootstrap entry point lives in the consumer's `Application`
subclass; etc. Keep one short "example wiring" snippet.

### CI

Minimal: `yarn install`, `yarn tsc`, `yarn lint`. Optional but useful:
restore an `example/` app (the create-react-native-library template
ships one) so CI can build for both platforms.

## 3. Publishing

### Public on npm

```sh
npm publish --access public
```

Requires the chosen license, scoped or unscoped name resolved. Consumer
installs with `npm i @scope/react-native-motiontag`.

### Private on GitHub Packages

```sh
# In repo
echo "//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}" > .npmrc
npm publish

# In consumer (cyclomania-app .npmrc)
@scope:registry=https://npm.pkg.github.com
```

Tag every release (`v0.1.0`, `v0.2.0`, …) so consumers can pin to tags.

## 4. Removing the module from cyclomania-app

A separate PR in this repo, after the new package is published:

- `package.json`:
  - Drop `"react-native-motiontag": "*"`.
  - Replace with `"react-native-motiontag": "^0.1.0"` (or scoped name).
  - Drop `"workspaces": ["modules/*"]` if no other modules exist.
- `git rm -r modules/react-native-motiontag/` and remove the empty
  `modules/` directory.
- Update import paths if the package name changes
  (`from '@scope/react-native-motiontag'`).
- Update Kotlin import in `MainApplication.kt` if the Java package name
  changes (`import tech.motiontag.rn.MotionTagBootstrap`).
- Re-run `yarn install`, `yarn pod-install`, and a fresh Gradle build —
  autolinking should pick up the npm-installed package the same way it
  picks up workspace packages today.

## 5. The MotionTag credential caveat

Extraction does not solve the SDK-access problem. Anyone consuming the
published package on Android still needs Azure DevOps Maven creds (or
forwarded ones from their CI vault) to resolve
`de.motiontag:tracker:7.2.5` from
`pkgs.dev.azure.com/motiontag/releases`. The repo declaration is in the
*consumer's* `android/build.gradle` (currently in
`allprojects { repositories { … } }`) so the new package needs to
either:

- Document loudly in the README that consumers must add the Maven repo
  + creds before installing, or
- Ship a Gradle `Settings.applyConvention` plugin that adds the repo to
  the consumer's `dependencyResolutionManagement` automatically (still
  needs creds though, just adds the repo URL).

If this package were ever made public-public, this is the gating
constraint — consumers without MotionTag SDK access can't build.

## 6. Effort estimate

| Step | Time |
| --- | --- |
| Carve out the new repo + initial commit | ~1 h |
| Rename Java package + iOS module name + verify both build | ~1 h |
| Add bob, configure publish, ship `0.1.0` to a registry | ~1 h |
| Generalise README, add CI workflow | ~1 h |
| In cyclomania-app: switch from path-dep to versioned dep, rebuild and smoke | ~1 h |

Roughly half a day, spread across two PRs (one in the new repo to make
it shippable; one in this repo to consume it).

## 7. Open question — ownership boundary

"External maintainer" implies a clean handoff. Worth deciding upfront:

- Where does the issue tracker live (new repo, this repo)?
- Who reviews PRs to the package?
- What's the version-bump cadence (semver, or just `^0.x` and bump
  liberally)?
- Will Panter contribute fixes back upstream as PRs, or fork-and-publish
  internally if upstream doesn't move?

These are policy questions, not code questions, but they shape whether
the extraction is "real handoff" vs. "I publish and Panter is the only
consumer".
