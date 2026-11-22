// Copied next to arcadia and arcadia-content in the installed runtime. Uses only the embedded Node standard library.
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const entry = fileURLToPath(import.meta.url)
const windows = process.platform === 'win32'
const header = windows
  ? '@echo off\r\n@rem Arcadia Eternity desktop CLI\r\n'
  : '#!/bin/sh\n# Arcadia Eternity desktop CLI\n'
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'"
const batchQuote = value => '"' + value.replaceAll('%', '%%') + '"'

const entryNames = { arcadia: 'desktop-root-cli.mjs', 'arcadia-content': 'desktop-author-cli.mjs' }

const commandPathsIn = directory =>
  Object.fromEntries(Object.keys(entryNames).map(name => [name, join(directory, name + (windows ? '.cmd' : ''))]))
const pathKey = value => (windows ? resolve(value).toLowerCase() : resolve(value))
const privateInstallations = new Map()

function mountedImageDirectory() {
  if (
    !windows &&
    process.env.APPDIR &&
    resolve(process.env.APPDIR, 'resources/arcadia-server/bin/desktop-author-cli.mjs') === entry
  )
    return resolve(process.env.APPDIR)
  if (process.platform === 'linux' && /\/\.mount_[^/]+\//.test(entry))
    throw new Error('Open the running Arcadia AppImage to obtain permanent terminal command paths')
}

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
  if (mountedImageDirectory()) {
    const image = process.env.APPIMAGE
    if (!image || !isAbsolute(image))
      throw new Error('Cannot register a persistent command without the original AppImage path')
    // AppRun can prepend Chromium's --no-sandbox when user namespaces are unavailable.
    // Pass the marker after Node's option terminator and consume it here before invoking the CLI.
    // The original image will mount at a new APPDIR on each launch.
    const load =
      'const p=require("node:path").join(process.env.APPDIR,"resources/arcadia-server/bin/' +
      entryNames[command] +
      '");process.argv.splice(1,1,p);import(require("node:url").pathToFileURL(p).href).catch(e=>{console.error(e);process.exitCode=1})'
    invocation = shellQuote(image) + ' -e ' + shellQuote(load) + ' -- --no-sandbox'
    // Builder's AppRun uses /usr/bin/env bash, even when shell tools run with an empty PATH.
    return (
      header +
      'export ELECTRON_RUN_AS_NODE=1\ncommand -v bash >/dev/null 2>&1 || export PATH="${PATH:+$PATH:}/usr/bin:/bin"\nexec ' +
      invocation +
      ' "$@"\n'
    )
  }
  return header + 'export ELECTRON_RUN_AS_NODE=1\nexec ' + invocation + ' "$@"\n'
}

// macOS, Windows and unpacked Linux launchers are already at permanent paths. Only an AppImage
// needs private wrappers, because its resource directory disappears when it unmounts.
export async function getDesktopCommandPaths(privateBinDirectory) {
  const imageDirectory = mountedImageDirectory()
  const shell = windows ? 'powershell' : 'posix'
  if (!imageDirectory) return { commandPaths: commandPathsIn(dirname(entry)), shell }
  if (typeof privateBinDirectory !== 'string' || !isAbsolute(privateBinDirectory))
    throw new Error('An absolute private command directory is required for the AppImage')
  const directory = resolve(privateBinDirectory)
  const inside = relative(imageDirectory, directory)
  if (
    (!isAbsolute(inside) && inside !== '..' && !inside.startsWith('..' + sep)) ||
    directory === join(homedir(), '.local/bin')
  )
    throw new Error('Use a private application data directory outside the mounted AppImage')
  let pending = privateInstallations.get(directory)
  if (!pending) {
    pending = installDesktopShims(directory, 0o700).finally(() => privateInstallations.delete(directory))
    privateInstallations.set(directory, pending)
  }
  return { commandPaths: await pending, shell }
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
  const paths = new Set(
    (process.env.PATH ?? '')
      .split(delimiter)
      .map(dir => dir.replace(/^"(.*)"$/, '$1'))
      .filter(isAbsolute)
      .map(pathKey),
  )
  const pathDirectory = resolve(binDirectory ?? candidates.find(dir => paths.has(pathKey(dir))) ?? candidates[0])
  const commandPaths = await installDesktopShims(pathDirectory, 0o755)
  return {
    commandPath: commandPaths['arcadia-content'],
    commandPaths,
    pathDirectory,
    onPath: paths.has(pathKey(pathDirectory)),
  }
}

async function installDesktopShims(pathDirectory, mode) {
  if (pathKey(pathDirectory) === pathKey(dirname(entry)))
    throw new Error('Choose a user command directory outside the installed application')
  const commandPaths = commandPathsIn(pathDirectory)
  await mkdir(pathDirectory, { recursive: true, mode })
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
    return commandPaths
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
