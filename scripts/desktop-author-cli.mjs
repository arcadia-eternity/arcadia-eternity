// Copied next to arcadia-content in the installed runtime. Uses only the embedded Node standard library.
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const entry = fileURLToPath(import.meta.url)
const windows = process.platform === 'win32'
const header = windows
  ? '@echo off\r\n@rem Arcadia Eternity desktop CLI\r\n'
  : '#!/bin/sh\n# Arcadia Eternity desktop CLI\n'
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'"
const batchQuote = value => '"' + value.replaceAll('%', '%%') + '"'

function userShim() {
  if (windows)
    return (
      header +
      'setlocal DisableDelayedExpansion\r\nset "ELECTRON_RUN_AS_NODE=1"\r\n' +
      batchQuote(process.execPath) +
      ' ' +
      batchQuote(entry) +
      ' %*\r\nexit /b %errorlevel%\r\n'
    )
  let invocation = shellQuote(process.execPath) + ' ' + shellQuote(entry)
  if (
    process.env.APPDIR &&
    resolve(process.env.APPDIR, 'resources/arcadia-server/bin/desktop-author-cli.mjs') === entry
  ) {
    const image = process.env.APPIMAGE
    if (!image || !isAbsolute(image))
      throw new Error('Cannot register a persistent command without the original AppImage path')
    // A new AppImage launch mounts at a new APPDIR. Locate the SDK inside that launch.
    const load =
      'const p=require("node:path").join(process.env.APPDIR,"resources/arcadia-server/bin/desktop-author-cli.mjs");process.argv.splice(1,0,p);import(require("node:url").pathToFileURL(p).href).catch(e=>{console.error(e);process.exitCode=1})'
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
  const commandPath = join(pathDirectory, windows ? 'arcadia-content.cmd' : 'arcadia-content')
  if (commandPath === join(dirname(entry), windows ? 'arcadia-content.cmd' : 'arcadia-content'))
    throw new Error('Choose a user command directory outside the installed application')
  const result = { commandPath, pathDirectory, onPath: paths.has(key(pathDirectory)) }
  const script = userShim()
  await mkdir(pathDirectory, { recursive: true, mode: 0o755 })
  const staging = await mkdtemp(join(pathDirectory, '.arcadia-cli-'))
  const temporary = join(staging, 'launcher')
  try {
    await writeFile(temporary, script, { mode: 0o755, flag: 'wx' })
    try {
      await copyFile(temporary, commandPath, constants.COPYFILE_EXCL)
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      // Never replace another CLI, including npm symlinks, if the SDK is already installed.
      const existing = await lstat(commandPath)
      const previous = existing.isFile() && existing.size < 65536 ? await readFile(commandPath, 'utf8') : ''
      if (!previous.startsWith(header)) throw new Error('A different terminal command already exists at ' + commandPath)
      if (previous !== script) await rename(temporary, commandPath)
    }
    return result
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

if (import.meta.main || (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2)
    if (command === '--install-user-command') {
      if (args.length > 1) throw new Error('Usage: arcadia-content --install-user-command [absolute-bin-directory]')
      console.log(JSON.stringify(await registerDesktopUserCommand({ binDirectory: args[0] })))
    } else {
      const runtime = resolve(dirname(entry), '..')
      process.env.ARCADIA_NPM_CLI = join(runtime, 'runtime/npm/bin/npm-cli.js')
      const sdk = join(runtime, 'node_modules/@arcadia-eternity/content-sdk/bin/arcadia-content.mjs')
      process.argv[1] = sdk
      await import(pathToFileURL(sdk).href)
      if (!command || command === '--help' || command === '-h')
        console.log('  --install-user-command [absolute-bin-directory]  Register this desktop CLI for your user')
    }
  } catch (error) {
    console.error(error.message ?? String(error))
    process.exitCode = 1
  }
}
