import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { promisify } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifyDesktopRuntime } from './stage-desktop-runtime.mjs'
import { verifyDesktopSqlite } from './desktop-sqlite-native.mjs'

const exec = promisify(execFile)

const architecture = value =>
  typeof value === 'string' ? value : ['ia32', 'x64', 'armv7l', 'arm64', 'universal'][value]
async function verifyPackagedRuntime(context) {
  const resources = context.packager.getResourcesDir(context.appOutDir)
  const runtime = join(resources, 'arcadia-server')
  const platform = context.electronPlatformName,
    arch = architecture(context.arch)
  if (!['darwin', 'linux', 'win32'].includes(platform) || !['x64', 'arm64', 'ia32', 'armv7l'].includes(arch))
    throw new Error('Native desktop acceptance requires an explicit supported platform and architecture')
  const manifest = await verifyDesktopRuntime(runtime, {
    allowIncompleteNotices: true,
    requireNative: true,
    platform,
    arch,
  })
  if (platform !== process.platform || arch !== process.arch)
    throw new Error('Native desktop acceptance must run on its target platform and architecture')
  const product = context.packager.appInfo.productFilename
  const executable =
    platform === 'darwin'
      ? join(resources, '../MacOS', product)
      : join(context.appOutDir, platform === 'win32' ? `${product}.exe` : context.packager.executableName)
  const runtimeRequire = createRequire(join(runtime, 'node_modules/@arcadia-eternity/database/package.json'))
  await verifyDesktopSqlite({
    executable,
    moduleRoot: dirname(runtimeRequire.resolve('better-sqlite3/package.json')),
    electronVersion: manifest.electron.version,
    platform,
    arch,
  })
  if (process.env.ARCADIA_DESKTOP_MANAGED_HOST_TEST === '1') {
    const test = fileURLToPath(
      new URL('../packages/web-ui/electron/test/desktop-managed-host-real.test.mjs', import.meta.url),
    )
    const result = await exec(process.execPath, ['--test', test], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env: {
        ...process.env,
        ARCADIA_DESKTOP_REAL_HOST: '1',
        ARCADIA_DESKTOP_EXECUTABLE: executable,
        ARCADIA_DESKTOP_CLI: join(runtime, 'cli.js'),
        ARCADIA_DESKTOP_NPM_CLI: join(runtime, 'runtime/npm/bin/npm-cli.js'),
        ARCADIA_DESKTOP_PACKS_DIRECTORY: join(runtime, 'packs'),
      },
      timeout: 240000,
      maxBuffer: 4 * 1024 * 1024,
    })
    process.stdout.write(result.stdout)
    process.stderr.write(result.stderr)
  }
  return manifest
}

// Local packaging permits incomplete notices while checking the runtime layout.
export async function beforePack() {
  const staged = fileURLToPath(new URL('../packages/web-ui/dist/arcadia-server', import.meta.url))
  await verifyDesktopRuntime(staged, { allowIncompleteNotices: true, requireNative: true })
}

export async function afterPack(context) {
  await verifyPackagedRuntime(context)
}

// Use this before publication when the complete notices are available.
export async function requireCompleteNotices(root) {
  return verifyDesktopRuntime(root, { requireNative: true })
}

// Preview hooks check required files and contained paths, and record incomplete notices.
export async function beforePreviewPack() {
  const staged = fileURLToPath(new URL('../packages/web-ui/dist/arcadia-server', import.meta.url))
  await verifyDesktopRuntime(staged, { allowIncompleteNotices: true, requireNative: true })
}

export async function afterPreviewPack(context) {
  await verifyPackagedRuntime(context)
}

export function previewBuilderConfiguration({ webDist, runtime } = {}) {
  const require = createRequire(new URL('../packages/web-ui/package.json', import.meta.url))
  const executable = process.env.ELECTRON_OVERRIDE_DIST_PATH ? require('electron') : undefined
  const staged = runtime
    ? resolve(runtime)
    : fileURLToPath(new URL('../packages/web-ui/dist/arcadia-server', import.meta.url))
  const verifyInputs = async () => {
    await verifyDesktopRuntime(staged, { allowIncompleteNotices: true, requireNative: true })
    if (webDist && !(await stat(join(resolve(webDist), 'index.html'))).isFile())
      throw new Error('Desktop renderer index is missing')
  }
  return {
    appId: 'com.arcadia.eternity.preview',
    productName: 'Arcadia Eternity Preview',
    directories: { output: 'release-preview' },
    // The preview targets this host, using the same installed, locked Electron
    // runtime checked by staging instead of downloading a second copy.
    electronDist: executable
      ? process.platform === 'darwin'
        ? resolve(dirname(executable), '../../..')
        : dirname(executable)
      : join(dirname(require.resolve('electron/package.json')), 'dist'),
    ...(webDist
      ? {
          files: [
            { from: resolve(webDist), to: 'dist', filter: ['**/*', '!arcadia-server/**'] },
            'electron/**/*',
            'package.json',
          ],
        }
      : {}),
    ...(runtime
      ? {
          extraResources: [
            { from: staged, to: 'arcadia-server' },
            { from: join(staged, 'node_modules'), to: 'arcadia-server/node_modules', filter: ['**/*'] },
          ],
        }
      : {}),
    beforePack: runtime || webDist ? verifyInputs : beforePreviewPack,
    afterPack: afterPreviewPack,
    publish: null,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length === 3 && process.argv[2] === '--require-complete-notices') {
    const staged = fileURLToPath(new URL('../packages/web-ui/dist/arcadia-server', import.meta.url))
    requireCompleteNotices(staged).catch(error => {
      console.error(error)
      process.exitCode = 1
    })
  } else if (process.argv[2] !== '--preview') {
    console.error(
      'Usage: node scripts/verify-desktop-pack.mjs --preview [--web-dist <directory>] [--runtime <directory>] | --require-complete-notices',
    )
    process.exitCode = 1
  } else {
    const inputs = {}
    for (let i = 3; i < process.argv.length; i += 2) {
      const option = process.argv[i],
        value = process.argv[i + 1]
      const key = option === '--web-dist' ? 'webDist' : option === '--runtime' ? 'runtime' : undefined
      if (!key || !value || value.startsWith('--') || inputs[key]) throw new Error('Invalid preview input arguments')
      inputs[key] = value
    }
    const require = createRequire(new URL('../packages/web-ui/package.json', import.meta.url))
    const { build } = require('electron-builder')
    let finished = false
    let verified = false
    // Some Builder child-process failures can leave its promise unsettled even
    // after all handles close. Such a build must never report success.
    process.once('beforeExit', () => {
      if (!finished) {
        console.error('Preview build ended before the packaged runtime was verified')
        process.exitCode = 1
      }
    })
    build({
      dir: true,
      publish: 'never',
      config: {
        ...previewBuilderConfiguration(inputs),
        afterPack: async context => {
          await afterPreviewPack(context)
          verified = true
        },
      },
    })
      .then(() => {
        if (!verified) throw new Error('Preview build did not verify the packaged runtime')
        finished = true
      })
      .catch(error => {
        finished = true
        console.error(error)
        process.exitCode = 1
      })
  }
}
