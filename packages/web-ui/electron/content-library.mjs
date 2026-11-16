import { createHash, randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { basename, dirname, isAbsolute, join } from 'node:path'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const exactPackage = /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
// npm redacts UUIDs even in npm ls JSON paths; keep opaque handles out of directory names.
const storageName = id => 'content-' + id.replaceAll('-', '')
const contentKinds = ['species', 'skills', 'marks']
const packageName = /^(?:@[a-z0-9_.-]+\/)?[a-z0-9][a-z0-9_.-]*$/
const sourceError = code => Object.assign(new Error(code), { code })
function sourceRegistry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 200)
    throw sourceError('INSTALL_SOURCES_INVALID')
  for (const [name, source] of Object.entries(value)) {
    if (!packageName.test(name) || !source || typeof source !== 'object' || Array.isArray(source))
      throw sourceError('INSTALL_SOURCES_INVALID')
    const keys = {
      archive: ['kind', 'file'],
      directory: ['kind', 'directory'],
      url: ['kind', 'url', 'integrity'],
      git: ['kind', 'url', 'commit', 'artifactPath'],
    }[source.kind]
    if (!keys || Object.keys(source).some(key => !keys.includes(key))) throw sourceError('INSTALL_SOURCES_INVALID')
    if (source.kind === 'archive' || source.kind === 'directory') {
      const path = source[source.kind === 'archive' ? 'file' : 'directory']
      if (typeof path !== 'string' || !isAbsolute(path)) throw sourceError('INSTALL_SOURCES_INVALID')
    } else {
      let url
      try {
        url = new URL(source.url)
      } catch {
        throw sourceError('INSTALL_SOURCES_INVALID')
      }
      if (url.protocol !== 'https:' || url.username || url.password) throw sourceError('INSTALL_SOURCES_INVALID')
      if (source.kind === 'git' && !/^[a-fA-F0-9]{40}$/.test(source.commit ?? ''))
        throw sourceError('INSTALL_SOURCES_INVALID')
    }
  }
  return structuredClone(value)
}
function validEntry(item) {
  return (
    item &&
    uuid.test(item.id) &&
    typeof item.name === 'string' &&
    exactPackage.test(item.name + '@' + item.version) &&
    typeof item.namespace === 'string' &&
    item.namespace &&
    typeof item.title === 'string' &&
    typeof item.projectId === 'string' &&
    ((item.source?.kind === 'file' && ['content-0.tgz', 'candidates/content-0.tgz'].includes(item.source.file)) ||
      (item.source?.kind === 'npm' && item.source.spec === item.name + '@' + item.version)) &&
    typeof item.source.label === 'string' &&
    Array.isArray(item.graph) &&
    item.graph.every(
      pkg =>
        pkg &&
        typeof pkg.name === 'string' &&
        typeof pkg.version === 'string' &&
        pkg.dependencies &&
        typeof pkg.dependencies === 'object' &&
        !Array.isArray(pkg.dependencies) &&
        Object.values(pkg.dependencies).every(value => typeof value === 'string'),
    ) &&
    contentKinds.every(
      kind =>
        Array.isArray(item.contentIds?.[kind]) &&
        item.contentIds[kind].every(id => typeof id === 'string') &&
        Number.isSafeInteger(item.counts?.[kind]) &&
        item.counts[kind] >= 0,
    )
  )
}
async function readJson(file, limit = 8 * 1024 * 1024) {
  const stat = await lstat(file)
  if (!stat.isFile() || stat.size > limit) throw new Error('内容包记录无效')
  return JSON.parse(await readFile(file, 'utf8'))
}
const idsFor = packages =>
  Object.fromEntries(
    ['species', 'skills', 'marks'].map(kind => [
      kind,
      packages.flatMap(pkg =>
        pkg.manifest && pkg.draft
          ? (pkg.draft.data[kind] ?? []).map(item => pkg.manifest.namespace + ':' + item.id)
          : (pkg.catalogIds?.[kind] ?? []),
      ),
    ]),
  )
function graphFor(inspection) {
  const byLocation = new Map(inspection.packages.map(pkg => [pkg.location, pkg]))
  return inspection.packages.map(pkg => ({
    name: pkg.name,
    version: pkg.version,
    integrity: pkg.integrity,
    dependencies: Object.fromEntries(
      Object.entries(pkg.dependencies ?? {}).map(([name, location]) => [
        name,
        byLocation.get(location)?.version ?? location,
      ]),
    ),
    ...(pkg.manifest
      ? {
          projectId: pkg.manifest.projectId,
          namespace: pkg.manifest.namespace,
          containsCode: !!(pkg.manifest.effects || pkg.manifest.effectArtifact),
        }
      : pkg.officialHost
        ? { projectId: 'base', namespace: 'base', containsCode: true }
        : {}),
  }))
}
function checkedInspection(value) {
  if (value?.format !== 'arcadia.npm-installation' || !Array.isArray(value.packages))
    throw new Error('内容检查返回了无效结果')
  return value
}

/** Package-level local authority. No HTTP endpoints or renderer-supplied paths/commands. */
export class ContentLibrary {
  #state
  #loading
  #busy = false
  #idle
  #controller = new AbortController()
  #plans = new Map()
  #installJobs = new Map()
  #installTail = Promise.resolve()
  #writes = Promise.resolve()
  #sync = { status: 'idle' }
  #leases = new Map()
  #gcTimer
  #sources
  #createManagedProjects
  constructor({ root, run, host, withDefaultArchive, sources = {}, createManagedProjects }) {
    this.root = root
    this.run = run
    this.host = host
    this.withDefaultArchive = withDefaultArchive
    this.#sources = sourceRegistry(sources)
    this.#createManagedProjects =
      createManagedProjects ??
      (async (root, options) => {
        const { ManagedProjects } = await import('@arcadia-eternity/content-sdk/managed-projects')
        return new ManagedProjects(root, {
          ...options,
          bundledPackageRoot: dirname(
            fileURLToPath(import.meta.resolve('@arcadia-eternity/data-pack-base/package.json')),
          ),
        })
      })
  }
  async #load() {
    if (this.#state) return
    this.#loading ??= (async () => {
      await mkdir(this.root, { recursive: true })
      this.root = await realpath(this.root)
      const projects = join(this.root, 'projects')
      await mkdir(projects, { recursive: true })
      if ((await realpath(projects)) !== projects) throw new Error('内容包目录不能是外部链接')
      let state,
        fresh = false
      try {
        state = await readJson(join(this.root, 'library.json'))
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        fresh = true
        state = {
          version: 2,
          revision: 0,
          installed: [],
          activeIds: [],
          activeProject: null,
          desiredIds: [],
          goalRevision: 0,
          activeGoalRevision: -1,
        }
      }
      if (
        state.version !== 2 ||
        !Number.isSafeInteger(state.revision) ||
        state.revision < 0 ||
        !Array.isArray(state.installed) ||
        state.installed.length > 200 ||
        state.installed.some(item => !validEntry(item)) ||
        new Set(state.installed.map(item => item.id)).size !== state.installed.length ||
        !Array.isArray(state.activeIds) ||
        new Set(state.activeIds).size !== state.activeIds.length ||
        state.activeIds.some(id => !state.installed.some(item => item.id === id)) ||
        (state.activeIds.length > 0 && state.activeProject === null) ||
        (state.activeProject !== null && !uuid.test(state.activeProject))
      )
        throw new Error('本机内容包记录格式不正确')
      if (
        !Array.isArray(state.desiredIds) ||
        state.desiredIds.some(id => !state.installed.some(item => item.id === id)) ||
        !Number.isSafeInteger(state.goalRevision) ||
        state.goalRevision < 0 ||
        !Number.isSafeInteger(state.activeGoalRevision) ||
        state.installed.some(
          item => item.bundled && (!state.activeIds.includes(item.id) || !state.desiredIds.includes(item.id)),
        )
      )
        throw new Error('本机内容选择记录格式不正确')
      if (fresh && this.withDefaultArchive) await this.#initializeDefault(state)
      else {
        if (this.withDefaultArchive) await this.#synchronizeDefault(state)
        this.#state ??= state
      }
    })().catch(error => {
      this.#loading = undefined
      throw error
    })
    await this.#loading
  }
  async #initializeDefault(state) {
    await this.withDefaultArchive(async file => {
      const candidate = await this.#stageInstall(
        { kind: 'file', file, label: '随应用提供' },
        true,
        this.#controller.signal,
        state,
      )
      const plan = this.#plans.get(candidate.id)
      try {
        if (plan.entry.name !== '@arcadia-eternity/data-pack-base' || plan.entry.projectId !== 'base')
          throw new Error('默认包缺少基础内容声明')
        await this.run(
          ['content', 'npm', 'approve', await this.#directory(plan.project), '--profile', 'local-development'],
          this.#controller.signal,
        )
        const entry = { ...plan.entry, bundled: true }
        await this.#save({
          ...state,
          bundledDigest: createHash('sha256')
            .update(await readFile(file))
            .digest('hex'),
          installed: [entry],
          desiredIds: [entry.id],
          activeIds: [entry.id],
          activeProject: plan.project,
          activeGraph: entry.graph,
          activeGoalRevision: state.goalRevision,
        })
        this.#sync = { status: 'ready' }
      } catch (error) {
        await rm(await this.#directory(plan.project), { recursive: true, force: true })
        throw error
      } finally {
        this.#plans.delete(candidate.id)
      }
    })
  }
  async #synchronizeDefault(state) {
    const oldBase = state.installed.find(entry => entry.bundled)
    if (!oldBase) return
    await this.withDefaultArchive(async file => {
      const digest = createHash('sha256')
        .update(await readFile(file))
        .digest('hex')
      if (state.bundledDigest === digest) return
      const candidate = await this.#stageInstall(
        { kind: 'file', file, label: '随应用提供' },
        true,
        this.#controller.signal,
        { ...state, installed: state.installed.filter(entry => entry.id !== oldBase.id) },
      )
      const plan = this.#plans.get(candidate.id)
      const created = [plan.project]
      const replacements = new Map([[oldBase.id, { ...plan.entry, bundled: true }]])
      const projects = new Map([[oldBase.id, plan.project]])
      let installer
      try {
        installer = await this.#createManagedProjects(join(this.root, 'acquisition'), { offline: true })
        await this.run(
          ['content', 'npm', 'approve', await this.#directory(plan.project), '--profile', 'local-development'],
          this.#controller.signal,
        )
        for (const id of new Set([...state.installed.map(entry => entry.id), state.activeProject].filter(Boolean))) {
          if (id === oldBase.id) continue
          await installer.synchronizeProject(await this.#directory(id), async directory => {
            const next = randomUUID()
            const target = join(this.root, 'projects', storageName(next))
            await rename(directory, target)
            created.push(next)
            const inspection = checkedInspection(
              await this.run(['content', 'npm', 'inspect', target], this.#controller.signal),
            )
            await this.run(
              ['content', 'npm', 'approve', target, '--profile', 'local-development'],
              this.#controller.signal,
            )
            projects.set(id, next)
            const entry = state.installed.find(entry => entry.id === id)
            if (entry)
              replacements.set(id, {
                ...entry,
                id: next,
                graph: graphFor(inspection),
                contentIds: idsFor(inspection.packages),
              })
          })
        }
        const activeProject = projects.get(state.activeProject) ?? state.activeProject
        const activeInspection = checkedInspection(
          await this.run(['content', 'npm', 'inspect', await this.#directory(activeProject)], this.#controller.signal),
        )
        await this.run(
          ['content', 'validate', '--npm-project', await this.#directory(activeProject)],
          this.#controller.signal,
        )
        await this.#save({
          ...state,
          revision: state.revision + 1,
          bundledDigest: digest,
          installed: state.installed.map(entry => replacements.get(entry.id) ?? entry),
          activeIds: state.activeIds.map(id => projects.get(id) ?? id),
          desiredIds: state.desiredIds.map(id => projects.get(id) ?? id),
          activeProject,
          activeGraph: graphFor(activeInspection),
        })
      } catch (error) {
        await Promise.all(
          created.map(id => rm(join(this.root, 'projects', storageName(id)), { recursive: true, force: true })),
        )
        throw error
      } finally {
        this.#plans.delete(candidate.id)
        await installer?.close()
      }
    })
  }
  async synchronizeEnvironments(workspace, validate) {
    const installer = await this.#createManagedProjects(join(this.root, 'acquisition'), { offline: true })
    try {
      await installer.synchronizeBundledBase(workspace, validate)
    } finally {
      await installer.close()
    }
  }
  #update(change) {
    const update = this.#writes.then(() => {
      if (this.#controller.signal.aborted) throw new Error('内容包管理已关闭')
      return this.#save(change(this.#state))
    })
    this.#writes = update.catch(() => {})
    return update
  }
  async #save(next) {
    const contents = JSON.stringify(next, null, 2)
    if (Buffer.byteLength(contents) > 8 * 1024 * 1024) throw new Error('内容包记录过大，请先移除不再使用的版本')
    const file = join(this.root, 'library.json'),
      temp = file + '.' + randomUUID() + '.tmp'
    try {
      await writeFile(temp, contents, { flag: 'wx' })
      await rename(temp, file)
      this.#state = next
    } finally {
      await rm(temp, { force: true })
    }
  }
  async #exclusive(action) {
    if (this.#controller.signal.aborted) throw new Error('内容包管理已关闭')
    while (this.#busy) await this.#idle
    if (this.#controller.signal.aborted) throw new Error('内容包管理已关闭')
    this.#busy = true
    let settle
    this.#idle = new Promise(resolve => {
      settle = resolve
    })
    try {
      await this.#load()
      if (this.#controller.signal.aborted) throw new Error('内容包管理已关闭')
      return await action()
    } finally {
      this.#busy = false
      settle()
    }
  }
  async #directory(id) {
    if (!uuid.test(id)) throw new Error('内容包标识无效')
    const dir = join(this.root, 'projects', storageName(id))
    try {
      if ((await realpath(dir)) !== dir) throw new Error('内容包目录已改变')
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('安装目录已丢失，请卸载记录后重新安装此版本')
      throw error
    }
    return dir
  }
  /** Capture the active project before a local session starts; release after its runtime disposes. */
  async acquireProject() {
    return this.#exclusive(() => this.#leaseProject(this.#state.activeProject))
  }
  async acquireDefaultProject() {
    return this.#exclusive(() => this.#leaseProject(this.#state.installed.find(entry => entry.bundled)?.id ?? null))
  }
  async #leaseProject(id) {
    const directory = id ? await this.#directory(id) : null
    if (id) this.#leases.set(id, (this.#leases.get(id) ?? 0) + 1)
    let released = false
    return {
      directory,
      release: async () => {
        if (released) return
        released = true
        if (id) {
          const count = this.#leases.get(id) - 1
          if (count) this.#leases.set(id, count)
          else this.#leases.delete(id)
        }
        if (!this.#controller.signal.aborted) await this.collectGarbage()
      },
    }
  }
  /** Fixed project materials may also be owned by immutable workspace versions. */
  async ownsProjectDirectory(directory) {
    if (typeof directory !== 'string') return false
    await this.#load()
    const name = basename(directory)
    if (!/^content-[0-9a-f]{32}$/.test(name) || directory !== join(this.root, 'projects', name)) return false
    return (await realpath(directory).catch(() => null)) === directory
  }
  async retainProjectDirectory(directory) {
    return this.#exclusive(async () => {
      if (!(await this.ownsProjectDirectory(directory))) throw new Error('环境材料不属于此内容工作区')
      const id = basename(directory)
        .slice(8)
        .replace(/^(........)(....)(....)(....)(............)$/, '$1-$2-$3-$4-$5')
      await this.#directory(id)
      this.#leases.set(id, (this.#leases.get(id) ?? 0) + 1)
      let released = false
      return async () => {
        if (released) return
        released = true
        const count = (this.#leases.get(id) ?? 1) - 1
        if (count) this.#leases.set(id, count)
        else this.#leases.delete(id)
        // Collection is scheduled independently; releasing a workspace lease can
        // occur while that workspace holds its own deletion critical section.
        this.#scheduleGc()
      }
    })
  }
  async collectGarbage() {
    return this.#exclusive(() => this.#collectGarbage())
  }
  async #collectGarbage() {
    clearTimeout(this.#gcTimer)
    this.#gcTimer = undefined
    const protectedIds = new Set([
      ...this.#state.installed.map(entry => entry.id),
      this.#state.activeProject,
      ...Array.from(this.#plans.values(), plan => plan.project),
      ...this.#leases.keys(),
    ])
    // Retirement is only a request: rooms, checkpoints and asset streams may still own leases.
    let retained
    try {
      if (this.host.retainedProjectDirectories) retained = await this.host.retainedProjectDirectories()
      else if (this.host.status().status !== 'idle') return
      else retained = []
    } catch {
      this.#scheduleGc()
      return
    }
    const held = new Set(retained)
    const projects = join(this.root, 'projects')
    for (const entry of await readdir(projects, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^content-[0-9a-f]{32}$/.test(entry.name)) continue
      const id = entry.name.slice(8).replace(/^(........)(....)(....)(....)(............)$/, '$1-$2-$3-$4-$5')
      if (protectedIds.has(id)) continue
      const directory = join(projects, entry.name)
      if (held.has(directory)) {
        this.#scheduleGc()
        continue
      }
      if ((await realpath(directory)) !== directory) continue
      await rm(directory, { recursive: true, force: true })
    }
  }
  #scheduleGc() {
    if (this.#controller.signal.aborted || this.#gcTimer) return
    this.#gcTimer = setTimeout(() => {
      this.#gcTimer = undefined
      void this.collectGarbage().catch(() => {})
    }, 30000)
    this.#gcTimer.unref?.()
  }
  async sourceDirectory(id) {
    await this.#load()
    const entry = this.#entry(id)
    const root = await this.#directory(id)
    const directory = join(root, 'node_modules', entry.name)
    const resolved = await realpath(directory)
    if (resolved !== directory) throw new Error('安装内容目录已改变')
    return resolved
  }
  #entry(id) {
    const entry = this.#state.installed.find(item => item.id === id)
    if (!entry) throw new Error('未安装此内容包')
    return entry
  }
  #plan(id, kind) {
    const plan = this.#plans.get(id)
    if (!plan || plan.kind !== kind) throw new Error('操作清单已失效，请重新准备')
    if (plan.revision !== this.#state.revision) throw new Error('内容包列表已变化，请重新准备操作')
    return plan
  }
  async #createProject(sources, offline = false, signal = this.#controller.signal) {
    const id = randomUUID(),
      directory = join(this.root, 'projects', storageName(id))
    await mkdir(directory)
    try {
      await writeFile(
        join(directory, 'package.json'),
        JSON.stringify({ name: 'arcadia-local-content', version: '1.0.0', private: true }),
      )
      const inputs = []
      await mkdir(join(directory, 'candidates'))
      for (let index = 0; index < sources.length; index++) {
        const source = sources[index]
        if (source.kind === 'file') {
          const file = 'candidates/content-' + index + '.tgz'
          await copyFile(source.file, join(directory, file))
          inputs.push('file:./' + file)
        } else inputs.push(source.spec)
      }
      const inspection = checkedInspection(
        await this.run(
          [
            'content',
            'npm',
            'stage',
            directory,
            ...(offline ? ['--offline'] : []),
            ...(inputs.length ? ['--package', ...inputs] : []),
          ],
          signal,
        ),
      )
      return { id, directory, inspection }
    } catch (error) {
      await rm(directory, { recursive: true, force: true })
      throw error
    }
  }
  async list() {
    await this.#load()
    const state = this.#state
    const status = this.host.status()
    const activeDirectory = state.activeProject ? join(this.root, 'projects', storageName(state.activeProject)) : null
    return structuredClone({
      revision: state.revision,
      operations: [...this.#installJobs.values()].map(({ controller, execute, promise, ...job }) => job).reverse(),
      packages: await Promise.all(
        state.installed.map(async entry => {
          try {
            await this.#directory(entry.id)
            await lstat(join(this.root, 'projects', storageName(entry.id), 'node_modules', entry.name, 'package.json'))
            return entry
          } catch (error) {
            return {
              ...entry,
              error: error.code === 'ENOENT' ? '包文件已丢失，请卸载记录后重新安装此版本' : error.message,
            }
          }
        }),
      ),
      activeIds: state.activeIds,
      activeGraph: state.activeGraph,
      desiredIds: state.desiredIds,
      selection: this.#sync,
      hasSelection: !!activeDirectory,
      serviceStatus: status,
      serviceNeedsRestart: false,
      serviceUsesDifferentEnvironment:
        status.status === 'running' && this.host.projectDirectory?.() !== activeDirectory,
    })
  }
  async #stageFile(file, offline = false, signal = this.#controller.signal) {
    return this.#exclusive(async () => {
      if (typeof file !== 'string' || !file.endsWith('.tgz')) throw new Error('请选择 npm 内容包文件（.tgz）')
      const source = await realpath(file),
        info = await lstat(source)
      if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new Error('内容包必须是小于 64 MiB 的普通文件')
      return this.#stageInstall({ kind: 'file', file: source, label: basename(source) }, offline, signal)
    })
  }
  async installFile(file, offline = false) {
    return this.#installTask(basename(file), signal => this.#stageFile(file, offline, signal))
  }
  async installNpm(spec, offline = false) {
    return this.#installTask(String(spec), signal => this.#stageNpm(spec, offline, signal))
  }
  #installTask(label, execute) {
    if ([...this.#installJobs.values()].filter(job => ['queued', 'running'].includes(job.status)).length >= 30)
      throw new Error('安装队列已满')
    const job = {
      id: randomUUID(),
      label,
      status: 'queued',
      stage: 'queued',
      createdAt: Date.now(),
      controller: new AbortController(),
      execute,
    }
    this.#installJobs.set(job.id, job)
    for (const [id, item] of this.#installJobs)
      if (this.#installJobs.size > 30 && !['queued', 'running'].includes(item.status)) this.#installJobs.delete(id)
    const signal = AbortSignal.any([job.controller.signal, this.#controller.signal])
    job.promise = this.#installTail.then(async () => {
      let plan
      try {
        signal.throwIfAborted()
        job.status = 'running'
        job.stage = 'installing'
        plan = await execute(signal)
        signal.throwIfAborted()
        job.stage = 'recording'
        const id = await this.#installOnly(plan, signal)
        job.status = 'succeeded'
        return id
      } catch (error) {
        if (plan) await this.#cancel(plan.id).catch(() => {})
        job.status = signal.aborted ? 'cancelled' : 'failed'
        job.error = signal.aborted ? '已取消' : error.message
        throw error
      } finally {
        job.updatedAt = Date.now()
      }
    })
    this.#installTail = job.promise.catch(() => {})
    return job.promise
  }
  cancelInstall(id) {
    const job = this.#installJobs.get(id)
    if (!job) throw new Error('安装任务不存在')
    if (job.status === 'queued' || (job.status === 'running' && job.stage !== 'recording')) {
      job.controller.abort()
      if (job.status === 'queued') {
        job.status = 'cancelled'
        job.error = '已移出队列'
        job.updatedAt = Date.now()
      }
    }
  }
  retryInstall(id) {
    const job = this.#installJobs.get(id)
    if (!job || !['failed', 'cancelled'].includes(job.status)) throw new Error('此安装任务不能重试')
    return this.#installTask(job.label, job.execute)
  }
  clearInstallTasks() {
    for (const [id, job] of this.#installJobs)
      if (!['queued', 'running'].includes(job.status)) this.#installJobs.delete(id)
  }
  async #installOnly(plan, signal) {
    let id
    try {
      signal.throwIfAborted()
      id = await this.#confirmInstall(plan.id, true)
    } catch (error) {
      await this.#cancel(plan.id).catch(() => {})
      throw error
    }
    return id
  }
  async #stageNpm(spec, offline = false, signal = this.#controller.signal) {
    return this.#exclusive(async () => {
      if (typeof spec !== 'string' || spec.length > 256 || !exactPackage.test(spec))
        throw new Error('请输入 npm 包名和明确版本，例如 @author/pets@1.0.0')
      return this.#stageInstall({ kind: 'npm', spec, label: spec }, offline, signal)
    })
  }
  async #stageInstall(source, offline, signal, state = this.#state) {
    if (this.#plans.size >= 8) throw new Error('请先完成或取消已有操作')
    if (state.installed.length >= 200) throw new Error('已安装内容包数量达到上限')
    const project = await this.#createProject([source], offline, signal)
    try {
      const manifest = await readJson(join(project.directory, 'package.json'))
      const names = Object.keys(manifest.dependencies ?? {})
      if (names.length !== 1) throw new Error('一次只能添加一个根内容包')
      const root = project.inspection.packages.find(pkg => pkg.location === 'node_modules/' + names[0])
      if (!root?.catalogIds && (!root?.manifest || !root.draft)) throw new Error('该 npm 包没有 Arcadia 内容声明')
      if (state.installed.some(item => item.name === root.name && item.version === root.version))
        throw new Error('已安装此包的同一版本；请先移除未启用的旧安装，或使用新的包版本')
      const packageManifest = await readJson(join(project.directory, root.location, 'package.json'))
      const author = typeof packageManifest.author === 'string' ? packageManifest.author : packageManifest.author?.name
      const entry = {
        id: project.id,
        name: root.name,
        title: root.draft?.project.title || (root.officialHost ? '官方基础内容' : root.name),
        version: root.version,
        namespace: root.manifest?.namespace ?? 'base',
        projectId: root.manifest?.projectId ?? 'base',
        description: root.draft?.project.description || packageManifest.description || '',
        author: typeof author === 'string' ? author : '',
        sdkApi: root.manifest?.sdkApi ?? packageManifest.arcadia?.sdkApi,
        license: typeof packageManifest.license === 'string' ? packageManifest.license : undefined,
        engines:
          packageManifest.engines && typeof packageManifest.engines === 'object' ? packageManifest.engines : undefined,
        dependencyRanges: root.dependencyRanges ?? {},
        source:
          source.kind === 'npm'
            ? { kind: 'npm', spec: source.spec, label: source.label }
            : { kind: 'file', file: 'candidates/content-0.tgz', label: source.label },
        graph: graphFor(project.inspection),
        contentIds: idsFor(project.inspection.packages),
        counts: Object.fromEntries(
          ['species', 'skills', 'marks'].map(kind => [
            kind,
            (root.draft?.data[kind] ?? root.catalogIds?.[kind])?.length ?? 0,
          ]),
        ),
        containsCode: project.inspection.packages.some(
          pkg => !!(pkg.officialHost || pkg.manifest?.effects || pkg.manifest?.effectArtifact),
        ),
        installedAt: new Date().toISOString(),
      }
      const plan = { id: randomUUID(), kind: 'install', revision: state.revision, project: project.id, entry }
      this.#plans.set(plan.id, plan)
      return { id: plan.id, kind: 'install', package: structuredClone(entry), requiresApproval: true }
    } catch (error) {
      await rm(project.directory, { recursive: true, force: true })
      throw error
    }
  }
  async #confirmInstall(id, allowCode) {
    return this.#exclusive(async () => {
      const plan = this.#plan(id, 'install')
      if (allowCode !== true) throw new Error('安装需要明确允许此内容包及其依赖在本机运行')
      await this.run(
        ['content', 'npm', 'approve', await this.#directory(plan.project), '--profile', 'local-development'],
        this.#controller.signal,
      )
      await this.#update(state => ({
        ...state,
        revision: state.revision + 1,
        installed: [...state.installed, plan.entry],
      }))
      this.#plans.delete(id)
      return plan.entry.id
    })
  }
  async #registeredSources() {
    let sources = {}
    try {
      sources = sourceRegistry(await readJson(join(this.root, 'content-sources.json'), 128 * 1024))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
    return { ...sources, ...this.#sources }
  }
  /** The main process obtains this path from a native file chooser, never a renderer path. */
  async importSourceRegistry(file) {
    return this.#exclusive(async () => {
      const sources = sourceRegistry(await readJson(file, 128 * 1024))
      const target = join(this.root, 'content-sources.json'),
        temporary = target + '.' + randomUUID() + '.tmp'
      try {
        await writeFile(temporary, JSON.stringify(sources, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
        await rename(temporary, target)
      } finally {
        await rm(temporary, { force: true })
      }
      return { sourceIds: Object.keys(sources).sort() }
    })
  }
  /** Prepare a named management environment without changing local-play selection.
   * Material resolution depends only on explicit declarations and registered sources.
   */
  async prepareEnvironmentProject(document, { signal, offline = false, onProgress, projectDirectory } = {}) {
    return this.#exclusive(async () => {
      if (!document || typeof document.packages !== 'object' || !document.packages || Array.isArray(document.packages))
        throw new Error('环境包配置无效')
      await onProgress?.({ stage: 'resolving' })
      const requested = Object.entries(document.packages).sort(([a], [b]) => a.localeCompare(b))
      const sourceIds = document.sources ?? []
      if (
        !Array.isArray(sourceIds) ||
        new Set(sourceIds).size !== sourceIds.length ||
        sourceIds.some(name => typeof name !== 'string' || !packageName.test(name)) ||
        requested.length + sourceIds.length > 100 ||
        requested.some(
          ([name, version]) =>
            !packageName.test(name) ||
            typeof version !== 'string' ||
            !version.trim() ||
            (!/^file:candidates\/[a-zA-Z0-9_.-]+\.tgz$/.test(version) &&
              (/[\/\\]/.test(version) || /^(?:file|link|workspace):/.test(version))),
        )
      )
        throw new Error('环境包配置无效')
      const combined = signal ? AbortSignal.any([signal, this.#controller.signal]) : this.#controller.signal
      combined.throwIfAborted()
      const registry = sourceIds.length ? await this.#registeredSources() : {}
      const selectedSources = {},
        installedSources = new Map()
      for (const name of sourceIds) {
        if (name === '@arcadia-eternity/data-pack-base') continue
        if (Object.hasOwn(document.packages, name)) throw sourceError('INSTALL_DUPLICATE_PACKAGE')
        if (Object.hasOwn(registry, name)) selectedSources[name] = registry[name]
        else {
          const installed = this.#state.installed.filter(entry => entry.name === name)
          if (!installed.length) throw sourceError('INSTALL_SOURCE_NOT_REGISTERED')
          if (installed.length !== 1) throw sourceError('INSTALL_SOURCE_AMBIGUOUS')
          const entry = installed[0]
          installedSources.set(name, entry)
          requested.push([name, entry.version])
        }
      }
      requested.sort(([a], [b]) => a.localeCompare(b))
      let id, directory
      {
        let project
        if (
          projectDirectory ||
          requested.some(([name]) => name === '@arcadia-eternity/data-pack-base') ||
          sourceIds.includes('@arcadia-eternity/data-pack-base') ||
          Object.keys(selectedSources).length
        ) {
          // Share the headless source/lock/install pipeline, then transfer its one
          // tree into the client library before committing the persistent environment.
          const packages = Object.fromEntries(requested)
          for (const [name, version] of requested) {
            if (name === '@arcadia-eternity/data-pack-base') continue
            const entry =
              installedSources.get(name) ??
              this.#state.installed.find(
                item => item.name === name && item.version === version && item.source.kind === 'file',
              )
            if (entry?.source.kind === 'file') {
              selectedSources[name] = {
                kind: 'archive',
                file: join(await this.#directory(entry.id), entry.source.file),
              }
              delete packages[name]
            }
          }
          const acquisition = join(this.root, 'acquisition')
          await mkdir(acquisition, { recursive: true })
          if ((await realpath(acquisition)) !== acquisition) throw sourceError('INSTALL_ROOT_INVALID')
          const installer = await this.#createManagedProjects(acquisition, {
            sources: selectedSources,
            offline,
            allowThirdPartyContent: true,
          })
          try {
            project = await installer.prepareProject(
              {
                ...document,
                packages,
                sources: [
                  ...sourceIds.filter(name => name === '@arcadia-eternity/data-pack-base'),
                  ...Object.keys(selectedSources),
                ],
              },
              { signal: combined, onProgress, projectDirectory },
              async staged => {
                combined.throwIfAborted()
                const id = randomUUID(),
                  directory = join(this.root, 'projects', storageName(id))
                await rename(staged, directory)
                return { id, directory }
              },
            )
          } finally {
            await installer.close()
          }
        } else {
          const sources = []
          for (const [name, version] of requested) {
            const installed =
              installedSources.get(name) ??
              this.#state.installed.find(entry => entry.name === name && entry.version === version)
            sources.push(
              installed?.source.kind === 'file'
                ? { kind: 'file', file: join(await this.#directory(installed.id), installed.source.file) }
                : { kind: 'npm', spec: `${name}@${version}` },
            )
          }
          await onProgress?.({ stage: 'installing' })
          project = await this.#createProject(sources, offline, combined)
        }
        id = project.id
        directory = project.directory
        try {
          combined.throwIfAborted()
          await this.run(['content', 'npm', 'approve', directory, '--profile', 'local-development'], combined)
          combined.throwIfAborted()
        } catch (error) {
          await rm(directory, { recursive: true, force: true })
          throw error
        }
      }
      this.#leases.set(id, (this.#leases.get(id) ?? 0) + 1)
      let released = false
      return {
        directory,
        release: async () => {
          if (released) return
          released = true
          const count = (this.#leases.get(id) ?? 1) - 1
          if (count) this.#leases.set(id, count)
          else this.#leases.delete(id)
          this.#scheduleGc()
        },
      }
    })
  }
  async #cancel(id) {
    return this.#exclusive(async () => {
      const plan = this.#plans.get(id)
      if (!plan) return
      this.#plans.delete(id)
      await rm(await this.#directory(plan.project), { recursive: true, force: true })
    })
  }
  /** After local environments capture the legacy selection, retain only the shipped fallback. */
  async retireSelection() {
    return this.#exclusive(async () => {
      const base = this.#state.installed.find(entry => entry.bundled)
      if (!base) throw new Error('默认内容包不可用')
      if (
        this.#state.activeIds.length === 1 &&
        this.#state.activeIds[0] === base.id &&
        this.#state.desiredIds.length === 1 &&
        this.#state.desiredIds[0] === base.id
      )
        return
      const revision = this.#state.goalRevision + 1
      await this.#update(state => ({
        ...state,
        activeIds: [base.id],
        desiredIds: [base.id],
        revision: state.revision + 1,
        activeProject: base.id,
        activeGraph: base.graph,
        goalRevision: revision,
        activeGoalRevision: revision,
      }))
      this.#sync = { status: 'ready' }
    })
  }
  async uninstall(id) {
    return this.#exclusive(async () => {
      if (this.#entry(id).bundled) throw new Error('默认环境必须保留基础内容包')
      if (this.#state.activeIds.includes(id) || this.#state.desiredIds.includes(id))
        throw new Error('内容仍被旧本地选择引用，暂时无法卸载')
      const directory = join(this.root, 'projects', storageName(id))
      try {
        await this.#directory(id)
      } catch (error) {
        if ((await lstat(directory).catch(() => null)) !== null) throw error
      }
      await this.#update(state => {
        if (state.activeIds.includes(id) || state.desiredIds.includes(id))
          throw new Error('内容仍被旧本地选择引用，暂时无法卸载')
        return { ...state, revision: state.revision + 1, installed: state.installed.filter(item => item.id !== id) }
      })
      await rm(directory, { recursive: true, force: true })
    })
  }
  async resume() {
    await this.#load()
    await this.collectGarbage().catch(() => {})
  }
  async close() {
    this.#controller.abort()
    clearTimeout(this.#gcTimer)
    await this.#installTail
    await this.#idle
    await this.#writes
    for (const plan of this.#plans.values()) {
      await rm(join(this.root, 'projects', storageName(plan.project)), { recursive: true, force: true })
    }
    this.#plans.clear()
  }
}
