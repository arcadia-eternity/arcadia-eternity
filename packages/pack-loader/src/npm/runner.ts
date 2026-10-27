import { access, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import { isAbsolute, win32 } from 'node:path'
import { fail } from '../works/model'

/** An npm invocation is passed directly to execFile; arguments are never interpreted by a shell. */
export function npmInvocation(
  args: readonly string[],
  options: { cli?: string; executable?: string; platform?: NodeJS.Platform } = {},
): { file: string; args: string[] } {
  const cli = options.cli ?? process.env.ARCADIA_NPM_CLI
  const platform = options.platform ?? process.platform
  const executable = options.executable ?? process.execPath
  // On Windows execFile cannot directly run npm.cmd without a shell. Standard Node installations
  // place npm's JS entry beside node.exe, which can be launched directly without shell parsing.
  if (cli === undefined) {
    if (platform !== 'win32') return { file: 'npm', args: [...args] }
    return {
      file: executable,
      args: [win32.join(win32.dirname(executable), 'node_modules/npm/bin/npm-cli.js'), ...args],
    }
  }
  const absolute = platform === 'win32' ? win32.isAbsolute(cli) : isAbsolute(cli)
  if (!absolute || cli.includes('\0'))
    fail('NPM_RUNTIME_INVALID', 'ARCADIA_NPM_CLI', 'The bundled npm CLI must be an absolute file path')
  return { file: executable, args: [cli, ...args] }
}

/** A bundled host must fail closed if its configured npm entry is missing or unreadable. */
export async function resolveNpmInvocation(args: readonly string[]): Promise<{ file: string; args: string[] }> {
  const invocation = npmInvocation(args)
  if (process.env.ARCADIA_NPM_CLI !== undefined || process.platform === 'win32') {
    try {
      if (!(await stat(invocation.args[0])).isFile()) throw new Error('not a file')
      await access(invocation.args[0], constants.R_OK)
    } catch {
      fail(
        'NPM_RUNTIME_INVALID',
        process.env.ARCADIA_NPM_CLI !== undefined ? 'ARCADIA_NPM_CLI' : 'npm',
        process.env.ARCADIA_NPM_CLI !== undefined
          ? 'The bundled npm CLI file is missing or unreadable'
          : 'Windows npm CLI is missing or unreadable beside the current Node runtime',
      )
    }
  }
  return invocation
}
