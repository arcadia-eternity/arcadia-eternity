import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'
import { cp, lstat, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifyDesktopRuntime } from './stage-desktop-runtime.mjs'
import { verifyDesktopSqlite } from './desktop-sqlite-native.mjs'
import { normalizeRuntimeLinks } from './desktop-runtime-portability.mjs'

const exec = promisify(execFile)
let previewAccepted = false

const architecture = value =>
  typeof value === 'string' ? value : ['ia32', 'x64', 'armv7l', 'arm64', 'universal'][value]

export async function verifyPackagedRuntimeFiles(runtime, { platform, arch, appOutDir }) {
  if (platform === 'win32') {
    const output = appOutDir && resolve(appOutDir)
    const withinApp = output && relative(output, resolve(runtime))
    if (!withinApp || withinApp === '..' || withinApp.startsWith(`..${sep}`) || isAbsolute(withinApp))
      throw new Error('Packaged runtime must be inside the application output directory')
    // Do not let a link within Builder's trusted output boundary redirect the
    // directory whose links we will modify. Ancestors above that configured
    // output are not part of the packaged tree.
    for (let directory = resolve(runtime); ; directory = dirname(directory)) {
      if (!(await lstat(directory)).isDirectory())
        throw new Error('Packaged runtime and its parents must be physical directories')
      if (relative(output, directory) === '') break
      if (dirname(directory) === directory) throw new Error('Packaged runtime is outside the application output')
    }
    // Builder copies relative links as Windows junctions. Node expands them
    // relative to the destination link, producing absolute package-local paths.
    // Audit every lexical and resolved target before rewriting any link. An
    // external/staging target is rejected, never rebased into the package.
    await normalizeRuntimeLinks(runtime)
  }
  return verifyDesktopRuntime(runtime, {
    allowIncompleteNotices: true,
    requireNative: true,
    platform,
    arch,
  })
}

async function verifyPackagedRuntime(context) {
  const resources = context.packager.getResourcesDir(context.appOutDir)
  const runtime = join(resources, 'arcadia-server')
  const platform = context.electronPlatformName,
    arch = architecture(context.arch)
  if (!['darwin', 'linux', 'win32'].includes(platform) || !['x64', 'arm64', 'ia32', 'armv7l'].includes(arch))
    throw new Error('Native desktop acceptance requires an explicit supported platform and architecture')
  const manifest = await verifyPackagedRuntimeFiles(runtime, { platform, arch, appOutDir: context.appOutDir })
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
  previewAccepted = true
}

/** Materialize an external renderer inside the app workspace without relaxing
 * electron-builder's protection against copying system paths into ASAR. */
export async function preparePreviewInputs(
  inputs,
  {
    temporaryParent = fileURLToPath(new URL('../packages/web-ui/.desktop-preview-inputs.local/', import.meta.url)),
  } = {},
) {
  const source = inputs.webDist ? resolve(inputs.webDist) : undefined
  async function check(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error('Renderer snapshot must contain regular files, not symbolic links')
      if (entry.isDirectory()) await check(file)
      else if (!entry.isFile()) throw new Error('Renderer snapshot contains an unsupported file')
    }
  }
  if (source) {
    if (!(await lstat(join(source, 'index.html'))).isFile()) throw new Error('Desktop renderer index is missing')
    await check(source)
  }
  await mkdir(temporaryParent, { recursive: true })
  const temporary = await mkdtemp(join(temporaryParent, 'snapshot-'))
  try {
    if (!source) return { inputs, directory: temporary, cleanup: () => rm(temporary, { recursive: true, force: true }) }
    const webDist = join(temporary, 'web')
    await cp(source, webDist, { recursive: true, verbatimSymlinks: true })
    await check(webDist)
    return {
      inputs: { ...inputs, webDist },
      directory: temporary,
      cleanup: () => rm(temporary, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(temporary, { recursive: true, force: true })
    throw error
  }
}

/** Electron Builder concatenates arrays when option config is merged into
 * package.json. A complete explicit config prevents stale/default inputs from
 * being copied beside the chosen renderer and server runtime. */
export async function writePreviewConfiguration(prepared) {
  const file = join(prepared.directory, 'builder-config.mjs')
  const packageUrl = new URL('../packages/web-ui/package.json', import.meta.url).href
  await writeFile(
    file,
    `import { readFileSync } from 'node:fs'\nimport { previewBuilderConfiguration } from ${JSON.stringify(import.meta.url)}\nconst base=JSON.parse(readFileSync(new URL(${JSON.stringify(packageUrl)}),'utf8')).build\nexport default { ...base, ...previewBuilderConfiguration(${JSON.stringify(prepared.inputs)}) }\n`,
    { flag: 'wx' },
  )
  return file
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
            { from: staged, to: 'arcadia-server', filter: ['**/*', '!node_modules/**'] },
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
    let succeeded = false
    // Some Builder child-process failures can leave its promise unsettled even
    // after all handles close. Such a build must never report success.
    process.once('beforeExit', () => {
      if (!finished) {
        console.error('Preview build ended before the packaged runtime was verified')
      }
      if (!succeeded) process.exitCode = 1
    })
    // Some Builder cleanup callbacks reset exitCode; an incomplete/failed
    // acceptance must retain a failing terminal status even after cleanup.
    process.once('exit', () => {
      if (!succeeded) process.exitCode = 1
    })
    const prepared = await preparePreviewInputs(inputs)
    const configurationFile = await writePreviewConfiguration(prepared)
    // The generated config imports this module's hooks. Let this module finish
    // evaluating before Builder loads it, avoiding a top-level-await cycle.
    build({
      dir: true,
      publish: 'never',
      config: configurationFile,
    })
      .then(() => {
        if (!previewAccepted) throw new Error('Preview build did not verify the packaged runtime')
        finished = true
        succeeded = true
      })
      .catch(error => {
        finished = true
        console.error(error)
        process.exitCode = 1
      })
      .finally(() => prepared.cleanup())
  }
}
