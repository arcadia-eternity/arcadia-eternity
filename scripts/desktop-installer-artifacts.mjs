import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, posix, relative, resolve, sep, win32 } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const require = createRequire(new URL('../packages/content-dev/package.json', import.meta.url))
const yauzl = require('yauzl')
const platforms = { 'mac-zip': 'darwin', 'win-zip': 'win32', nsis: 'win32', appimage: 'linux' }
const within = (root, target) => {
  const path = relative(root, target)
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}
const missing = error => {
  if (error.code !== 'ENOENT') throw error
}

function safeRelative(value, windows = false) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 4096 ||
    /[\x00-\x1f\\:]/.test(value) ||
    posix.isAbsolute(value) ||
    win32.isAbsolute(value)
  )
    throw new Error('Artifact path must be a safe relative path')
  const path = value.endsWith('/') ? value.slice(0, -1) : value
  if (
    !path ||
    path
      .split('/')
      .some(
        part =>
          !part ||
          part === '.' ||
          part === '..' ||
          (windows && (/[:<>"|?*]|[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))),
      )
  )
    throw new Error('Artifact path must be a safe relative path')
  return path
}

async function digest(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function zipEntries(file, visit) {
  const zip = await new Promise((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (error, value) =>
      error ? reject(error) : resolve(value),
    ),
  )
  try {
    await new Promise((resolve, reject) => {
      zip.on('error', reject)
      zip.on('end', resolve)
      zip.on('entry', entry => {
        const open = () =>
          new Promise((resolve, reject) =>
            zip.openReadStream(entry, (error, value) => (error ? reject(error) : resolve(value))),
          )
        Promise.resolve()
          .then(() => visit(entry, open))
          .then(
            () => zip.readEntry(),
            error => {
              zip.close()
              reject(error)
            },
          )
      })
      zip.readEntry()
    })
  } finally {
    zip.close()
  }
}

function consumeZipStream(stream, expectedSize, destination) {
  // yauzl's stored-entry stream predates async iteration and sets destroyed
  // before its end event without emitting close. Consume its documented
  // data/end events instead of waiting for an iterator/pipeline close event.
  return new Promise((resolve, reject) => {
    const chunks = [],
      output = destination ? createWriteStream(destination, { flags: 'wx' }) : undefined
    let size = 0,
      settled = false,
      ended = false
    const finish = error => {
      if (settled) return
      settled = true
      if (error) {
        reject(error)
        stream.destroy()
        output?.destroy()
      } else resolve(output ? undefined : Buffer.concat(chunks, size))
    }
    stream.on('error', finish)
    stream.on('data', chunk => {
      size += chunk.length
      if (size > expectedSize) return finish(new Error('Archive entry exceeds its declared size'))
      if (!output) chunks.push(chunk)
    })
    stream.on('end', () => {
      ended = true
      if (size !== expectedSize) finish(new Error('Archive entry differs from its declared size'))
      else if (!output) finish()
    })
    stream.on('close', () => {
      if (!ended) finish(new Error('Archive entry stream ended prematurely'))
    })
    if (output) {
      output.on('error', finish)
      output.on('finish', () => finish(size === expectedSize ? undefined : new Error('Archive entry size differs')))
      stream.pipe(output)
    }
  })
}

async function inspectZip(file, windows) {
  const entries = new Map(),
    identities = new Set()
  let size = 0
  await zipEntries(file, async (entry, open) => {
    const path = safeRelative(entry.fileName, windows)
    const identity = path.normalize('NFC').toLowerCase()
    if (identities.has(identity)) throw new Error('Artifact contains duplicate or case-colliding paths')
    identities.add(identity)
    if (entries.size >= 500000 || (size += entry.uncompressedSize) > 32 * 1024 ** 3)
      throw new Error('Artifact exceeds extraction limits')
    if (entry.generalPurposeBitFlag & 1) throw new Error('Encrypted installer archives are unsupported')
    const mode = entry.externalFileAttributes >>> 16
    const kind = mode & 0o170000
    if (![0, 0o100000, 0o040000, 0o120000].includes(kind)) throw new Error('Artifact contains an unsupported file type')
    const item = { path, directory: entry.fileName.endsWith('/') || kind === 0o040000, mode }
    if (kind === 0o120000) {
      if (entry.uncompressedSize > 4096) throw new Error('Artifact link target is too long')
      item.link = (await consumeZipStream(await open(), entry.uncompressedSize)).toString('utf8')
      if (!item.link || /[\x00-\x1f\\]/.test(item.link) || posix.isAbsolute(item.link) || win32.isAbsolute(item.link))
        throw new Error('Artifact contains an unsafe symbolic link')
      const target = posix.normalize(posix.join(posix.dirname(path), item.link))
      if (target === '..' || target.startsWith('../')) throw new Error('Artifact link escapes its installation')
      item.target = target
    }
    entries.set(path, item)
  })
  function resolveLink(path, seen = new Set()) {
    const parts = path.split('/')
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/')
      const item = entries.get(prefix)
      if (!item?.link) continue
      if (seen.has(prefix)) throw new Error('Artifact contains a symbolic link cycle')
      return resolveLink(posix.join(item.target, ...parts.slice(i)), new Set([...seen, prefix]))
    }
    return path
  }
  for (const item of entries.values()) {
    for (let parent = posix.dirname(item.path); parent !== '.'; parent = posix.dirname(parent)) {
      const ancestor = entries.get(parent)
      if (ancestor && (!ancestor.directory || ancestor.link))
        throw new Error('Artifact entry traverses a file or symbolic link')
    }
    if (item.link) {
      const target = resolveLink(item.path)
      if (!entries.has(target) && ![...entries.keys()].some(path => path.startsWith(`${target}/`)))
        throw new Error('Artifact contains a missing symbolic link target')
    }
  }
  return entries
}

async function extractWindowsZip(file, directory, entries) {
  await zipEntries(file, async (entry, open) => {
    const item = entries.get(safeRelative(entry.fileName, true))
    const destination = join(directory, item.path)
    if (item.directory) await mkdir(destination, { recursive: true })
    else if (!item.link) {
      await mkdir(dirname(destination), { recursive: true })
      await consumeZipStream(await open(), entry.uncompressedSize, destination)
    }
  })
  for (const item of entries.values()) {
    if (!item.link) continue
    const destination = join(directory, item.path)
    await mkdir(dirname(destination), { recursive: true })
    const directoryTarget =
      entries.get(item.target)?.directory || [...entries.keys()].some(path => path.startsWith(`${item.target}/`))
    await symlink(item.link, destination, directoryTarget ? 'dir' : 'file')
  }
}

async function auditTree(root) {
  const physical = await lstat(root)
  if (!physical.isDirectory() || physical.isSymbolicLink()) throw new Error('Installation must be a physical directory')
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) {
        const target = await readlink(path)
        if (isAbsolute(target) || !within(root, resolve(directory, target)) || !within(root, await realpath(path)))
          throw new Error('Installed link escapes its application directory')
      } else if (entry.isDirectory()) await visit(path)
      else if (!entry.isFile()) throw new Error('Installed application contains an unsupported file')
    }
  }
  await visit(root)
}

function requireNsisPolicy(policy) {
  if (
    process.platform !== 'win32' ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.RUNNER_ENVIRONMENT !== 'github-hosted'
  )
    throw new Error('NSIS acceptance is restricted to disposable GitHub-hosted Windows runners')
  if (!/^com\.arcadia\.eternity\.(?:preview|acceptance)(?:[.-][a-z0-9-]+)*$/i.test(policy?.appId ?? ''))
    throw new Error('NSIS acceptance requires a distinct preview application ID')
  for (const key of [
    'perMachine',
    'allowElevation',
    'createDesktopShortcut',
    'createStartMenuShortcut',
    'runAfterFinish',
  ])
    if (policy[key] !== false) throw new Error(`NSIS acceptance requires ${key}: false`)
}

async function runNsis(executable, installedRoot, cwd) {
  if (/[\r\n"]/.test(executable + installedRoot)) throw new Error('NSIS paths cannot contain quotes or newlines')
  await new Promise((resolve, reject) => {
    // NSIS requires the final /D argument unquoted. Quote argv[0] ourselves
    // because verbatim mode also disables Node's executable-path quoting.
    const child = spawn(executable, ['/S', '/currentuser', '--no-desktop-shortcut', `/D=${installedRoot}`], {
      argv0: `"${executable}"`,
      windowsVerbatimArguments: true,
      cwd,
      stdio: ['ignore', 'ignore', 'pipe'],
      signal: AbortSignal.timeout(300000),
    })
    let failure,
      stderr = ''
    child.on('error', error => {
      failure = error
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
      if (stderr.length > 4 * 1024 * 1024) {
        failure = new Error('NSIS installer exceeded its output limit')
        child.kill()
      }
    })
    child.on('close', (code, signal) => {
      if (failure) reject(failure)
      else if (code !== 0) reject(new Error(`NSIS installation failed (${code ?? signal}): ${stderr}`))
      else resolve()
    })
  })
}

/** Isolated artifact acceptance, not an application updater. The caller must
 * stop all consumers before install/close. Replacement rolls back application
 * files, never application data or Windows registry changes. NSIS therefore
 * runs only on disposable hosted Windows CI with a distinct preview app ID.
 * A trusted acceptance callback that cannot prove consumer termination must
 * throw an error marked preserveInstallerWorkspace: true. That permanently
 * freezes this workspace and retains every file for diagnosis/manual cleanup.
 */
export async function createDesktopInstallerWorkspace({ parentDirectory = tmpdir() } = {}) {
  const parent = await realpath(parentDirectory)
  if (!(await lstat(parent)).isDirectory()) throw new Error('Installer scratch parent must be a directory')
  const scratchRoots = [await realpath(tmpdir())]
  if (
    process.env.GITHUB_ACTIONS === 'true' &&
    process.env.RUNNER_ENVIRONMENT === 'github-hosted' &&
    process.env.RUNNER_TEMP
  )
    scratchRoots.push(await realpath(process.env.RUNNER_TEMP))
  if (!scratchRoots.some(directory => within(directory, parent)))
    throw new Error('Installer workspace must be inside an operating-system or hosted-runner temporary directory')
  const root = await mkdtemp(join(parent, 'arcadia-installer-'))
  await chmod(root, 0o700)
  const owner = randomUUID(),
    marker = join(root, '.owner')
  const profileDir = join(root, 'profile'),
    installedRoot = join(root, 'application')
  await writeFile(marker, owner, { flag: 'wx', mode: 0o600 })
  await mkdir(profileDir, { mode: 0o700 })
  const identity = await lstat(root)
  let busy = false,
    closed = false,
    retained = false
  const retainedError = () =>
    new Error(`Installer workspace retained at ${root}: application termination was not proven`)
  async function owned() {
    if (closed) throw new Error('Installer workspace is closed')
    const current = await lstat(root)
    if (
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      current.dev !== identity.dev ||
      current.ino !== identity.ino ||
      !(await lstat(marker)).isFile() ||
      (await lstat(marker)).isSymbolicLink() ||
      (await readFile(marker, 'utf8')) !== owner
    )
      throw new Error('Installer workspace ownership changed')
    if (!(await lstat(profileDir)).isDirectory() || (await lstat(profileDir)).isSymbolicLink())
      throw new Error('Installer profile must remain a physical directory')
  }
  return {
    root,
    profileDir,
    async install({ artifact, sha256, format, executableRelativePath, accept, nsisPolicy }) {
      if (retained) throw retainedError()
      if (busy) throw new Error('Installer workspace is busy')
      busy = true
      let temporary,
        backup,
        failure,
        replaced = false,
        hadPrevious = false,
        committed = false
      try {
        await owned()
        if (!Object.hasOwn(platforms, format) || platforms[format] !== process.platform)
          throw new Error('Installer artifact requires its native platform')
        if (!/^[a-f0-9]{64}$/i.test(sha256 ?? '')) throw new Error('Artifact SHA-256 provenance is required')
        if (accept !== undefined && typeof accept !== 'function')
          throw new Error('Installer acceptance must be a function')
        if (format === 'nsis') requireNsisPolicy(nsisPolicy)
        const executablePath =
          format === 'appimage'
            ? 'application.AppImage'
            : safeRelative(executableRelativePath, process.platform === 'win32')
        if (format === 'mac-zip' && !/^[^/]+\.app\/Contents\/MacOS\/[^/]+$/.test(executablePath))
          throw new Error('Mac executable must identify its application bundle')
        if (!(await lstat(artifact)).isFile() || (await lstat(artifact)).isSymbolicLink())
          throw new Error('Installer artifact must be a regular file')
        temporary = await mkdtemp(join(root, 'staging-'))
        const snapshot = join(temporary, format === 'nsis' ? 'installer.exe' : 'artifact')
        await copyFile(artifact, snapshot)
        const artifactHash = await digest(snapshot)
        if (artifactHash !== sha256.toLowerCase()) throw new Error('Artifact SHA-256 does not match its provenance')
        const candidate = join(temporary, 'application')
        await mkdir(candidate, { mode: 0o700 })
        if (format.endsWith('-zip')) {
          const entries = await inspectZip(snapshot, format === 'win-zip')
          if (format === 'mac-zip')
            await exec('/usr/bin/ditto', ['-x', '-k', snapshot, candidate], { timeout: 300000, maxBuffer: 1024 * 1024 })
          else await extractWindowsZip(snapshot, candidate, entries)
        } else if (format === 'appimage') {
          await copyFile(snapshot, join(candidate, executablePath))
          await chmod(join(candidate, executablePath), 0o700)
        }
        await owned()
        const previous = await lstat(installedRoot).catch(missing)
        if (previous) {
          await auditTree(installedRoot)
          hadPrevious = true
          backup = join(root, `backup-${randomUUID()}`)
          if (format === 'nsis')
            await cp(installedRoot, backup, {
              recursive: true,
              verbatimSymlinks: true,
              force: false,
              errorOnExist: true,
            })
          else await rename(installedRoot, backup)
        }
        replaced = true
        if (format === 'nsis') {
          await runNsis(snapshot, installedRoot, temporary)
        } else await rename(candidate, installedRoot)
        await auditTree(installedRoot)
        const executable = join(installedRoot, executablePath)
        const executableInfo = await lstat(executable)
        if (!executableInfo.isFile() || executableInfo.isSymbolicLink())
          throw new Error('Installed application executable is missing or linked')
        const result = {
          executable,
          argsPrefix: [],
          installedRoot,
          profileDir,
          artifactHash,
          format,
          ...(format === 'appimage'
            ? { runtimeEntry: { baseEnvironment: 'APPDIR', relativePath: 'resources/arcadia-server' } }
            : {}),
        }
        if (accept) {
          try {
            await accept(result)
          } catch (error) {
            if (error?.preserveInstallerWorkspace === true) retained = true
            throw error
          }
        }
        await owned()
        committed = true
        if (backup) await rm(backup, { recursive: true })
        backup = undefined
        return result
      } catch (error) {
        failure = error
        if (replaced && !committed && !retained) {
          try {
            await owned()
            await rm(installedRoot, { recursive: true, force: true })
            if (hadPrevious) await rename(backup, installedRoot)
            backup = undefined
          } catch (rollbackError) {
            failure = new AggregateError(
              [error, rollbackError],
              'Installer failed and application files could not be restored',
            )
          }
        } else if (backup && !committed && !retained) {
          try {
            await owned()
            await rm(backup, { recursive: true, force: true })
          } catch (cleanupError) {
            failure = new AggregateError(
              [error, cleanupError],
              'Installer failed and its incomplete backup could not be removed',
            )
          }
        }
        throw failure
      } finally {
        try {
          if (temporary && !retained) {
            await owned()
            await rm(temporary, { recursive: true, force: true })
          }
        } catch (cleanupError) {
          if (failure)
            throw new AggregateError(
              [failure, cleanupError],
              'Installer failed and its temporary files could not be removed',
            )
          throw cleanupError
        } finally {
          busy = false
        }
      }
    },
    async close() {
      if (retained) throw retainedError()
      if (busy) throw new Error('Installer workspace is busy')
      if (closed) return
      await owned()
      await rm(root, { recursive: true })
      closed = true
    },
  }
}
