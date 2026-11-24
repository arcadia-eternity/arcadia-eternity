import { createRequire } from 'node:module'
import { execFile, spawn } from 'node:child_process'
import { cp, lstat, mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { isDeepStrictEqual, promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { verifyDesktopRuntime } from './stage-desktop-runtime.mjs'
import { verifyDesktopSqlite } from './desktop-sqlite-native.mjs'
import { normalizeRuntimeLinks } from './desktop-runtime-portability.mjs'
import { writeDesktopCliLauncher } from './desktop-cli-launcher.mjs'
import { bounded, shutdownDesktopProcess } from './desktop-acceptance-process.mjs'

const exec = promisify(execFile)
let previewAccepted = false

const architecture = value =>
  typeof value === 'string' ? value : ['ia32', 'x64', 'armv7l', 'arm64', 'universal'][value]

/** Start the independent CLI server on an OS-assigned port and exercise its paired website. */
async function verifyPackagedServer(invocation) {
  const { entry, args, options } = invocation
  const child = spawn(entry, args, {
    ...options,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = '',
    errors = '',
    port
  child.stderr.on('data', chunk => {
    errors = (errors + chunk).slice(-8192)
  })
  try {
    port = await bounded(
      new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('exit', (code, signal) => reject(new Error(`Packaged server exited (${code ?? signal}): ${errors}`)))
        child.stdout.on('data', chunk => {
          output = (output + chunk).slice(-8192)
          const match = /listening on port (\d+)\r?\n/.exec(output)
          if (match) resolve(Number(match[1]))
        })
      }),
      60000,
      'Packaged server did not announce its listening port',
    )
    const url = 'http://127.0.0.1:' + port
    const health = await fetch(url + '/health', { signal: AbortSignal.timeout(10000) })
    if (!health.ok || (await health.json()).status !== 'ok')
      throw new Error('Packaged server returned unhealthy status')
    const site = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!site.ok || !/<html[>\s]/i.test(await site.text()))
      throw new Error('Packaged server did not serve its paired website')
  } finally {
    if (child.pid)
      await shutdownDesktopProcess({
        child,
        ports: port ? [port] : [],
        quit: () =>
          process.platform === 'win32'
            ? exec(join(process.env.SystemRoot, 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'])
            : child.kill('SIGTERM'),
      })
  }
}

/** Invoke both bundled commands from a fresh home with no Node, npm or Arcadia commands on PATH. */
export async function verifyPackagedAuthoring(launcher) {
  const directory = await mkdtemp(join(tmpdir(), 'arcadia-packaged-author-'))
  let preserveDirectory = false
  const authorCli = resolve(launcher)
  const rootCli = join(dirname(authorCli), process.platform === 'win32' ? 'arcadia.cmd' : 'arcadia')
  const env = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) => /^(systemroot|comspec|pathext|tmpdir|temp|tmp)$/i.test(key)),
    ),
    HOME: directory,
    USERPROFILE: directory,
    PATH: process.platform === 'win32' ? join(process.env.SystemRoot, 'System32') : '',
    npm_config_cache: join(directory, 'npm-cache'),
    npm_config_offline: 'true',
  }
  const invocation = (entry, cwd, args) => {
    const options = { cwd, env: { ...env } }
    if (process.platform === 'win32') {
      // A .cmd entry needs the Windows command interpreter. Expand paths inside quotes so
      // spaces and shell metacharacters in the install and temp directories survive.
      const quoted = [entry, ...args].map((value, index) => {
        const key = 'ARCADIA_SMOKE_ARG_' + index
        options.env[key] = value
        return '"%' + key + '%"'
      })
      entry = join(process.env.SystemRoot, 'System32/cmd.exe')
      args = ['/d', '/v:off', '/s', '/c', '"' + quoted.join(' ') + '"']
      options.windowsVerbatimArguments = true
    }
    return { entry, args, options }
  }
  const run = async (commandName, cwd, values, input) => {
    const { entry, args, options } = invocation(commandName, cwd, values)
    const command = exec(entry, args, { ...options, timeout: 120000, maxBuffer: 8 * 1024 * 1024 })
    command.child.stdin.end(input && JSON.stringify(input))
    const { stdout } = await command
    return stdout
  }
  const result = stdout => {
    const receipt = /^ARCADIA_RESULT=(.+)$/m.exec(stdout)
    if (!receipt) throw new Error('Packaged author SDK returned no task receipt')
    return JSON.parse(receipt[1])
  }
  try {
    const { instances } = JSON.parse(await run(authorCli, directory, ['desktop', 'instances']))
    if (!Array.isArray(instances) || instances.length)
      throw new Error('Packaged CLI returned an unexpected player instance in a fresh home')
    const pack = join(directory, 'starter pack')
    await run(authorCli, directory, ['init', 'pack', pack, '--id', 'smoke-pack'])
    const built = result(await run(authorCli, pack, ['pack']))
    if (!built?.integrity?.startsWith('sha512-'))
      throw new Error('Packaged author SDK did not build the starter archive')
    const environment = join(directory, 'smoke-environment')
    await run(authorCli, directory, ['init', 'environment', environment])
    const recipe = result(await run(authorCli, environment, ['pack']))
    const file = 'environment.tgz'
    await cp(join(environment, recipe.filename), join(pack, file))
    const { result: installed } = JSON.parse(
      await run(authorCli, pack, ['workspace', '.', 'environment-install'], {
        source: { kind: 'archive', file },
        offline: true,
      }),
    )
    if (installed?.id !== 'smoke-environment' || installed.integrity !== recipe.integrity)
      throw new Error('Packaged author SDK did not install the environment archive')
    const demo = result(await run(authorCli, installed.directory, ['demo', '--seed', 'packaged-author']))
    if (
      demo?.status !== 'completed' ||
      demo.seed !== 'packaged-author' ||
      demo.candidate?.environmentId !== 'smoke-environment'
    )
      throw new Error('Packaged author SDK did not complete the standalone environment battle')
    console.log(
      'Packaged CLI created both project kinds, installed the environment archive and completed the seeded battle.',
    )
    const simulation = JSON.parse(
      await run(rootCli, directory, [
        'battle',
        'simulate',
        '--player1',
        join(environment, 'debug/teams/blue.yaml'),
        '--player2',
        join(environment, 'debug/teams/orange.yaml'),
        '--seed',
        'packaged-battle',
        '--replay-out',
        'replay.json',
        '--json',
      ]),
    )
    const replay = JSON.parse(await run(rootCli, directory, ['battle', 'replay', 'replay.json', '--verify', '--json']))
    if (
      simulation.counts.completed !== 1 ||
      !replay.verified ||
      !isDeepStrictEqual(replay.result, simulation.results[0])
    )
      throw new Error('Packaged CLI could not reproduce the recorded battle in a new process')
    const data = ['--data-dir', join(directory, 'server data')]
    const empty = JSON.parse(await run(rootCli, directory, ['server', 'db', 'status', ...data]))
    const migrated = JSON.parse(await run(rootCli, directory, ['server', 'db', 'migrate', ...data]))
    if (empty.driver !== 'sqlite' || empty.status !== 'empty' || migrated.status !== 'ready')
      throw new Error('Packaged CLI could not initialize standalone server storage')
    await verifyPackagedServer(
      invocation(rootCli, directory, ['server', ...data, '--host', '127.0.0.1', '--port', '0', '--offline-content']),
    )
    console.log('Packaged arcadia verified a saved replay and served the standalone website and health endpoint.')
  } catch (error) {
    if (error.preserveInstallerWorkspace) {
      preserveDirectory = true
      console.error('Preserving the possibly active server directory:', directory)
    }
    throw error
  } finally {
    if (!preserveDirectory) await rm(directory, { recursive: true, force: true })
  }
}

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
  const launcher = await writeDesktopCliLauncher({ executable, runtime, platform })
  const runtimeRequire = createRequire(join(runtime, 'node_modules/@arcadia-eternity/database/package.json'))
  await verifyDesktopSqlite({
    executable,
    moduleRoot: dirname(runtimeRequire.resolve('better-sqlite3/package.json')),
    electronVersion: manifest.electron.version,
    platform,
    arch,
  })
  if (process.env.ARCADIA_DESKTOP_MANAGED_HOST_TEST === '1') {
    await verifyPackagedAuthoring(launcher)
    const test = fileURLToPath(
      new URL('../packages/web-ui/electron/test/desktop-managed-host-real.test.ts', import.meta.url),
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
    }).catch(error => {
      process.stdout.write(error.stdout ?? '')
      process.stderr.write(error.stderr ?? '')
      throw error
    })
    process.stdout.write(result.stdout)
    process.stderr.write(result.stderr)
  }
  return manifest
}

// Packaging retains notice findings while checking the runtime layout.
export async function beforePack() {
  const staged = fileURLToPath(new URL('../packages/web-ui/dist/arcadia-server', import.meta.url))
  await verifyDesktopRuntime(staged, { allowIncompleteNotices: true, requireNative: true })
}

export async function afterPack(context) {
  await verifyPackagedRuntime(context)
}

// Optional strict audit; normal packaging and publication use advisory notices.
export async function requireCompleteNotices(root) {
  return verifyDesktopRuntime(root, { requireNative: true, allowIncompleteNotices: false })
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
            'shared/**/*.mjs',
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
  if (process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--require-complete-notices')) {
    const staged = fileURLToPath(new URL('../packages/web-ui/dist/arcadia-server', import.meta.url))
    const check =
      process.argv[2] === '--require-complete-notices'
        ? requireCompleteNotices(staged)
        : verifyDesktopRuntime(staged, { requireNative: true })
    check
      .then(manifest => {
        if (manifest.missingLicenseTexts.length)
          console.warn(
            `License inventory: ${manifest.missingLicenseTexts.length} advisory findings; see ${join(staged, 'licenses/notice.json')}`,
          )
      })
      .catch(error => {
        console.error(error)
        process.exitCode = 1
      })
  } else if (process.argv[2] !== '--preview') {
    console.error(
      'Usage: node scripts/verify-desktop-pack.mjs [--require-complete-notices] | --preview [--web-dist <directory>] [--runtime <directory>]',
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
