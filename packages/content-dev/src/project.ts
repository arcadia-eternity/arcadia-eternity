import { cp, lstat, mkdir, readFile, realpath, readdir, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { WorkspaceError } from './workspace.ts'
import { siblingModulePath } from './module-path.ts'
import { errorCode } from './types.ts'
const require = createRequire(import.meta.url)
const moduleRoot = fileURLToPath(new URL('../', import.meta.url))
export function authorConnection(
  root: string,
  execute = false,
  env: NodeJS.ProcessEnv = process.env,
  readOnly = false,
  contextFile?: string,
  published = false,
) {
  return {
    mcpServers: {
      arcadia: {
        command: process.execPath,
        args: [
          siblingModulePath('mcp'),
          root,
          ...(readOnly ? ['--read-only'] : execute ? ['--execute'] : []),
          ...(contextFile ? ['--context-file', contextFile] : []),
          ...(published ? ['--published'] : []),
        ],
        env: {
          ELECTRON_RUN_AS_NODE: '1',
          ...(env.ARCADIA_NPM_CLI ? { ARCADIA_NPM_CLI: env.ARCADIA_NPM_CLI } : {}),
          ...(env.ARCADIA_PREVIEW_CLIENT_URL ? { ARCADIA_PREVIEW_CLIENT_URL: env.ARCADIA_PREVIEW_CLIENT_URL } : {}),
        },
      },
    },
  }
}
async function packageRoot(names: string | string[], entry: string): Promise<string> {
  if (!Array.isArray(names)) names = [names]
  let path = dirname(require.resolve(entry))
  for (;;) {
    try {
      if (names.includes(JSON.parse(await readFile(join(path, 'package.json'), 'utf8')).name)) return realpath(path)
    } catch {
      /* Walk to owning package. */
    }
    const parent = dirname(path)
    if (parent === path) throw new Error(`Cannot find SDK package ${names.join(' or ')}`)
    path = parent
  }
}
/** Connect bundled tools only when absent. Never replace a project's existing dependencies. */
export async function connectDevelopmentSdk(root: string) {
  root = await realpath(root)
  // Existing dependency directories must not redirect writes outside this project.
  async function directory(parts: string[]) {
    let current = root
    for (const part of parts) {
      current = join(current, part)
      try {
        await mkdir(current)
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error
      }
      const info = await lstat(current)
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new WorkspaceError('PATH_INVALID', 'SDK 目录必须是项目内普通目录', current)
    }
    return current
  }
  // Validate all parents before adding any links.
  await directory(['node_modules'])
  await directory(['node_modules', '@arcadia-eternity'])
  await directory(['node_modules', '.bin'])
  const packages = {
    '@arcadia-eternity/battle': await packageRoot('@arcadia-eternity/battle', '@arcadia-eternity/battle/engine'),
    '@arcadia-eternity/pack-loader': await packageRoot(
      '@arcadia-eternity/pack-loader',
      '@arcadia-eternity/pack-loader/node',
    ),
    '@arcadia-eternity/content-sdk': moduleRoot,
    typescript: await packageRoot(['typescript', 'typescript-native-bridge'], 'typescript'),
  }
  const linked = []
  for (const [name, source] of Object.entries(packages)) {
    const target = join(root, 'node_modules', name)
    await directory(['node_modules', ...name.split('/').slice(0, -1)])
    try {
      await lstat(target)
      continue
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') throw error
    }
    await symlink(source, target, process.platform === 'win32' ? 'junction' : 'dir')
    linked.push(name)
  }
  // npm scripts use the shared CLI, while the desktop invokes its absolute entry directly.
  const bin = join(root, 'node_modules/.bin')
  await directory(['node_modules', '.bin'])
  for (const [name, entry] of [
    ['arcadia-content', 'cli'],
    ['arcadia-content-mcp', 'mcp'],
  ]) {
    const script = siblingModulePath(entry)
    if (process.platform === 'win32')
      await writeFile(join(bin, name + '.cmd'), `@echo off\r\nnode "${script}" %*\r\n`, { flag: 'wx' }).catch(e => {
        if (errorCode(e) !== 'EEXIST') throw e
      })
    else
      await symlink(script, join(bin, name)).catch(e => {
        if (errorCode(e) !== 'EEXIST') throw e
      })
  }
  return { linked }
}
export async function createSourceProject(directory: string, identity: string) {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(identity)) throw new WorkspaceError('PROJECT_INVALID', '项目 ID 无效')
  await mkdir(directory) // No overwrite or merge with existing directories.
  let template = fileURLToPath(new URL('./template/', import.meta.url))
  try {
    await lstat(template)
  } catch {
    template = fileURLToPath(new URL('../template/', import.meta.url))
  }
  for (const entry of await readdir(template))
    await cp(join(template, entry), join(directory, entry), { recursive: true, force: false, errorOnExist: true })
  async function renameText(root: string) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const file = join(root, entry.name)
      if (entry.isDirectory()) await renameText(file)
      else if (/\.(json|ya?ml|mjs|ts|md)$/.test(entry.name)) {
        const text = await readFile(file, 'utf8')
        await writeFile(file, text.replaceAll('example-content-pack', identity).replaceAll('example-pack', identity))
      }
    }
  }
  await renameText(directory)
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as Record<string, unknown>
  manifest.name = `@arcadia-local/${identity}`
  await writeFile(join(directory, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  await connectDevelopmentSdk(directory)
  return directory
}
