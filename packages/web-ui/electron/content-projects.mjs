import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { workerEnvironment } from './local-battle-host.mjs'

const worker = fileURLToPath(new URL('./local-battle-worker.mjs', import.meta.url))
async function jsonFile(file, limit = 1024 * 1024) {
  const info = await lstat(file)
  if (!info.isFile() || info.size > limit) throw new Error('项目文件不是有效的 JSON 文件')
  return JSON.parse(await readFile(file, 'utf8'))
}
async function exists(file) {
  try {
    await lstat(file)
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

/** Fixed CLI arguments are built by the main process; renderer input never becomes a command. */
export async function runContentCommand(runtime, args, signal) {
  if (signal?.aborted) throw new Error('内容操作已取消')
  const cache = await mkdtemp(join(tmpdir(), 'arcadia-content-manager-'))
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(runtime.executable, [worker, runtime.cli, ...args, '--json'], {
        cwd: cache,
        env: {
          ...workerEnvironment(cache, runtime.npmCliPath, runtime.packsDirectory),
          ...(runtime.npmCacheDirectory ? { npm_config_cache: runtime.npmCacheDirectory } : {}),
        },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        windowsHide: true,
      })
      let output = '',
        failed = false,
        killTimeout
      const abort = () => {
        if (failed) return
        failed = true
        child.kill('SIGTERM')
        killTimeout = setTimeout(() => child.kill('SIGKILL'), 5000)
      }
      const timeout = setTimeout(abort, 120000)
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort()
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', chunk => {
        output += chunk
        if (output.length > 16 * 1024 * 1024) abort()
      })
      // Drain, but do not forward arbitrary dependency/effect output to the renderer.
      child.stderr.resume()
      child.once('error', () => {
        clearTimeout(timeout)
        clearTimeout(killTimeout)
        signal?.removeEventListener('abort', abort)
        reject(new Error('无法启动内容管理工具，请检查桌面运行时'))
      })
      child.once('close', code => {
        clearTimeout(timeout)
        clearTimeout(killTimeout)
        signal?.removeEventListener('abort', abort)
        if (failed) return reject(new Error('操作已取消、超时或输出过大；请检查项目后重试'))
        try {
          const value = JSON.parse(output)
          if (code !== 0 || value.format === 'arcadia.cli.error') {
            const diagnostic = value.diagnostics?.[0]
            throw new Error(`${diagnostic?.code ?? 'CONTENT_FAILED'}：${diagnostic?.message ?? '内容操作失败'}`)
          }
          resolve(value)
        } catch (error) {
          reject(error instanceof SyntaxError ? new Error('内容管理工具返回了无效结果') : error)
        }
      })
    })
  } finally {
    await rm(cache, { recursive: true, force: true })
  }
}

/** Named registrations of user-selected npm projects. Removing a registration never deletes a project. */
export class ContentProjectManager {
  #entries
  #loading
  #inspections = new Map()
  #busy = false
  #activeId
  #idle
  #controller = new AbortController()
  constructor({ file, host, run }) {
    this.file = file
    this.host = host
    this.run = run
  }
  async close() {
    this.#controller.abort()
    await this.#idle
  }
  async #load() {
    if (this.#entries) return
    this.#loading ??= (async () => {
      let entries
      try {
        entries = await jsonFile(this.file)
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
        entries = []
      }
      if (
        !Array.isArray(entries) ||
        entries.length > 100 ||
        entries.some(
          entry =>
            !entry ||
            typeof entry.id !== 'string' ||
            typeof entry.name !== 'string' ||
            typeof entry.directory !== 'string' ||
            !isAbsolute(entry.directory),
        )
      )
        throw new Error('本机项目目录记录无效')
      this.#entries = entries
    })().catch(error => {
      this.#loading = undefined
      throw error
    })
    await this.#loading
  }
  async #save(entries) {
    await mkdir(dirname(this.file), { recursive: true })
    const temp = `${this.file}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, JSON.stringify(entries, null, 2), { flag: 'wx' })
      await rename(temp, this.file)
      this.#entries = entries
    } finally {
      await rm(temp, { force: true })
    }
  }
  async #exclusive(action) {
    if (this.#controller.signal.aborted) throw new Error('内容管理已关闭')
    if (this.#busy) throw new Error('另一项内容操作正在进行，请稍候')
    this.#busy = true
    let settled
    this.#idle = new Promise(resolve => {
      settled = resolve
    })
    try {
      await this.#load()
      if (this.#controller.signal.aborted) throw new Error('内容管理已关闭')
      return await action()
    } finally {
      this.#busy = false
      settled()
    }
  }
  async #entry(id) {
    await this.#load()
    const entry = this.#entries.find(entry => entry.id === id)
    if (!entry) throw new Error('未登记此本机项目')
    return entry
  }
  async #directory(entry) {
    if ((await realpath(entry.directory)) !== entry.directory) throw new Error('项目目录已改变，请重新登记')
    return entry.directory
  }
  #running(entry) {
    return this.host.projectDirectory
      ? this.host.projectDirectory() === entry.directory
      : this.host.status().status === 'running' && this.#activeId === entry.id
  }
  async list() {
    await this.#load()
    return Promise.all(
      this.#entries.map(async entry => {
        try {
          const manifest = await jsonFile(join(entry.directory, 'package.json'))
          const installed = await exists(join(entry.directory, 'node_modules'))
          const approvalFile = join(entry.directory, 'arcadia-admission.json')
          let approved = false
          try {
            const admission = await jsonFile(approvalFile)
            approved =
              admission.format === 'arcadia.npm-admission' &&
              admission.version === 2 &&
              ['local-development', 'self-hosted', 'official'].includes(admission.profile)
          } catch (error) {
            if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
          }
          return {
            ...entry,
            installed,
            approved,
            exported: await exists(join(entry.directory, 'arcadia-deployment.json')),
            dependencies: { ...manifest.dependencies, ...manifest.optionalDependencies },
            inspection: this.#inspections.get(entry.id),
            running: this.#running(entry),
          }
        } catch {
          return {
            ...entry,
            installed: false,
            approved: false,
            dependencies: {},
            running: false,
            error: '项目目录或文件不可用，请恢复项目后重试',
          }
        }
      }),
    )
  }
  async add(directory) {
    return this.#exclusive(async () => {
      const root = await realpath(directory)
      const manifest = await jsonFile(join(root, 'package.json'))
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
        throw new Error('项目清单必须是 JSON 对象')
      const lock = (await exists(join(root, 'npm-shrinkwrap.json'))) ? 'npm-shrinkwrap.json' : 'package-lock.json'
      if (!(await exists(join(root, lock)))) throw new Error('请选择包含 npm 锁文件的服务器项目')
      await jsonFile(join(root, lock), 32 * 1024 * 1024)
      const previous = this.#entries.find(entry => entry.directory === root)
      if (previous) return previous.id
      if (this.#entries.length >= 100) throw new Error('本机项目数量已达上限')
      const entry = { id: randomUUID(), name: basename(root), directory: root }
      await this.#save([...this.#entries, entry])
      return entry.id
    })
  }
  async rename(id, name) {
    return this.#exclusive(async () => {
      await this.#entry(id)
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 80)
        throw new Error('项目名称需要 1–80 个字符')
      await this.#save(this.#entries.map(entry => (entry.id === id ? { ...entry, name: name.trim() } : entry)))
    })
  }
  async forget(id) {
    return this.#exclusive(async () => {
      const entry = await this.#entry(id)
      if (this.#running(entry)) throw new Error('请先停止此项目的本机服务')
      await this.#save(this.#entries.filter(entry => entry.id !== id))
      this.#inspections.delete(id)
    })
  }
  async operate(id, action, options = {}) {
    return this.#exclusive(async () => {
      const entry = await this.#entry(id)
      const directory = await this.#directory(entry)
      const args = {
        inspect: ['content', 'npm', 'inspect', directory],
        install: ['content', 'npm', 'install', directory, ...(options.offline === true ? ['--offline'] : [])],
        approve: ['content', 'npm', 'approve', directory, '--profile', 'local-development'],
        validate: ['content', 'validate', '--npm-project', directory],
        verify: ['content', 'project', 'verify', directory],
      }
      if (!Object.hasOwn(args, action)) throw new Error('不支持的内容操作')
      if (['install', 'approve'].includes(action) && this.#running(entry)) throw new Error('请先停止此项目的本机服务')
      if (['inspect', 'install'].includes(action)) this.#inspections.delete(id)
      const result = await this.run(args[action], this.#controller.signal)
      if (action === 'inspect' || action === 'install') {
        if (result.format !== 'arcadia.npm-installation' || !Array.isArray(result.packages))
          throw new Error('内容检查结果无效')
        this.#inspections.set(id, {
          checkedAt: new Date().toISOString(),
          digest: result.digest,
          contentIds: Object.fromEntries(
            ['species', 'skills', 'marks'].map(kind => [
              kind,
              result.packages.flatMap(pkg =>
                pkg.manifest && pkg.draft
                  ? (pkg.draft.data[kind] ?? []).map(record => `${pkg.manifest.namespace}:${record.id}`)
                  : [],
              ),
            ]),
          ),
          packages: result.packages.map(pkg => ({
            name: pkg.name,
            version: pkg.version,
            location: pkg.location,
            dependencies: pkg.dependencies,
            integrity: pkg.integrity,
            ...(pkg.manifest
              ? {
                  projectId: pkg.manifest.projectId,
                  namespace: pkg.manifest.namespace,
                  containsCode: !!pkg.manifest.effects,
                }
              : {}),
          })),
        })
      }
      return result.format
    })
  }
  async start(id) {
    return this.#exclusive(async () => {
      const entry = await this.#entry(id)
      const directory = await this.#directory(entry)
      if (this.#controller.signal.aborted) throw new Error('内容管理已关闭')
      const result = await this.host.start(directory)
      this.#activeId = id
      return result
    })
  }
  async export(id, destination, includeLocalArtifacts) {
    return this.#exclusive(async () => {
      const entry = await this.#entry(id)
      if (typeof destination !== 'string' || !isAbsolute(destination)) throw new Error('请选择导出目标目录')
      await this.run(
        [
          'content',
          'project',
          'export',
          await this.#directory(entry),
          destination,
          ...(includeLocalArtifacts === true ? ['--include-local-artifacts'] : []),
        ],
        this.#controller.signal,
      )
    })
  }
}
