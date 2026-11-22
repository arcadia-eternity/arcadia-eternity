// Copied next to arcadia and arcadia-content in the installed runtime. Uses only the embedded Node standard library.
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const entry = fileURLToPath(import.meta.url)
const windows = process.platform === 'win32'
const header = windows
  ? '@echo off\r\n@rem Arcadia Eternity desktop CLI\r\n'
  : '#!/bin/sh\n# Arcadia Eternity desktop CLI\n'
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'"
const batchQuote = value => '"' + value.replaceAll('%', '%%') + '"'

const entryNames = { arcadia: 'desktop-root-cli.mjs', 'arcadia-content': 'desktop-author-cli.mjs' }

function userShim(command) {
  const target = join(dirname(entry), entryNames[command])
  if (windows)
    return (
      header +
      'setlocal DisableDelayedExpansion\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n' +
      batchQuote(process.execPath) +
      ' ' +
      batchQuote(target) +
      ' %*\r\nexit /b %errorlevel%\r\n'
    )
  let invocation = shellQuote(process.execPath) + ' ' + shellQuote(target)
  if (
    process.env.APPDIR &&
    resolve(process.env.APPDIR, 'resources/arcadia-server/bin/desktop-author-cli.mjs') === entry
  ) {
    const image = process.env.APPIMAGE
    if (!image || !isAbsolute(image))
      throw new Error('Cannot register a persistent command without the original AppImage path')
    // A new AppImage launch mounts at a new APPDIR. Locate the SDK inside that launch.
    const load =
      'const p=require("node:path").join(process.env.APPDIR,"resources/arcadia-server/bin/' +
      entryNames[command] +
      '");process.argv.splice(1,0,p);import(require("node:url").pathToFileURL(p).href).catch(e=>{console.error(e);process.exitCode=1})'
    invocation = shellQuote(image) + ' -e ' + shellQuote(load) + ' --'
  } else if (process.platform === 'linux' && /\/\.mount_[^/]+\//.test(entry)) {
    // A terminal outside a running AppImage's mount does not inherit its APPDIR/APPIMAGE.
    throw new Error('Register the terminal command from the running Arcadia AppImage')
  }
  return header + 'export ELECTRON_RUN_AS_NODE=1\nexec ' + invocation + ' "$@"\n'
}

/** Explicit user action only. Registration never modifies shell startup files or the user/system PATH. */
export async function registerDesktopUserCommand({ binDirectory } = {}) {
  if (binDirectory !== undefined && (typeof binDirectory !== 'string' || !isAbsolute(binDirectory)))
    throw new Error('Specify an absolute directory for the terminal command')
  const home = homedir()
  const candidates = windows
    ? [
        join(process.env.LOCALAPPDATA || join(home, 'AppData/Local'), 'Arcadia Eternity/bin'),
        join(process.env.APPDATA || join(home, 'AppData/Roaming'), 'npm'),
      ]
    : [join(home, '.local/bin'), join(home, 'bin')]
  const key = value => (windows ? resolve(value).toLowerCase() : resolve(value))
  const paths = new Set(
    (process.env.PATH ?? '')
      .split(delimiter)
      .map(dir => dir.replace(/^"(.*)"$/, '$1'))
      .filter(isAbsolute)
      .map(key),
  )
  const pathDirectory = resolve(binDirectory ?? candidates.find(dir => paths.has(key(dir))) ?? candidates[0])
  if (key(pathDirectory) === key(dirname(entry)))
    throw new Error('Choose a user command directory outside the installed application')
  const commandPaths = Object.fromEntries(
    Object.keys(entryNames).map(name => [name, join(pathDirectory, name + (windows ? '.cmd' : ''))]),
  )
  await mkdir(pathDirectory, { recursive: true, mode: 0o755 })
  const staging = await mkdtemp(join(pathDirectory, '.arcadia-cli-register-' + process.pid + '-'))
  const changes = []
  const committed = []
  try {
    // Concurrent registrations from different installed versions must not interleave their two commands.
    const entries = await readdir(pathDirectory)
    if (windows) {
      // cmd and PowerShell can resolve another executable extension before our .cmd shim.
      const extensions = new Set([
        '.exe',
        '.com',
        '.bat',
        '.ps1',
        ...(process.env.PATHEXT ?? '').toLowerCase().split(';'),
      ])
      extensions.delete('.cmd')
      extensions.delete('')
      const occupied = new Set(entries.map(value => value.toLowerCase()))
      for (const name of Object.keys(commandPaths)) {
        for (const ext of extensions) {
          if (occupied.has(name + ext))
            throw new Error('A different terminal command already exists at ' + join(pathDirectory, name + ext))
        }
      }
    }
    for (const name of entries) {
      const match = /^\.arcadia-cli-register-(\d+)-[a-zA-Z0-9]+$/.exec(name)
      if (!match || name === basename(staging)) continue
      try {
        process.kill(Number(match[1]), 0)
      } catch (error) {
        if (error.code === 'ESRCH') continue
        if (error.code !== 'EPERM') throw error
      }
      throw new Error('Another terminal command registration is in progress. Please retry.')
    }
    // Validate and stage both names before publishing either. An existing npm symlink or non-owned file is a conflict.
    for (const [name, path] of Object.entries(commandPaths)) {
      const script = userShim(name)
      const previous = await installedShim(path)
      if (previous === script) continue
      const next = join(staging, name)
      const backup = join(staging, name + '.previous')
      await writeFile(next, script, { mode: 0o755, flag: 'wx' })
      if (previous !== undefined) await copyFile(path, backup, constants.COPYFILE_EXCL)
      changes.push({ path, next, script, previous, backup })
    }
    for (const change of changes) {
      if (change.previous === undefined) await copyFile(change.next, change.path, constants.COPYFILE_EXCL)
      else {
        if ((await installedShim(change.path)) !== change.previous)
          throw new Error('Terminal command changed during registration: ' + change.path)
        await rename(change.next, change.path)
      }
      committed.push(change)
    }
    return {
      commandPath: commandPaths['arcadia-content'],
      commandPaths,
      pathDirectory,
      onPath: paths.has(key(pathDirectory)),
    }
  } catch (error) {
    for (const change of committed.reverse()) {
      // Keep any intervening user edit. Only undo the exact shim we just wrote.
      if ((await installedShim(change.path).catch(() => undefined)) !== change.script) continue
      if (change.previous === undefined) await rm(change.path)
      else await rename(change.backup, change.path)
    }
    throw error
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

async function installedShim(path) {
  const existing = await lstat(path).catch(error => {
    if (error.code !== 'ENOENT') throw error
  })
  if (!existing) return undefined
  const previous = existing.isFile() && existing.size < 65536 ? await readFile(path, 'utf8') : ''
  if (!previous.startsWith(header)) throw new Error('A different terminal command already exists at ' + path)
  return previous
}

export async function runDesktopCli(name) {
  try {
    const [command, ...args] = process.argv.slice(2)
    if (command === '--install-user-command') {
      if (args.length > 1) throw new Error('Usage: ' + name + ' --install-user-command [absolute-bin-directory]')
      console.log(JSON.stringify(await registerDesktopUserCommand({ binDirectory: args[0] })))
    } else {
      const runtime = resolve(dirname(entry), '..')
      process.env.ARCADIA_NPM_CLI = join(runtime, 'runtime/npm/bin/npm-cli.js')
      const cli =
        name === 'arcadia'
          ? join(runtime, 'cli.js')
          : join(runtime, 'node_modules/@arcadia-eternity/content-sdk/bin/arcadia-content.mjs')
      process.argv[1] = cli
      await import(pathToFileURL(cli).href)
      if (!command || command === '--help' || command === '-h')
        console.log(
          '  --install-user-command [absolute-bin-directory]  Register both desktop terminal commands for your user',
        )
    }
  } catch (error) {
    console.error(error.message ?? String(error))
    process.exitCode = 1
  }
}

if (import.meta.main || (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url))
  await runDesktopCli('arcadia-content')
