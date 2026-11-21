import { cp, lstat, mkdir, mkdtemp, rm, readFile, realpath, readdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { ManagedProjects } from './managed-projects.ts'
import type { AuthorWorkspace } from './workspace.ts'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { WorkspaceError, normalizeArcadiaRange } from './workspace.ts'
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

async function templateDirectory(): Promise<string> {
  const bundled = fileURLToPath(new URL('./template/', import.meta.url))
  try {
    await lstat(bundled)
    return bundled
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
    return fileURLToPath(new URL('../template/', import.meta.url))
  }
}

export async function copyAuthorSkill(directory: string) {
  const name = 'arcadia-content-authoring'
  let source = join(await templateDirectory(), 'skills', name)
  try {
    await lstat(source)
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
    source = fileURLToPath(new URL('../../../docs/guides/ugc-authoring-agent/', import.meta.url))
  }
  await mkdir(join(directory, 'skills'), { recursive: true })
  await cp(source, join(directory, 'skills', name), { recursive: true })
}

export async function createSourceProject(
  directory: string,
  identity: string,
  arcadiaRange: string = '^' + require('../package.json').version,
) {
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(identity)) throw new WorkspaceError('PROJECT_INVALID', '项目 ID 无效')
  const range = normalizeArcadiaRange(arcadiaRange)
  await mkdir(directory) // No overwrite or merge with existing directories.
  const template = await templateDirectory()
  for (const entry of await readdir(template))
    await cp(
      join(template, entry),
      join(
        directory,
        entry === 'gitignore-template'
          ? '.gitignore'
          : entry === 'npm-lock-template.json'
            ? 'package-lock.json'
            : entry,
      ),
      {
        recursive: true,
        force: false,
        errorOnExist: true,
      },
    )
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
  await copyAuthorSkill(directory)
  for (const script of ['release-payload.mjs', 'release-test-npm.mjs'])
    await cp(fileURLToPath(new URL('../' + script, import.meta.url)), join(directory, '.github/scripts', script))
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
  if (range) manifest.engines.arcadia = range
  else delete manifest.engines.arcadia
  manifest.name = `@arcadia-local/${identity}`
  await writeFile(join(directory, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  const lockPath = join(directory, 'package-lock.json')
  const lock = JSON.parse(await readFile(lockPath, 'utf8'))
  lock.name = lock.packages[''].name = manifest.name
  lock.packages[''].engines = manifest.engines
  await writeFile(lockPath, JSON.stringify(lock, null, 2) + '\n')
  await connectDevelopmentSdk(directory)
  return directory
}

export async function updateAuthorLock(workspace: AuthorWorkspace) {
  await workspace.assertWritable()
  const manifest = await workspace.read('package.json')
  const previous = await workspace.read('package-lock.json').catch(error => {
    if (errorCode(error) !== 'ENOENT') throw error
    return undefined
  })
  const root = await mkdtemp(join(tmpdir(), 'arcadia-author-lock-'))
  const installer = new ManagedProjects(root)
  try {
    const text = await installer.authorLock(JSON.parse(manifest.text), previous?.text)
    if ((await workspace.read('package.json')).version !== manifest.version)
      throw new WorkspaceError('REVISION_CONFLICT', '生成锁文件期间包声明已改变，请重试')
    await workspace.write({ file: 'package-lock.json', expectedVersion: previous?.version ?? null, text })
  } finally {
    await installer.close()
    await rm(root, { recursive: true, force: true })
  }
}
