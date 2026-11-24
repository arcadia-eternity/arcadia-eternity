import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import { copyFile, cp, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, basename, relative, isAbsolute, resolve, sep } from 'node:path'
import type { AuthorChangeEvent } from './author-preview-events.ts'

export type AuthorApi = typeof import('@arcadia-eternity/content-sdk/workspace')
export type AuthorSession = Awaited<ReturnType<AuthorApi['openAuthorSession']>>
export type AuthorJob = ReturnType<AuthorSession['jobs']['get']>

type GitResult = Awaited<ReturnType<AuthorApi['authorGit']>>
type GitStatus = Extract<GitResult, { hasRemote: boolean }> | { repository: false; hasRemote?: false }
type GitInput = Record<string, unknown> & { operation: string }
type GitTokenProvider = Parameters<AuthorApi['cloneAuthorRepository']>[3]
export type AuthorGitHubTarget = Extract<GitResult, { repository: string }>
export type VerifiedAuthorGitHubTarget = AuthorGitHubTarget & { head: string; integrity: string }

interface AuthorProjectEntry {
  id: string
  directory: string
  name: string
  readOnly: boolean
  published?: boolean
}

interface AuthorWorkspaceOptions {
  root: string
  api: () => Promise<AuthorApi>
  installedPackage?: (id: string) => Promise<AuthorProjectEntry>
  notify?: (event: AuthorChangeEvent) => void
  env?: NodeJS.ProcessEnv
}

/** Local source projects are separate from installed packages and multiplayer server projects. */
export class AuthorWorkspaces {
  declare readonly root: string
  declare readonly api: AuthorWorkspaceOptions['api']
  declare readonly installedPackage: AuthorWorkspaceOptions['installedPackage']
  declare readonly notify: NonNullable<AuthorWorkspaceOptions['notify']>
  declare readonly env: NodeJS.ProcessEnv
  #entries?: AuthorProjectEntry[]
  #loading?: Promise<void>
  #sessions = new Map<string, Promise<AuthorSession>>()
  #transfers = new Map<string, AbortController>()
  #queue: Promise<unknown> = Promise.resolve()
  #contextQueue = Promise.resolve()
  constructor({ root, api, installedPackage, notify = () => {}, env = process.env }: AuthorWorkspaceOptions) {
    Object.assign(this, { root, api, installedPackage, notify, env })
  }
  async list() {
    if (!this.#entries) {
      this.#loading ??= (async () => {
        let entries: AuthorProjectEntry[]
        try {
          entries = JSON.parse(await readFile(join(this.root, 'state/projects.json'), 'utf8'))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
          entries = []
        }
        if (
          !Array.isArray(entries) ||
          entries.some(
            entry =>
              !entry ||
              typeof entry.id !== 'string' ||
              typeof entry.directory !== 'string' ||
              typeof entry.name !== 'string' ||
              typeof entry.readOnly !== 'boolean' ||
              (entry.published !== undefined && typeof entry.published !== 'boolean'),
          )
        )
          throw new Error('源项目登记格式无效，请恢复备份')
        // Source registrations written before published-package browsing have no published flag.
        if (entries.some(entry => entry.published !== false))
          await this.#save(entries.filter(entry => !entry.published).map(entry => ({ ...entry, published: false })))
        else this.#entries = entries
      })().catch(error => {
        this.#loading = undefined
        throw error
      })
      await this.#loading
    }
    return structuredClone(this.#entries!)
  }
  async #mutate<T>(action: () => T | PromiseLike<T>) {
    const next = this.#queue.catch(() => {}).then(action)
    this.#queue = next
    return next
  }
  async #save(entries: AuthorProjectEntry[]) {
    const file = join(this.root, 'state/projects.json')
    await mkdir(dirname(file), { recursive: true })
    const temp = `${file}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, JSON.stringify(entries, null, 2))
      await rename(temp, file)
      this.#entries = entries
    } finally {
      await rm(temp, { force: true })
    }
  }
  async add(directory: string, { readOnly = false } = {}) {
    return this.#mutate(async () => {
      const entries = await this.list(),
        root = await realpath(directory)
      const existing = entries.find(entry => entry.directory === root)
      if (existing) {
        if (readOnly && !existing.readOnly) {
          await this.release(existing.id)
          existing.readOnly = true
          await this.#save(entries)
        }
        return existing
      }
      const { openAuthorSession } = await this.api()
      const probe = await openAuthorSession(root, { watch: false, readOnly })
      let description
      try {
        description = await probe.describe()
      } finally {
        await probe.close()
      }
      const entry = {
        id: randomUUID(),
        directory: root,
        name: description.name || basename(root),
        readOnly: !description.capabilities.sourceEditing,
        published: false,
      }
      await this.#save([...entries, entry])
      return entry
    })
  }
  async previewEnvironment(id: string, environmentId?: string): Promise<string> {
    if (!(await this.list()).some(entry => entry.id === id)) throw new Error('源项目不存在')
    const file = join(this.root, 'state', `preview-environment-${id}.json`)
    return this.#mutate(async () => {
      if (environmentId === undefined) {
        try {
          return JSON.parse(await readFile(file, 'utf8')).environmentId
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'default'
          throw error
        }
      }
      if (typeof environmentId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,79}$/.test(environmentId))
        throw new Error('环境标识无效')
      await mkdir(dirname(file), { recursive: true })
      const temporary = `${file}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, JSON.stringify({ environmentId }))
        await rename(temporary, file)
      } finally {
        await rm(temporary, { force: true })
      }
      return environmentId
    })
  }
  async debugEnvironments(id: string, action: string, input: unknown) {
    const session = await this.session(id)
    if (action === 'list') return session.environments.list()
    if (action === 'save')
      return session.environments.save(input as Parameters<AuthorSession['environments']['save']>[0])
    throw new Error('不支持的环境操作')
  }
  async mapDebugSource(id: string, directory: string) {
    const session = await this.session(id)
    await session.workspace.assertWritable()
    const root = await realpath(directory)
    const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    if (!manifest.arcadia?.projectId || typeof manifest.name !== 'string') throw new Error('请选择 npm 内容包源项目')
    const file = join(session.workspace.root, '.arcadia/debug-sources.json')
    try {
      const info = await lstat(dirname(file))
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('本机源码映射目录必须是普通目录')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    return this.#mutate(async () => {
      let mappings: Record<string, string> = {}
      try {
        mappings = JSON.parse(await readFile(file, 'utf8'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      const changed = mappings[manifest.name] !== root
      mappings[manifest.name] = root
      await mkdir(dirname(file), { recursive: true })
      const info = await lstat(dirname(file))
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('本机源码映射目录必须是普通目录')
      await writeFile(join(dirname(file), '.gitignore'), '*\n', { flag: 'wx' }).catch(error => {
        if (error.code !== 'EEXIST') throw error
      })
      const temporary = `${file}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, JSON.stringify(mappings, null, 2))
        await rename(temporary, file)
      } finally {
        await rm(temporary, { force: true })
      }
      return { name: manifest.name, changed }
    })
  }
  // Drafts live in the application profile, independently of disposable candidate Sessions.
  async teamLibrary(id: string, action: string, input: unknown = {}) {
    const session = await this.session(id)
    if (action === 'list') return session.teams.list()
    if (action === 'save') return session.teams.save(input as Parameters<AuthorSession['teams']['save']>[0])
    if (action === 'remove') return session.teams.remove(input as Parameters<AuthorSession['teams']['remove']>[0])
    const file = join(this.root, 'state', `teams-${id}.json`)
    if (action === 'draft-read') {
      return this.#mutate(async () => {
        try {
          return JSON.parse(await readFile(file, 'utf8'))
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
          throw error
        }
      })
    }
    if (action === 'draft-write') {
      if (
        !input ||
        (input as { schemaVersion?: unknown }).schemaVersion !== 1 ||
        Buffer.byteLength(JSON.stringify(input)) > 2 * 1024 * 1024
      )
        throw new Error('测试编队草稿无效或过大')
      return this.#mutate(async () => {
        await mkdir(dirname(file), { recursive: true })
        const temporary = `${file}.${randomUUID()}.tmp`
        try {
          await writeFile(temporary, JSON.stringify(input))
          await rename(temporary, file)
        } finally {
          await rm(temporary, { force: true })
        }
      })
    }
    throw new Error('不支持的项目队伍操作')
  }
  async clone(url: unknown, tokenFor?: GitTokenProvider) {
    if (this.#transfers.has('clone')) throw new Error('正在克隆源项目')
    const controller = new AbortController()
    this.#transfers.set('clone', controller)
    const directory = join(this.root, 'projects', `clone-${randomUUID()}`)
    try {
      await mkdir(dirname(directory), { recursive: true })
      await (await this.api()).cloneAuthorRepository(directory, url, controller.signal, tokenFor)
      return await this.add(directory)
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    } finally {
      this.#transfers.delete('clone')
    }
  }
  cancelGit(id: string) {
    this.#transfers.get(id)?.abort()
  }
  async git(id: string, input: { operation: 'status' }): Promise<GitStatus>
  async git(id: string, input: { operation: 'push-target' | 'tag-target' }): Promise<string>
  async git(id: string, input: GitInput, tokenFor?: GitTokenProvider): Promise<GitResult>
  async git(id: string, input: GitInput, tokenFor?: GitTokenProvider) {
    const session = await this.session(id)
    const { authorGit } = await this.api()
    return this.#mutate(async () => {
      if (input.operation === 'pull') {
        await session.jobs.refresh()
        if (session.jobs.list().some(job => ['running', 'queued'].includes(job.state)))
          throw new Error('请等创作任务结束后再拉取')
      }
      if (input.operation === 'tag') {
        const { job } = await this.#verifiedPack(session, input.jobId as string)
        if (job.kind !== 'release') throw new Error('请先完成发行检查')
        const manifest = JSON.parse((await session.workspace.read('package.json')).text)
        return authorGit(session.workspace, { operation: 'tag', tag: 'v' + manifest.version })
      }
      if (!['fetch', 'pull', 'push', 'push-tag'].includes(input.operation)) return authorGit(session.workspace, input)
      const controller = new AbortController()
      this.#transfers.set(id, controller)
      try {
        return await authorGit(session.workspace, input, controller.signal, tokenFor)
      } finally {
        this.#transfers.delete(id)
      }
    })
  }
  async githubTarget(id: string): Promise<AuthorGitHubTarget | null>
  async githubTarget(id: string, jobId: string): Promise<VerifiedAuthorGitHubTarget>
  async githubTarget(id: string, jobId?: string) {
    const session = await this.session(id)
    const { authorGit } = await this.api()
    const target = (await authorGit(session.workspace, { operation: 'github-target' })) as AuthorGitHubTarget | null
    if (jobId === undefined) return target
    const { job, filename, integrity } = await this.#verifiedPack(session, jobId)
    if (
      !target?.head ||
      !target.tagged ||
      job.kind !== 'release' ||
      session.workspace.hasDirtyFiles ||
      target.filename !== filename
    )
      throw new Error('请先保存、完成发行检查并为当前提交创建版本标签。')
    return { ...target, integrity }
  }
  async create(name: string, arcadiaRange?: string) {
    if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('请输入 1–80 个字符的项目名称')
    const directory = join(this.root, 'projects', `pack-${randomUUID().slice(0, 12)}`)
    await mkdir(dirname(directory), { recursive: true })
    const { createSourceProject } = await this.api()
    await createSourceProject(directory, basename(directory), arcadiaRange)
    const entry = await this.add(directory)
    await this.#mutate(async () =>
      this.#save((await this.list()).map(item => (item.id === entry.id ? { ...item, name: name.trim() } : item))),
    )
    // Source editing also works on machines without system Git. The Git view offers a retry.
    try {
      await this.git(entry.id, { operation: 'init' })
    } catch (error) {
      console.warn('新项目的本地 Git 仓库初始化失败', (error as Error).message)
    }
    return { ...entry, name: name.trim() }
  }
  async entry(id: string) {
    const entry = (await this.list()).find(entry => entry.id === id)
    if (!entry && this.installedPackage) return this.installedPackage(id)
    if (!entry) throw new Error('未登记此源项目')
    if ((await realpath(entry.directory)) !== entry.directory) throw new Error('目录已改变，请重新打开项目')
    return entry
  }
  async session(id: string) {
    const entry = await this.entry(id)
    let promise = this.#sessions.get(id)
    if (!promise) {
      promise = this.api()
        .then(api =>
          api.openAuthorSession(entry.directory, {
            execute: !entry.readOnly,
            readOnly: entry.readOnly,
            published: entry.published,
            env: this.env,
          }),
        )
        .then(session => {
          session.workspace.on('change', (event: Omit<AuthorChangeEvent, 'id'>) => this.notify({ id, ...event }))
          return session
        })
        .catch(error => {
          this.#sessions.delete(id)
          throw error
        })
      this.#sessions.set(id, promise)
    }
    return promise
  }
  /** Resolve only a successful task receipt owned by this registered project. */
  async #verifiedPack(session: AuthorSession, jobId: string) {
    await session.workspace.assertWritable()
    await session.jobs.refresh()
    const job = session.jobs.get(jobId)
    if (!['pack', 'release'].includes(job.kind) || job.state !== 'succeeded')
      throw new Error('请先完成此项目的构建打包')
    if (job.stale || session.jobs.list().find(item => ['pack', 'release'].includes(item.kind))?.jobId !== jobId)
      throw new Error('构建已过期，请重新构建后用于环境')
    const { filename, shasum, integrity } = job.result ?? {}
    if (
      typeof filename !== 'string' ||
      filename !== basename(filename) ||
      !filename.endsWith('.tgz') ||
      !/^[a-f0-9]{40}$/.test((shasum ?? '') as string) ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(integrity ?? '')
    )
      throw new Error('构建产物记录无效，请重新构建打包')
    const file = await session.workspace.path(filename)
    const bytes = await readFile(file)
    if (
      bytes.length > 64 * 1024 * 1024 ||
      createHash('sha1').update(bytes).digest('hex') !== shasum ||
      `sha512-${createHash('sha512').update(bytes).digest('base64')}` !== integrity
    )
      throw new Error('构建产物已改变，请重新构建打包后安装')
    return { filename, bytes, job, integrity: integrity! }
  }
  async installBuiltPack<T>(id: string, jobId: string, installFile: (file: string) => Promise<T>) {
    const { filename, bytes } = await this.#verifiedPack(await this.session(id), jobId)
    // Copy verified bytes into a private staging directory. Source edits after verification
    // cannot change the archive consumed by the existing package installer.
    const staging = join(this.root, 'state', `install-${randomUUID()}`)
    await mkdir(staging, { recursive: true })
    try {
      const captured = join(staging, filename)
      await writeFile(captured, bytes, { flag: 'wx' })
      return { packageId: await installFile(captured) }
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  }
  contextFile(id: string) {
    // IDs are generated by this manager; callers must resolve the registered entry first.
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('项目标识无效')
    return join(this.root, 'state', 'workbench-context', `${id}.json`)
  }
  async setContext(id: string, state: unknown) {
    const entry = await this.entry(id)
    const text = JSON.stringify({
      protocol: 'arcadia-workbench-context/v1',
      root: entry.directory,
      updatedAt: Date.now(),
      state,
    })
    if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new Error('当前上下文过大，无法同步给外部助手')
    const next = this.#contextQueue
      .catch(() => {})
      .then(async () => {
        if (!this.#sessions.has(id)) return
        const file = this.contextFile(id)
        await mkdir(dirname(file), { recursive: true })
        const temporary = `${file}.${randomUUID()}.tmp`
        try {
          await writeFile(temporary, text, { mode: 0o600 })
          await rename(temporary, file)
        } finally {
          await rm(temporary, { force: true })
        }
      })
    this.#contextQueue = next
    return next
  }
  async release(id: string, { preservePreviews = false } = {}) {
    this.cancelGit(id)
    const session = this.#sessions.get(id)
    const retained = session && preservePreviews && (await session).jobs.hasLivePreviews
    if (!retained) this.#sessions.delete(id)
    await this.#contextQueue.catch(() => {})
    await rm(this.contextFile(id), { force: true })
    if (retained) (await session).workspace.clearDirty()
    else if (session) await (await session).close()
  }
  async forget(id: string) {
    await this.release(id)
    await this.#mutate(async () => this.#save((await this.list()).filter(entry => entry.id !== id)))
  }
  async export(id: string, destination: string) {
    const session = await this.session(id)
    const relation = relative(session.workspace.root, resolve(destination))
    if (!relation || (!isAbsolute(relation) && relation !== '..' && !relation.startsWith(`..${sep}`)))
      throw new Error('导出目录必须位于源项目之外')
    try {
      await lstat(destination)
      throw new Error('请选择尚不存在的新目录')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const before = await session.workspace.revision()
    await mkdir(destination)
    try {
      for (const file of await session.workspace.files()) {
        if (file.error) throw new Error(file.error)
        const target = join(destination, file.file)
        await mkdir(dirname(target), { recursive: true })
        await cp(await session.workspace.path(file.file), target, { errorOnExist: true, force: false })
      }
      if (before !== (await session.workspace.revision())) throw new Error('导出期间源文件改变，请重新导出')
    } catch (error) {
      await rm(destination, { recursive: true, force: true })
      throw error
    }
    return destination
  }
  async openExternal(id: string, file: string | undefined, editor: string, line = 1, column = 1) {
    const session = await this.session(id)
    await session.workspace.assertWritable()
    const target = file ? await session.workspace.path(file) : session.workspace.root
    if (!['code', 'codium', 'cursor', 'zed'].includes(editor)) throw new Error('请选择受支持的外部编辑器')
    if (![line, column].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error('行列位置无效')
    const args =
      editor === 'zed'
        ? [session.workspace.root, ...(file ? [`${target}:${line}:${column}`] : [])]
        : [session.workspace.root, ...(file ? ['--goto', `${target}:${line}:${column}`] : [])]
    await new Promise<void>((resolve, reject) => {
      const child = spawn(editor, args, { shell: false, stdio: 'ignore', windowsHide: true })
      child.once('error', () => reject(new Error('无法打开编辑器，请检查命令是否可用，或选择显示文件夹')))
      child.once('exit', code => (code === 0 ? resolve() : reject(new Error('编辑器未能打开文件，请使用显示文件夹'))))
    })
  }
  async importAsset(id: string, source: string) {
    const session = await this.session(id)
    await session.workspace.assertWritable()
    const info = await lstat(source)
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > 64 * 1024 * 1024 ||
      !/\.(png|jpe?g|webp|mp3|ogg|swf)$/i.test(source)
    )
      throw new Error('请选择不超过 64 MiB 的图片、音频或 SWF 文件')
    const file = `assets/imports/${randomUUID().slice(0, 8)}-${basename(source)}`
    const target = await session.workspace.path(file, { create: true })
    await mkdir(dirname(target), { recursive: true })
    await session.workspace.path(file, { create: true })
    await copyFile(source, target, constants.COPYFILE_EXCL)
    return { file, name: basename(source) }
  }
  async stopPreviews() {
    for (const pending of this.#sessions.values()) await (await pending).jobs.stopPreviews()
  }
  async close() {
    for (const controller of this.#transfers.values()) controller.abort()
    await Promise.allSettled([...this.#sessions.keys()].map(id => this.release(id)))
    await this.#queue
  }
}
