import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { lstat, readdir, readlink, realpath, rename, stat, symlink, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, posix, relative, resolve, sep, win32 } from 'node:path'

// Windows junction readlink() may use an extended path although realpath(root)
// uses a regular drive or UNC path. Compare both in the same lexical namespace.
function lexicalPath(path) {
  if (process.platform !== 'win32' || !path.startsWith('\\\\?\\')) return path
  return path.startsWith('\\\\?\\UNC\\') ? `\\\\${path.slice(8)}` : path.slice(4)
}

function contained(root, path) {
  const remainder = relative(lexicalPath(root), lexicalPath(path))
  return remainder === '' || (remainder !== '..' && !remainder.startsWith(`..${sep}`) && !isAbsolute(remainder))
}

function invalid(code, path) {
  return Object.assign(new Error(`${code}: ${path}`), { code })
}

/** Audit a staged runtime and make contained absolute links relocatable.
 * The caller owns this staging directory exclusively. Never follow linked
 * directories while walking: their physical targets are audited under root.
 */
export async function normalizeRuntimeLinks(directory) {
  if (typeof directory !== 'string' || !directory) throw invalid('RUNTIME_ROOT_INVALID', String(directory))
  const root = await realpath(resolve(directory))
  if (!(await lstat(root)).isDirectory()) throw invalid('RUNTIME_ROOT_INVALID', root)
  const changes = []

  async function audit(path) {
    const info = await lstat(path)
    if (info.isSymbolicLink()) {
      const target = await readlink(path)
      const absolute = isAbsolute(target)
      const lexical = resolve(dirname(path), lexicalPath(target))
      if (!contained(root, lexical)) throw invalid('RUNTIME_LINK_ESCAPE', path)
      let actual, targetInfo
      try {
        actual = await realpath(path)
        targetInfo = await stat(path)
      } catch (cause) {
        throw Object.assign(invalid('RUNTIME_LINK_UNRESOLVED', path), { cause })
      }
      if (!contained(root, actual)) throw invalid('RUNTIME_LINK_ESCAPE', path)
      if (!targetInfo.isDirectory() && !targetInfo.isFile()) throw invalid('RUNTIME_ENTRY_UNSUPPORTED', path)
      if (absolute) {
        changes.push({
          path,
          target,
          relativeTarget: relative(dirname(path), lexical) || '.',
          type: targetInfo.isDirectory() ? 'dir' : 'file',
        })
      }
    } else if (info.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await audit(join(path, name))
    } else if (!info.isFile()) throw invalid('RUNTIME_ENTRY_UNSUPPORTED', path)
  }

  // Complete the audit first so an escaping/dangling entry never leaves a
  // partially normalized runtime that a caller might accidentally publish.
  await audit(root)
  for (const change of changes) {
    if ((await readlink(change.path)) !== change.target) throw invalid('RUNTIME_LINK_CHANGED', change.path)
    if (!contained(root, await realpath(change.path))) throw invalid('RUNTIME_LINK_ESCAPE', change.path)
    const temporary = `${change.path}.relative-${randomUUID()}`
    const backup = `${change.path}.original-${randomUUID()}`
    // Explicit file/dir types produce relative symlinks on Windows. A junction
    // would silently resolve the relative target into an absolute machine path.
    await symlink(change.relativeTarget, temporary, change.type)
    let saved = false
    try {
      await rename(change.path, backup)
      saved = true
      await rename(temporary, change.path)
    } catch (cause) {
      if (saved) {
        try {
          await rename(backup, change.path)
          saved = false
        } catch (restoreError) {
          throw new AggregateError(
            [cause, restoreError],
            `Failed to restore runtime link; original remains at ${backup}`,
            { cause: restoreError },
          )
        }
      }
      throw cause
    } finally {
      await unlink(temporary).catch(error => {
        if (error.code !== 'ENOENT') throw error
      })
    }
    if (saved) await unlink(backup)
  }
  return { root, rewritten: changes.length }
}

/** Resolve a Node entry point for pnpm on Windows, where execFile cannot run a
 * .cmd shim. The caller appends fixed arguments to this argv without a shell.
 */
export async function resolvePnpmInvocation({
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
  pathEntries,
  isFile = async path =>
    stat(path).then(
      info => info.isFile(),
      () => false,
    ),
  resolvePackage = specifier => createRequire(import.meta.url).resolve(specifier),
} = {}) {
  const paths = platform === 'win32' ? win32 : posix
  const executableEntry = async entry =>
    typeof entry === 'string' &&
    paths.isAbsolute(entry) &&
    ['pnpm.mjs', 'pnpm.cjs', 'pnpm.js'].includes(paths.basename(entry).toLowerCase()) &&
    (await isFile(entry))
  const nodeInvocation = entry => ({ command: execPath, args: [entry] })

  if (await executableEntry(env.npm_execpath)) return nodeInvocation(env.npm_execpath)
  if (platform !== 'win32') return { command: 'pnpm', args: [] }

  try {
    const manifest = await resolvePackage('pnpm/package.json')
    if (typeof manifest === 'string' && paths.isAbsolute(manifest)) {
      for (const filename of ['pnpm.mjs', 'pnpm.cjs', 'pnpm.js']) {
        const entry = paths.join(paths.dirname(manifest), 'bin', filename)
        if (await executableEntry(entry)) return nodeInvocation(entry)
      }
    }
  } catch {
    // A globally installed CLI need not be resolvable from this project.
  }
  const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] ?? ''
  const locations = pathEntries ?? pathValue.split(paths.delimiter)
  const checked = new Set()
  for (const directory of locations) {
    if (typeof directory !== 'string' || !paths.isAbsolute(directory)) continue
    for (const relativeEntry of [
      'pnpm.mjs',
      'pnpm.cjs',
      'pnpm.js',
      'node_modules/pnpm/bin/pnpm.mjs',
      'node_modules/pnpm/bin/pnpm.cjs',
      'node_modules/corepack/dist/pnpm.js',
      '../pnpm/bin/pnpm.mjs',
      '../pnpm/bin/pnpm.cjs',
      '../../pnpm/bin/pnpm.mjs',
      '../../pnpm/bin/pnpm.cjs',
    ]) {
      const entry = paths.resolve(directory, relativeEntry)
      const key = entry.toLowerCase()
      if (checked.has(key)) continue
      checked.add(key)
      if (await executableEntry(entry)) return nodeInvocation(entry)
    }
  }
  throw invalid(
    'PNPM_CLI_NOT_FOUND',
    'Run staging with pnpm exec node so npm_execpath identifies the pnpm Node entry point',
  )
}
