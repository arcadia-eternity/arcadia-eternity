import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { acquireAuthorEnvironment, parseAuthorEnvironmentSource } from './author-environment-source.ts'
import { environmentManifestDocument } from './debug-environments.ts'
import { installAuthorDependencies } from './author-install.ts'
import { copyAuthorSkill } from './project.ts'
import { withSourceLock } from './source-lock.ts'
import { errorCode, isRecord } from './types.ts'
import { AuthorWorkspace } from './workspace.ts'
import { contentError, readJson } from './workspace-materials.ts'

export function parseAuthorEnvironmentInstall(input: unknown) {
  if (!isRecord(input) || (input.offline !== undefined && typeof input.offline !== 'boolean'))
    throw contentError('ENVIRONMENT_INSTALL_INVALID')
  return { source: parseAuthorEnvironmentSource(input.source), offline: input.offline }
}

async function directory(parent: string, name: string) {
  const path = join(parent, name)
  await mkdir(path, { mode: 0o700 }).catch(error => {
    if (errorCode(error) !== 'EEXIST') throw error
  })
  if (!(await lstat(path)).isDirectory() || (await realpath(path)) !== path) throw contentError('MATERIAL_PATH_ESCAPE')
  return path
}

async function projectArchive(root: string, file: string) {
  if (
    isAbsolute(file) ||
    /[\\:\p{Cc}]/u.test(file) ||
    file.split('/').some(part => !part || part.startsWith('.') || part.toLowerCase() === 'node_modules')
  )
    throw contentError('MATERIAL_PATH_ESCAPE', '环境包归档必须是当前项目内的 .tgz 文件')
  const path = join(root, file)
  if ((await realpath(path)) !== path) throw contentError('MATERIAL_PATH_ESCAPE')
  return path
}

async function alreadyInstalled(path: string, integrity: string) {
  const info = await lstat(path).catch(error => {
    if (errorCode(error) !== 'ENOENT') throw error
  })
  if (!info) return false
  if (!info.isDirectory() || (await realpath(path)) !== path) throw contentError('MATERIAL_PATH_ESCAPE')
  const marker = join(path, '.arcadia', 'environment-source.json')
  if ((await realpath(marker)) !== marker) throw contentError('ENVIRONMENT_INSTALL_CONFLICT')
  const saved = await readJson(marker, 4096)
  if (!isRecord(saved) || saved.integrity !== integrity) throw contentError('ENVIRONMENT_INSTALL_CONFLICT')
  const manifest = await readJson(join(path, 'package.json'))
  if (manifest.arcadia) throw contentError('ENVIRONMENT_INSTALL_CONFLICT')
  environmentManifestDocument(manifest)
  return true
}

/** Each distinct archive owns an editable project. A repeated import preserves its author's edits. */
export async function installAuthorEnvironment(workspace: AuthorWorkspace, input: unknown, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const { source, offline } = parseAuthorEnvironmentInstall(input)
  await workspace.assertWritable()
  const capture =
    source.kind === 'archive' ? { ...source, file: await projectArchive(workspace.root, source.file) } : source
  const owner = await directory(workspace.root, '.arcadia')
  const projects = await directory(owner, 'installed-environments')
  const cache =
    source.kind === 'npm'
      ? (process.env.npm_config_cache ?? (await directory(owner, 'environment-registry-cache')))
      : undefined
  const staging = await mkdtemp(join(projects, '.install-'))
  try {
    const acquired = await acquireAuthorEnvironment(capture, join(staging, 'project'), { offline, signal, cache })
    const { name, version, integrity, document } = acquired
    const path = join(projects, createHash('sha256').update(integrity).digest('hex'))
    const result = { directory: path, name, version, integrity, id: document.id }
    if (await alreadyInstalled(path, integrity)) return { ...result, reused: true }
    await copyAuthorSkill(acquired.directory)
    await writeFile(join(acquired.directory, '.gitignore'), 'node_modules/\n.arcadia/\n/*.tgz\n')
    const project = await AuthorWorkspace.open(acquired.directory, { watch: false })
    try {
      const manifest = await project.read('package.json')
      await installAuthorDependencies(project, { expectedVersion: manifest.version, offline, signal })
      const metadata = await directory(project.root, '.arcadia')
      await writeFile(join(metadata, 'environment-source.json'), JSON.stringify({ name, version, integrity }) + '\n', {
        flag: 'wx',
      })
    } finally {
      await project.close()
    }
    const reused = await withSourceLock(workspace.root, 'environment-install', async () => {
      await workspace.assertWritable()
      if (await alreadyInstalled(path, integrity)) return true
      signal?.throwIfAborted()
      await rename(acquired.directory, path)
      return false
    })
    return { ...result, reused }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
