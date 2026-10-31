import { randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const exactPackage = /^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
// npm redacts UUIDs even in npm ls JSON paths; keep opaque handles out of directory names.
const storageName = id => 'content-' + id.replaceAll('-', '')
const contentKinds = ['species', 'skills', 'marks']
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
    ((item.source?.kind === 'file' && item.source.file === 'content-0.tgz') ||
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
const identity = pkg => [pkg.name, pkg.version, pkg.integrity ?? '', pkg.projectId ?? '', pkg.namespace ?? ''].join('|')
const idsFor = packages =>
  Object.fromEntries(
    ['species', 'skills', 'marks'].map(kind => [
      kind,
      packages.flatMap(pkg =>
        pkg.manifest && pkg.draft
          ? (pkg.draft.data[kind] ?? []).map(item => pkg.manifest.namespace + ':' + item.id)
          : [],
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
      ? { projectId: pkg.manifest.projectId, namespace: pkg.manifest.namespace, containsCode: !!pkg.manifest.effects }
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
  #writes = Promise.resolve()
  #scheduled
  #reconciling
  #sync = { status: 'idle' }
  #settledGoal
  constructor({ root, run, host }) {
    this.root = root
    this.run = run
    this.host = host
  }
  async #load() {
    if (this.#state) return
    this.#loading ??= (async () => {
      await mkdir(this.root, { recursive: true })
      this.root = await realpath(this.root)
      const projects = join(this.root, 'projects')
      await mkdir(projects, { recursive: true })
      if ((await realpath(projects)) !== projects) throw new Error('内容包目录不能是外部链接')
      let state
      try {
        state = await readJson(join(this.root, 'library.json'))
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        state = { version: 1, revision: 0, installed: [], activeIds: [], activeProject: null }
      }
      if (
        state.version !== 1 ||
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
      state.desiredIds ??= [...state.activeIds]
      state.goalRevision ??= 0
      state.activeGoalRevision ??= state.activeProject ? 0 : -1
      if (
        !Array.isArray(state.desiredIds) ||
        state.desiredIds.some(id => !state.installed.some(item => item.id === id)) ||
        !Number.isSafeInteger(state.goalRevision) ||
        state.goalRevision < 0 ||
        !Number.isSafeInteger(state.activeGoalRevision)
      )
        throw new Error('本机内容选择记录格式不正确')
      this.#state = state
    })().catch(error => {
      this.#loading = undefined
      throw error
    })
    await this.#loading
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
  async #createProject(sources, offline = false) {
    const id = randomUUID(),
      directory = join(this.root, 'projects', storageName(id))
    await mkdir(directory)
    try {
      await writeFile(
        join(directory, 'package.json'),
        JSON.stringify({ name: 'arcadia-local-content', version: '1.0.0', private: true }),
      )
      const inputs = []
      for (let index = 0; index < sources.length; index++) {
        const source = sources[index]
        if (source.kind === 'file') {
          const file = 'content-' + index + '.tgz'
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
          this.#controller.signal,
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
      selection:
        this.#sync.status === 'ready' && status.status === 'failed'
          ? { status: 'failed', message: status.message }
          : this.#sync,
      hasSelection: !!activeDirectory,
      serviceStatus: status,
      serviceNeedsRestart: status.status === 'running' && this.host.projectDirectory?.() !== activeDirectory,
    })
  }
  async stageFile(file, offline = false) {
    return this.#exclusive(async () => {
      if (typeof file !== 'string' || !file.endsWith('.tgz')) throw new Error('请选择 npm 内容包文件（.tgz）')
      const source = await realpath(file),
        info = await lstat(source)
      if (!info.isFile() || info.size > 64 * 1024 * 1024) throw new Error('内容包必须是小于 64 MiB 的普通文件')
      return this.#stageInstall({ kind: 'file', file: source, label: basename(source) }, offline)
    })
  }
  async installFile(file, offline = false) {
    return this.#installAndEnable(await this.stageFile(file, offline), offline)
  }
  async installNpm(spec, offline = false) {
    return this.#installAndEnable(await this.stageNpm(spec, offline), offline)
  }
  async #installAndEnable(plan, offline) {
    let id
    try {
      id = await this.confirmInstall(plan.id, true)
    } catch (error) {
      await this.cancel(plan.id).catch(() => {})
      throw error
    }
    await this.#update(state => {
      const installed = this.#entry(id)
      const ids = state.desiredIds.filter(other => this.#entry(other).name !== installed.name)
      return { ...state, desiredIds: [...ids, id], goalRevision: state.goalRevision + 1, offline: offline === true }
    })
    this.#sync = { status: 'preparing' }
    this.#schedule()
    return id
  }
  async stageNpm(spec, offline = false) {
    return this.#exclusive(async () => {
      if (typeof spec !== 'string' || spec.length > 256 || !exactPackage.test(spec))
        throw new Error('请输入 npm 包名和明确版本，例如 @author/pets@1.0.0')
      return this.#stageInstall({ kind: 'npm', spec, label: spec }, offline)
    })
  }
  async #stageInstall(source, offline) {
    if (this.#plans.size >= 8) throw new Error('请先完成或取消已有操作')
    if (this.#state.installed.length >= 200) throw new Error('已安装内容包数量达到上限')
    const project = await this.#createProject([source], offline)
    try {
      const manifest = await readJson(join(project.directory, 'package.json'))
      const names = Object.keys(manifest.dependencies ?? {})
      if (names.length !== 1) throw new Error('一次只能添加一个根内容包')
      const root = project.inspection.packages.find(pkg => pkg.location === 'node_modules/' + names[0])
      if (!root?.manifest || !root.draft) throw new Error('该 npm 包没有 Arcadia 内容声明')
      if (this.#state.installed.some(item => item.name === root.name && item.version === root.version))
        throw new Error('已安装此包的同一版本；请先移除未启用的旧安装，或使用新的包版本')
      const packageManifest = await readJson(join(project.directory, root.location, 'package.json'))
      const author = typeof packageManifest.author === 'string' ? packageManifest.author : packageManifest.author?.name
      const entry = {
        id: project.id,
        name: root.name,
        title: root.draft.project.title || root.name,
        version: root.version,
        namespace: root.manifest.namespace,
        projectId: root.manifest.projectId,
        description: root.draft.project.description || '',
        author: typeof author === 'string' ? author : '',
        source:
          source.kind === 'npm'
            ? { kind: 'npm', spec: source.spec, label: source.label }
            : { kind: 'file', file: 'content-0.tgz', label: source.label },
        graph: graphFor(project.inspection),
        contentIds: idsFor(project.inspection.packages),
        counts: Object.fromEntries(
          ['species', 'skills', 'marks'].map(kind => [kind, root.draft.data[kind]?.length ?? 0]),
        ),
        containsCode: project.inspection.packages.some(pkg => !!pkg.manifest?.effects),
        installedAt: new Date().toISOString(),
      }
      const plan = { id: randomUUID(), kind: 'install', revision: this.#state.revision, project: project.id, entry }
      this.#plans.set(plan.id, plan)
      return { id: plan.id, kind: 'install', package: structuredClone(entry), requiresApproval: true }
    } catch (error) {
      await rm(project.directory, { recursive: true, force: true })
      throw error
    }
  }
  async confirmInstall(id, allowCode) {
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
  async planSelection(ids, offline = false) {
    return this.#exclusive(() => this.#prepareSelection(ids, offline))
  }
  async #prepareSelection(ids, offline = false) {
    if (!Array.isArray(ids) || ids.length > 100 || new Set(ids).size !== ids.length) throw new Error('内容包选择无效')
    if (this.#plans.size >= 8) throw new Error('请先完成或取消已有操作')
    const entries = ids.map(id => this.#entry(id))
    if (new Set(entries.map(item => item.name)).size !== entries.length) throw new Error('同一个内容包只能启用一个版本')
    const sources = []
    for (const entry of entries)
      sources.push(
        entry.source.kind === 'file'
          ? { kind: 'file', file: join(await this.#directory(entry.id), entry.source.file) }
          : { kind: 'npm', spec: entry.name + '@' + entry.version },
      )
    const project = await this.#createProject(sources, offline)
    const graph = graphFor(project.inspection)
    const admitted = new Set(entries.flatMap(item => item.graph.map(identity)))
    const newDependencies = graph.filter(pkg => !admitted.has(identity(pkg)))
    const plan = {
      id: randomUUID(),
      kind: 'selection',
      revision: this.#state.revision,
      project: project.id,
      ids: [...ids],
      graph,
      contentIds: idsFor(project.inspection.packages),
      newDependencies,
    }
    this.#plans.set(plan.id, plan)
    return structuredClone({
      id: plan.id,
      kind: plan.kind,
      ids: plan.ids,
      graph,
      contentIds: plan.contentIds,
      newDependencies,
      requiresApproval: newDependencies.length > 0,
    })
  }
  async applySelection(id, allowCode = false) {
    return this.#exclusive(async () => {
      const plan = this.#plan(id, 'selection')
      if (plan.newDependencies.length && allowCode !== true) throw new Error('依赖发生变化，请先确认新的依赖清单')
      const directory = await this.#directory(plan.project)
      try {
        await this.run(
          ['content', 'npm', 'approve', directory, '--profile', 'local-development'],
          this.#controller.signal,
        )
        await this.run(
          ['content', 'validate', ...(plan.ids.length ? ['--npm-project', directory] : [])],
          this.#controller.signal,
        )
        await this.#update(state => ({
          ...state,
          revision: state.revision + 1,
          activeIds: plan.ids,
          activeProject: plan.project,
          activeGraph: plan.graph,
          desiredIds: plan.ids,
          goalRevision: state.goalRevision + 1,
          activeGoalRevision: state.goalRevision + 1,
        }))
        this.#plans.delete(id)
      } catch (error) {
        this.#plans.delete(id)
        await rm(directory, { recursive: true, force: true })
        throw error
      }
    })
  }
  async cancel(id) {
    return this.#exclusive(async () => {
      const plan = this.#plans.get(id)
      if (!plan) return
      this.#plans.delete(id)
      await rm(await this.#directory(plan.project), { recursive: true, force: true })
    })
  }
  async uninstall(id) {
    return this.#exclusive(async () => {
      this.#entry(id)
      if (this.#state.activeIds.includes(id) || this.#state.desiredIds.includes(id))
        throw new Error('请先停用此包，等待内容准备完成后再卸载')
      const directory = join(this.root, 'projects', storageName(id))
      try {
        await this.#directory(id)
      } catch (error) {
        if ((await lstat(directory).catch(() => null)) !== null) throw error
      }
      await this.#update(state => {
        if (state.activeIds.includes(id) || state.desiredIds.includes(id)) throw new Error('内容仍在使用，请先停用')
        return { ...state, revision: state.revision + 1, installed: state.installed.filter(item => item.id !== id) }
      })
      await rm(directory, { recursive: true, force: true })
    })
  }
  async resume() {
    await this.#load()
    if (this.#state.activeProject && this.#state.activeGoalRevision === this.#state.goalRevision) {
      this.#sync = { status: 'ready' }
      this.#settledGoal = this.#state.goalRevision
      return
    }
    this.#settledGoal = undefined
    if (this.#state.activeProject || this.#state.desiredIds.length) this.#schedule()
  }
  async setSelection(ids, offline = false) {
    await this.#load()
    if (!Array.isArray(ids) || ids.length > 100 || new Set(ids).size !== ids.length) throw new Error('内容包选择无效')
    await this.#update(state => {
      const entries = ids.map(id => this.#entry(id))
      if (new Set(entries.map(entry => entry.name)).size !== entries.length)
        throw new Error('同一个内容包只能启用一个版本')
      return { ...state, desiredIds: [...ids], goalRevision: state.goalRevision + 1, offline: offline === true }
    })
    this.#sync = { status: 'preparing' }
    this.#schedule()
  }
  #schedule(delay = 150) {
    if (this.#controller.signal.aborted) return
    clearTimeout(this.#scheduled)
    this.#scheduled = setTimeout(() => {
      this.#scheduled = undefined
      if (this.#settledGoal === this.#state.goalRevision) return
      if (this.#busy || this.#reconciling) return this.#schedule()
      const job = this.#reconcile().finally(() => {
        if (this.#reconciling === job) this.#reconciling = undefined
      })
      this.#reconciling = job
    }, delay)
    this.#scheduled.unref?.()
  }
  async #reconcile() {
    while (!this.#controller.signal.aborted) {
      const goal = { revision: this.#state.goalRevision, ids: [...this.#state.desiredIds] }
      let plan,
        directory,
        prepared,
        previous,
        retained = false
      try {
        await this.#exclusive(async () => {
          this.#sync = { status: 'preparing' }
          const same = this.#state.activeProject && JSON.stringify(goal.ids) === JSON.stringify(this.#state.activeIds)
          if (same) directory = await this.#directory(this.#state.activeProject)
          else {
            const result = await this.#prepareSelection(goal.ids, this.#state.offline)
            plan = this.#plans.get(result.id)
            directory = await this.#directory(plan.project)
            if (goal.revision !== this.#state.goalRevision) return
            // Explicitly installing a package authorizes its declared dependency closure.
            await this.run(
              ['content', 'npm', 'approve', directory, '--profile', 'local-development'],
              this.#controller.signal,
            )
            await this.run(
              ['content', 'validate', ...(goal.ids.length ? ['--npm-project', directory] : [])],
              this.#controller.signal,
            )
          }
          if (goal.revision !== this.#state.goalRevision || this.#controller.signal.aborted) return
          // Only an explicitly started hosting process receives updates. Offline
          // content preparation never starts rooms, matchmaking or an HTTP server.
          if (this.host.status().status === 'running') {
            prepared = await this.host.prepareProject(directory, { builtinOnly: goal.ids.length === 0 })
            if (goal.revision !== this.#state.goalRevision || this.#controller.signal.aborted) return
            previous = await this.host.selectPrepared(prepared)
          }
          try {
            await this.#update(state => ({
              ...state,
              activeIds: goal.ids,
              activeProject: plan?.project ?? state.activeProject,
              activeGoalRevision: goal.revision,
              activeGraph: plan?.graph ?? state.activeGraph,
            }))
          } catch (error) {
            if (previous) await this.host.selectPrepared(previous)
            throw error
          }
          retained = true
          if (previous && prepared && previous.id !== prepared.id)
            await this.host.retirePrepared(previous).catch(() => {})
        })
        if (goal.revision === this.#state.goalRevision) {
          this.#settledGoal = goal.revision
          this.#sync = { status: 'ready' }
          return
        }
      } catch (error) {
        if (goal.revision === this.#state.goalRevision) {
          this.#settledGoal = goal.revision
          this.#sync = { status: 'failed', message: error.message || '内容准备失败，原有内容仍可用' }
          return
        }
      } finally {
        if (plan) this.#plans.delete(plan.id)
        if (!retained) {
          if (prepared) await this.host.retirePrepared(prepared).catch(() => {})
          if (plan && this.host.projectDirectory() !== directory)
            await rm(directory ?? join(this.root, 'projects', storageName(plan.project)), {
              recursive: true,
              force: true,
            }).catch(() => {})
        }
      }
    }
  }
  async start() {
    return this.#exclusive(async () => {
      if (!this.#state.activeProject) throw new Error('请先准备本机内容选择')
      const directory = await this.#directory(this.#state.activeProject)
      if (this.#controller.signal.aborted) throw new Error('内容包管理已关闭')
      return this.host.start(directory, { builtinOnly: this.#state.activeIds.length === 0 })
    })
  }
  async close() {
    this.#controller.abort()
    clearTimeout(this.#scheduled)
    await this.#reconciling
    await this.#idle
    await this.#writes
    for (const plan of this.#plans.values()) {
      await rm(join(this.root, 'projects', storageName(plan.project)), { recursive: true, force: true })
    }
    this.#plans.clear()
  }
}
