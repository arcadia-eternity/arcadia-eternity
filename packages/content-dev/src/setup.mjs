#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL, fileURLToPath } from 'node:url'

export async function setup(args = process.argv.slice(2), root = process.cwd()) {
  root = resolve(root)
  const options = { offline: false }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--help') {
      console.log('arcadia-content setup [--sdk-dir /path/to/sdk] [--offline]')
      return
    }
    if (arg === '--offline' && !options.offline) options.offline = true
    else if (arg === '--sdk-dir' && !options.sdkDir && args[i + 1] && !args[i + 1].startsWith('--'))
      options.sdkDir = resolve(args[++i])
    else throw new Error(`Unknown, duplicate or incomplete option: ${arg}`)
  }

  const pin = JSON.parse(await readFile(join(root, 'arcadia-sdk.json'), 'utf8'))
  if (!/^[a-f0-9]{40}$/.test(pin.revision) || !/^\d+\.\d+\.\d+$/.test(pin.pnpmVersion) || pin.sdkApi !== 2)
    throw new Error('Invalid SDK pin in arcadia-sdk.json')
  if (process.platform === 'win32' || Number(process.versions.node.split('.')[0]) !== 24)
    throw new Error('This development SDK currently supports Node.js 24 on Linux or macOS.')

  const env = {
    ...process.env,
    pnpm_config_verify_deps_before_run: 'false',
    ELECTRON_SKIP_BINARY_DOWNLOAD: '1',
  }
  function run(command, args, cwd = root) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, env, stdio: 'inherit' })
      child.on('error', reject)
      child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))))
    })
  }
  const exists = path =>
    access(path).then(
      () => true,
      () => false,
    )
  const state = join(root, '.arcadia')
  await mkdir(state, { recursive: true })
  const sdkDirectory = options.sdkDir ?? join(state, `sdk-${pin.revision}`)

  try {
    if (!options.sdkDir && !(await exists(join(sdkDirectory, 'arcadia-author-sdk.json')))) {
      if (options.offline) throw new Error('Prepare an SDK first, or supply --sdk-dir for offline setup.')
      const source = join(state, `source-${pin.revision}`)
      if (!(await exists(source))) {
        await mkdir(source)
        await run('git', ['init', '--quiet'], source)
        await run('git', ['remote', 'add', 'origin', pin.repository], source)
      }
      await run('git', ['fetch', '--depth=1', 'origin', pin.revision], source)
      await run('git', ['checkout', '--detach', pin.revision], source)
      const head = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: source,
        encoding: 'utf8',
      }).trim()
      const changes = execFileSync('git', ['status', '--porcelain'], {
        cwd: source,
        encoding: 'utf8',
      }).trim()
      if (head !== pin.revision || changes)
        throw new Error('The cached SDK source must match the pinned revision without local changes.')
      const pnpm = args => run('npx', ['--yes', `--package=pnpm@${pin.pnpmVersion}`, 'pnpm', ...args], source)
      await pnpm(['install', '--frozen-lockfile', '--ignore-scripts'])
      await pnpm(['--filter', '@arcadia-eternity/content-dev...', 'run', 'build'])
      await run(process.execPath, ['scripts/stage-author-sdk.mjs', sdkDirectory], source)
    }
    const index = JSON.parse(await readFile(join(sdkDirectory, 'arcadia-author-sdk.json'), 'utf8'))
    if (
      index.format !== 'arcadia.author-sdk-local' ||
      index.version !== 1 ||
      index.sdkApi !== pin.sdkApi ||
      index.build?.formatVersion !== 1 ||
      ![index.build.coreBuildId, index.build.registryBuildId].every(id => /^[a-f0-9]{64}$/.test(id))
    )
      throw new Error('SDK manifest format, API or build identity does not match this template.')
    const required = new Set(
      ['battle', 'const', 'interface', 'pack-loader', 'protocol', 'schema', 'content-dev'].map(
        name => `@arcadia-eternity/${name}`,
      ),
    )
    const archives = []
    for (const pkg of index.packages) {
      if (!required.delete(pkg.name) || basename(pkg.filename) !== pkg.filename || !pkg.filename.endsWith('.tgz'))
        throw new Error(`Unexpected or duplicated SDK archive: ${pkg.name}`)
      const file = join(sdkDirectory, pkg.filename)
      const digest = createHash('sha256')
        .update(await readFile(file))
        .digest('hex')
      if (digest !== pkg.sha256) throw new Error(`SDK archive checksum mismatch: ${pkg.filename}`)
      archives.push(file)
    }
    if (required.size) throw new Error(`Missing SDK packages: ${[...required].join(', ')}`)
    await run('npm', [
      'install',
      '--ignore-scripts',
      '--no-save',
      '--no-package-lock',
      '--no-audit',
      '--no-fund',
      ...(options.offline ? ['--offline'] : []),
      ...archives,
    ])
    const require = createRequire(join(root, 'package.json'))
    const { nativeBuildIdentity } = await import(
      pathToFileURL(require.resolve('@arcadia-eternity/battle/v4/build')).href
    )
    if (
      nativeBuildIdentity.coreBuildId !== index.build.coreBuildId ||
      nativeBuildIdentity.registryBuildId !== index.build.registryBuildId
    )
      throw new Error('Installed SDK build differs from the archive manifest.')
    await writeFile(
      join(state, 'sdk-installed.json'),
      JSON.stringify(
        {
          sdkApi: index.sdkApi,
          source: options.sdkDir ? 'provided-sdk' : pin.repository,
          revision: options.sdkDir ? null : pin.revision,
          build: index.build,
        },
        null,
        2,
      ) + '\n',
    )
    console.log('SDK installed. Run npm test, npm run demo, or npm run pack.')
  } catch (error) {
    throw new Error(`SDK setup failed: ${error.message}`, { cause: error })
  }
}
if (
  process.argv[1] &&
  !import.meta.url.startsWith('data:') &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  setup().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
