import { chmod, copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

/** The executable name is chosen by Builder (including preview product names). Store only its relative path. */
export async function writeDesktopCliLauncher({ executable, runtime, platform }) {
  const bin = resolve(runtime, 'bin')
  await mkdir(bin, { recursive: true })
  await copyFile(new URL('./desktop-author-cli.mjs', import.meta.url), join(bin, 'desktop-author-cli.mjs'))
  await writeFile(
    join(bin, 'desktop-root-cli.mjs'),
    "import { runDesktopCli } from './desktop-author-cli.mjs'\nawait runDesktopCli('arcadia')\n",
  )
  const windows = platform === 'win32'
  const host = relative(bin, executable)
  for (const [command, entry] of [
    ['arcadia', 'desktop-root-cli.mjs'],
    ['arcadia-content', 'desktop-author-cli.mjs'],
  ]) {
    const file = join(bin, command + (windows ? '.cmd' : ''))
    const source = windows
      ? [
          '@echo off',
          'setlocal DisableDelayedExpansion',
          'set "ELECTRON_RUN_AS_NODE=1"',
          '"%~dp0' + host.replaceAll('%', '%%') + '" "%~dp0' + entry + '" %*',
          'exit /b %errorlevel%',
          '',
        ].join('\r\n')
      : [
          '#!/bin/sh',
          'bin=$(CDPATH= cd -P -- "${0%/*}" && pwd -P) || exit 1',
          'export ELECTRON_RUN_AS_NODE=1',
          'exec "$bin"/\'' + host.replaceAll("'", "'\\''") + '\' "$bin/' + entry + '" "$@"',
          '',
        ].join('\n')
    await writeFile(file, source)
    if (!windows) await chmod(file, 0o755)
  }
  return join(bin, windows ? 'arcadia-content.cmd' : 'arcadia-content')
}
