const { withFinalizedMod, AndroidConfig, XML } = require('@expo/config-plugins')
const fs = require('fs')
const path = require('path')

// The Android SDK stores its state (device registration, tracking state) in a
// SharedPreferences file named `motiontag_tracker` (verified against the
// de.motiontag:tracker AAR). The MotionTag guide requires excluding it from
// Android Auto Backup: a backup restored on reinstall / new device would
// resurrect stale SDK state.
const SDK_SHAREDPREF_FILE = 'motiontag_tracker.xml'

const OWN_BACKUP_RULES_NAME = 'motiontag_backup_rules'
const OWN_EXTRACTION_RULES_NAME = 'motiontag_data_extraction_rules'

const WARN_PREFIX = '[react-native-motiontag]'

function excludeEntry() {
  return { $: { domain: 'sharedpref', path: SDK_SHAREDPREF_FILE } }
}

function hasExclude(node) {
  return (node.exclude || []).some(
    (e) =>
      e &&
      e.$ &&
      e.$.domain === 'sharedpref' &&
      e.$.path === SDK_SHAREDPREF_FILE,
  )
}

function addExclude(node) {
  if (hasExclude(node)) {
    return false
  }
  node.exclude = [...(node.exclude || []), excludeEntry()]
  return true
}

/**
 * Add the MotionTag exclude to a parsed backup-rules document. Returns true
 * when the document was changed. Handles both rule formats:
 * - `<full-backup-content>` (Android <= 11, android:fullBackupContent)
 * - `<data-extraction-rules>` (Android 12+, android:dataExtractionRules) —
 *   the exclude goes into both `<cloud-backup>` and `<device-transfer>`.
 */
function mergeExcludeIntoRules(doc) {
  if (doc['full-backup-content']) {
    return addExclude(doc['full-backup-content'])
  }
  if (doc['data-extraction-rules']) {
    const root = doc['data-extraction-rules']
    let changed = false
    for (const section of ['cloud-backup', 'device-transfer']) {
      if (!root[section]) {
        root[section] = [{}]
      }
      for (const node of root[section]) {
        changed = addExclude(node) || changed
      }
    }
    return changed
  }
  return false
}

/**
 * Resolve a `@xml/<name>` manifest reference to an XML file on disk.
 * App resources win over library resources (mirrors Android resource merging),
 * so look in the app first, then in node_modules (walking up for hoisted
 * monorepo layouts).
 */
function findRulesXml(name, { appResXmlDir, projectRoot }) {
  const appFile = path.join(appResXmlDir, `${name}.xml`)
  if (fs.existsSync(appFile)) {
    return appFile
  }

  let dir = projectRoot
  for (let depth = 0; depth < 5; depth++) {
    const nodeModules = path.join(dir, 'node_modules')
    if (fs.existsSync(nodeModules)) {
      const match = findInNodeModules(nodeModules, `${name}.xml`)
      if (match) {
        return match
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  return null
}

function findInNodeModules(nodeModules, fileName) {
  for (const entry of fs.readdirSync(nodeModules)) {
    if (entry.startsWith('.')) {
      continue
    }
    const pkgDirs = entry.startsWith('@')
      ? fs
          .readdirSync(path.join(nodeModules, entry))
          .map((scoped) => path.join(nodeModules, entry, scoped))
      : [path.join(nodeModules, entry)]
    for (const pkgDir of pkgDirs) {
      const candidate = path.join(
        pkgDir,
        'android',
        'src',
        'main',
        'res',
        'xml',
        fileName,
      )
      if (fs.existsSync(candidate)) {
        return candidate
      }
    }
  }
  return null
}

function emptyRulesDoc(manifestAttr) {
  // Exclude-only rules: Android backs up everything except the listed paths,
  // which preserves the host's default backup behaviour.
  if (manifestAttr === 'android:fullBackupContent') {
    return { 'full-backup-content': {} }
  }
  return {
    'data-extraction-rules': {
      'cloud-backup': [{}],
      'device-transfer': [{}],
    },
  }
}

/**
 * Ensure one of the two backup-rule manifest attributes excludes the MotionTag
 * SharedPreferences file.
 */
async function ensureRulesFor(manifestAttr, ownName, ctx) {
  const { mainApplication, appResXmlDir, projectRoot } = ctx
  const value = mainApplication.$[manifestAttr]

  // "false" disables this backup mechanism entirely — nothing to exclude.
  if (value === 'false') {
    return false
  }

  if (!value || value === 'true') {
    // No rules yet: create MotionTag-owned exclude-only rules.
    const doc = emptyRulesDoc(manifestAttr)
    mergeExcludeIntoRules(doc)
    fs.mkdirSync(appResXmlDir, { recursive: true })
    await XML.writeXMLAsync({
      path: path.join(appResXmlDir, `${ownName}.xml`),
      xml: doc,
    })
    mainApplication.$[manifestAttr] = `@xml/${ownName}`
    return true
  }

  const resourceName = value.startsWith('@xml/') ? value.slice('@xml/'.length) : null
  if (!resourceName) {
    console.warn(
      `${WARN_PREFIX} ${manifestAttr} is set to "${value}", which this plugin cannot edit. ` +
        `Add <exclude domain="sharedpref" path="${SDK_SHAREDPREF_FILE}"/> to your backup rules manually ` +
        '(required by the MotionTag SDK).',
    )
    return false
  }

  // Existing rules (host-owned or from another library, e.g. expo-secure-store):
  // merge our exclude in and write the result as an app resource. An app
  // resource with the same name overrides a library resource, so the manifest
  // reference keeps working and other plugins still recognise their own value.
  const sourceFile = findRulesXml(resourceName, { appResXmlDir, projectRoot })
  if (!sourceFile) {
    console.warn(
      `${WARN_PREFIX} ${manifestAttr} references @xml/${resourceName}, but ${resourceName}.xml was not found ` +
        `in the app or node_modules. Add <exclude domain="sharedpref" path="${SDK_SHAREDPREF_FILE}"/> to it manually ` +
        '(required by the MotionTag SDK).',
    )
    return false
  }

  const doc = await XML.readXMLAsync({ path: sourceFile })
  if (!mergeExcludeIntoRules(doc)) {
    // Already excluded (re-run) and the file is already where Android expects it.
    if (path.dirname(sourceFile) === appResXmlDir) {
      return false
    }
  }
  fs.mkdirSync(appResXmlDir, { recursive: true })
  await XML.writeXMLAsync({
    path: path.join(appResXmlDir, `${resourceName}.xml`),
    xml: doc,
  })
  return false // manifest unchanged — only the resource file was written
}

/**
 * Exclude the MotionTag SDK's SharedPreferences from Android Auto Backup.
 *
 * Runs as a finalized mod so it sees the manifest *after* every other plugin
 * (e.g. expo-secure-store) has applied its own backup configuration,
 * regardless of plugin ordering in app.json.
 */
module.exports = function withAndroidBackupRules(config) {
  return withFinalizedMod(config, [
    'android',
    async (cfg) => {
      const projectRoot = cfg.modRequest.projectRoot
      const platformRoot = cfg.modRequest.platformProjectRoot
      const manifestPath = path.join(
        platformRoot,
        'app',
        'src',
        'main',
        'AndroidManifest.xml',
      )
      const appResXmlDir = path.join(
        platformRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
      )

      const manifest = await AndroidConfig.Manifest.readAndroidManifestAsync(
        manifestPath,
      )
      const mainApplication =
        AndroidConfig.Manifest.getMainApplicationOrThrow(manifest)

      // Auto Backup disabled entirely — no stale-state risk, nothing to do.
      if (mainApplication.$['android:allowBackup'] === 'false') {
        return cfg
      }

      const ctx = { mainApplication, appResXmlDir, projectRoot }
      const changedFullBackup = await ensureRulesFor(
        'android:fullBackupContent',
        OWN_BACKUP_RULES_NAME,
        ctx,
      )
      const changedExtraction = await ensureRulesFor(
        'android:dataExtractionRules',
        OWN_EXTRACTION_RULES_NAME,
        ctx,
      )

      if (changedFullBackup || changedExtraction) {
        await AndroidConfig.Manifest.writeAndroidManifestAsync(
          manifestPath,
          manifest,
        )
      }
      return cfg
    },
  ])
}
