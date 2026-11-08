import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { get } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { managementRequest } from './desktop-management.mjs'
import { loadLocalServerProfile, saveLocalServerProject } from './local-server-profile.mjs'
import { desktopListener } from './desktop-listener.mjs'

const worker = fileURLToPath(new URL('./local-battle-worker.mjs', import.meta.url))

class LocalBattleHostError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'LocalBattleHostError'
    this.code = code
  }
}
const problem = (code, message) => new LocalBattleHostError(code, message)

/** Don't forward the desktop process's account tokens or arbitrary Node options. */
export function workerEnvironment(cache, npmCliPath, packsDirectory) {
  const result = {}
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'LANG']) {
    if (process.env[key]) result[key] = process.env[key]
  }
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH'
  result[pathKey] = process.env[pathKey] ?? process.env.PATH ?? ''
  return {
    ...result,
    ...(npmCliPath ? { ARCADIA_NPM_CLI: npmCliPath } : {}),
    ...(packsDirectory ? { ARCADIA_PACKS_DIR: packsDirectory } : {}),
    TMPDIR: cache,
    TMP: cache,
    TEMP: cache,
    ARCADIA_DESKTOP_TEMP: cache,
    ELECTRON_RUN_AS_NODE: '1',
    ACCOUNT_MODE: 'guest',
    DOTENV_CONFIG_PATH: join(cache, 'no-dotenv'),
    npm_config_cache: join(cache, 'npm-cache'),
    npm_config_userconfig: join(cache, 'no-user-npmrc'),
    npm_config_globalconfig: join(cache, 'no-global-npmrc'),
    npm_config_audit: 'false',
    npm_config_fund: 'false',
  }
}

async function verifyProject(directory) {
  if (typeof directory !== 'string' || !isAbsolute(directory))
    throw problem('PROJECT_INVALID', '请选择本机服务器项目目录')
  try {
    if (!(await stat(directory)).isDirectory()) throw new Error()
    for (const name of ['package.json', 'arcadia-admission.json'])
      if (!(await stat(join(directory, name))).isFile()) throw new Error()
    if (!(await stat(join(directory, 'node_modules'))).isDirectory()) throw new Error()
    try {
      if (!(await stat(join(directory, 'npm-shrinkwrap.json'))).isFile()) throw new Error()
    } catch {
      if (!(await stat(join(directory, 'package-lock.json'))).isFile()) throw new Error()
    }
  } catch {
    throw problem('PROJECT_NOT_READY', '项目需要已安装依赖、npm 锁文件和明确的代码准入记录')
  }
}

function verifyReady(url, serverId) {
  return new Promise((resolve, reject) => {
    const request = get(`${url}/api/v1/server-info`, { timeout: 4000 }, response => {
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error('Invalid status'))
        return
      }
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        body += chunk
        if (body.length > 16384) request.destroy(new Error('Response too large'))
      })
      response.on('end', () => {
        try {
          if (JSON.parse(body).serverId !== serverId) throw new Error('Incorrect server identity')
          resolve()
        } catch (error) {
          reject(error)
        }
      })
    })
    request.on('timeout', () => request.destroy(new Error('Health check timeout')))
    request.on('error', reject)
  })
}

/** One selected, already installed and approved project runs in a child process.
 * No renderer argument controls the executable, network interface, or shell command.
 */
export class LocalBattleHost {
  #state = { status: 'idle' }
  #child
  #closed
  #stopping
  #generation = 0
  #projectDirectory
  #projects = new Map()
  #uncertainProjects = new Set()
  #lastProject
  constructor({
    executable,
    cli,
    rendererOrigin,
    webRoot,
    npmCliPath,
    packsDirectory,
    stateDirectory,
    workspaceRoot,
    attachWorkspace,
    startupTimeoutMs = 60000,
    shutdownTimeoutMs = 5000,
  }) {
    this.executable = executable
    this.cli = cli
    this.rendererOrigin = rendererOrigin
    this.webRoot = webRoot
    this.npmCliPath = npmCliPath
    this.packsDirectory = packsDirectory
    this.stateDirectory = stateDirectory
    this.workspaceRoot = workspaceRoot
    this.attachWorkspace = attachWorkspace
    this.startupTimeoutMs = startupTimeoutMs
    this.shutdownTimeoutMs = shutdownTimeoutMs
  }
  status() {
    return structuredClone(this.#state)
  }
  projectDirectory() {
    return this.#child ? this.#projectDirectory : undefined
  }
  /** Private parent/child transport: the renderer cannot choose a remote endpoint. */
  async managementRequest(input) {
    return this.#request('management', { request: managementRequest(input) })
  }
  async #request(action, input = {}) {
    const child = this.#child
    if (!child?.connected || this.#state.status !== 'running') throw problem('HOST_UNAVAILABLE', '本机内容尚未就绪')
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => finish(problem('CONTENT_PREPARE_TIMEOUT', '内容准备超时，请重试')),
        this.startupTimeoutMs,
      )
      const finish = (error, value) => {
        clearTimeout(timeout)
        child.off('message', onMessage)
        child.off('close', onClose)
        if (error) reject(error)
        else resolve(value)
      }
      const onClose = () => finish(problem('HOST_UNAVAILABLE', '本机内容运行程序已退出'))
      const onMessage = message => {
        if (message?.type !== 'arcadia.desktop.content.result' || message.id !== id) return
        if (!message.ok) finish(problem('CONTENT_PREPARE_FAILED', '内容准备失败，原有对局和内容仍保留'))
        else finish(null, message.value)
      }
      child.on('message', onMessage)
      child.once('close', onClose)
      child.send({ type: 'arcadia.desktop.content', id, action, ...input }, error => {
        if (error) finish(problem('HOST_UNAVAILABLE', '无法准备本机内容'))
      })
    })
  }
  async prepareProject(directory) {
    const canonical = await realpath(directory)
    if (this.#state.status !== 'running') throw problem('HOST_UNAVAILABLE', '请先明确启动本机联机托管')
    this.#uncertainProjects.add(canonical)
    const descriptor = await this.#request('prepare', { directory: canonical })
    this.#uncertainProjects.delete(canonical)
    if (descriptor.packages.length) {
      const directories = this.#projects.get(descriptor.id) ?? new Set()
      directories.add(canonical)
      this.#projects.set(descriptor.id, directories)
    }
    return { id: descriptor.id, directory: canonical, started: false }
  }
  async selectPrepared(prepared) {
    const directory = this.#projectDirectory
    const previous = await this.#request('select', { environmentId: prepared.id })
    this.#projectDirectory = prepared.directory
    return { id: previous.id, directory }
  }
  async retirePrepared(prepared) {
    if (prepared) await this.#request('retire', { environmentId: prepared.id })
  }
  /** Includes retired environments until their final room/checkpoint/asset lease is released. */
  async retainedProjectDirectories() {
    if (!this.#child) return []
    const child = this.#child
    const ids = await this.#request('retained')
    if (child !== this.#child || !Array.isArray(ids) || ids.some(id => typeof id !== 'string'))
      throw problem('HOST_UNAVAILABLE', '无法确认内容使用状态')
    const retained = new Set(ids)
    for (const id of this.#projects.keys()) if (!retained.has(id)) this.#projects.delete(id)
    return [
      ...new Set([
        ...Array.from(this.#projects.values()).flatMap(directories => [...directories]),
        ...this.#uncertainProjects,
      ]),
    ]
  }
  /** Last resort during application shutdown; the child is already unresponsive. */
  forceStop() {
    ++this.#generation
    this.#child?.kill('SIGKILL')
  }
  async startLocalRecovery() {
    const saved =
      this.#lastProject ?? (this.stateDirectory ? await loadLocalServerProfile(this.stateDirectory) : undefined)
    if (!saved?.projectDirectory) throw problem('PROJECT_NOT_READY', '请先选择本机托管的内容或服务器项目')
    return this.start(saved.projectDirectory, { localRecovery: true })
  }
  async start(directory, { localRecovery = false, launch } = {}) {
    if (this.#child || ['starting', 'stopping', 'running'].includes(this.#state.status))
      throw problem('HOST_BUSY', '本机对战服务已经启动或正在启动')
    const generation = ++this.#generation
    this.#state = { status: 'starting' }
    let cache, spawnedChild
    try {
      try {
        await access(this.executable, constants.X_OK)
      } catch {
        throw problem('SERVER_RUNTIME_MISSING', '未找到本机对战服务运行程序')
      }
      try {
        await access(this.cli, constants.R_OK)
      } catch {
        throw problem('SERVER_RUNTIME_MISSING', '未找到打包的本机对战服务运行文件')
      }
      if (this.npmCliPath !== undefined) {
        try {
          if (!isAbsolute(this.npmCliPath) || !(await stat(this.npmCliPath)).isFile()) throw new Error()
          await access(this.npmCliPath, constants.R_OK)
        } catch {
          throw problem('NPM_RUNTIME_MISSING', '未找到打包的 npm 检查运行工具')
        }
      }
      if (this.packsDirectory !== undefined) {
        try {
          if (!isAbsolute(this.packsDirectory) || !(await stat(this.packsDirectory)).isDirectory()) throw new Error()
          if (!(await stat(join(this.packsDirectory, 'base', 'pack.json'))).isFile()) throw new Error()
          await access(join(this.packsDirectory, 'base', 'pack.json'), constants.R_OK)
        } catch {
          throw problem('BASE_PACK_MISSING', '未找到打包的官方基础内容')
        }
      }
      await verifyProject(directory)
      const projectDirectory = await realpath(directory)
      this.#lastProject = { projectDirectory }
      cache = await mkdtemp(join(tmpdir(), 'arcadia-desktop-server-'))
      if (generation !== this.#generation) throw problem('HOST_STOPPED', '本机对战服务已停止')
      const serverId = this.stateDirectory
        ? (await loadLocalServerProfile(this.stateDirectory)).serverId
        : `arcadia-desktop-${randomUUID()}`
      const managedNetwork = !!(this.stateDirectory && this.workspaceRoot)
      const child = spawn(
        this.executable,
        [
          worker,
          this.cli,
          'server',
          ...(managedNetwork
            ? ['--desktop-managed-network', '--desktop-origin', this.rendererOrigin]
            : ['--host', '127.0.0.1', '--port', '0', '--cors-origin', this.rendererOrigin]),
          ...(managedNetwork && localRecovery
            ? ['--host', '127.0.0.1', '--port', '0', '--cors-origin', this.rendererOrigin]
            : []),
          ...(managedNetwork && this.webRoot ? ['--web-root', this.webRoot] : []),
          ...(launch ? ['--desktop-launch', JSON.stringify(launch)] : []),
          '--server-id',
          serverId,
          ...(this.stateDirectory ? ['--data-dir', this.stateDirectory] : []),
          ...(this.workspaceRoot ? ['--workspace-root', this.workspaceRoot] : []),
          ...(this.workspaceRoot ? ['--desktop-project', projectDirectory] : []),
          '--npm-project',
          projectDirectory,
        ],
        {
          cwd: cache,
          env: { ...workerEnvironment(cache, this.npmCliPath, this.packsDirectory), ARCADIA_DESKTOP_CONTROL: '1' },
          stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
          windowsHide: true,
        },
      )
      spawnedChild = child
      const detachWorkspace = this.attachWorkspace?.(child)
      this.#child = child
      this.#projectDirectory = projectDirectory
      const done = new Promise(resolve => {
        child.once('close', (code, signal) => resolve({ code, signal }))
      }).then(async result => {
        detachWorkspace?.()
        await rm(cache, { recursive: true, force: true })
        return result
      })
      this.#closed = done
      void done.then(async ({ code, signal }) => {
        if (this.#child === child) {
          this.#child = undefined
          this.#closed = undefined
          if (this.#state.status === 'running')
            this.#state = {
              status: 'failed',
              code: 'SERVER_EXITED',
              message: `本机对战服务已退出（${code ?? signal ?? 'unknown'}）`,
            }
        }
      })
      // UGC output is not safe to expose to the renderer. Recognize only fixed
      // diagnostics from the host and discard the actual text.
      let stderr = ''
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', chunk => {
        stderr = (stderr + chunk).slice(-8192)
      })
      const listener = await new Promise((resolve, reject) => {
        let buffer = '',
          settled = false,
          checking = false
        const finish = (error, value) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          child.off('message', onListener)
          if (error) reject(error)
          else resolve(value)
        }
        const timeout = setTimeout(
          () => finish(problem('SERVER_START_TIMEOUT', '本机对战服务准备超时')),
          this.startupTimeoutMs,
        )
        const check = message => {
          if (checking || settled) return
          let listener
          try {
            listener = desktopListener(message, serverId)
          } catch {
            return finish(problem('SERVER_START_FAILED', '本机监听地址无效'))
          }
          checking = true
          // The trusted child emits this only after bind and management initialization.
          // A host may be unable to route to its own LAN address; keep owner controls
          // available without treating listener readiness as a remote reachability test.
          if (managedNetwork && listener.network.scope === 'network') return finish(null, listener)
          void verifyReady(listener.url, serverId).then(
            () => finish(null, listener),
            () => finish(problem('SERVER_START_FAILED', '本机对战服务就绪检查失败')),
          )
        }
        const onListener = message => {
          if (managedNetwork && message?.type === 'arcadia.desktop.listener') check(message)
        }
        child.on('message', onListener)
        child.once('error', () => finish(problem('SERVER_START_FAILED', '无法启动本机对战服务')))
        child.once('close', () => {
          if (stderr.includes('EADDRINUSE'))
            finish(problem('LISTENER_ADDRESS_IN_USE', '监听端口已被占用，可仅在本机启动以修复网络设置'))
          else if (stderr.includes('EADDRNOTAVAIL') || stderr.includes('ENOTFOUND'))
            finish(problem('LISTENER_ADDRESS_UNAVAILABLE', '配置的网卡地址不可用，可仅在本机启动以修复网络设置'))
          else if (stderr.includes('Expected an explicit npm project approval'))
            finish(problem('NPM_NOT_APPROVED', '项目缺少有效的代码准入记录'))
          else if (/spawn npm ENOENT/.test(stderr))
            finish(problem('NPM_RUNTIME_MISSING', '未找到可运行的 npm 检查工具'))
          else if (stderr.includes('npm rejected the installed dependency tree'))
            finish(problem('NPM_DEPENDENCIES_INVALID', '项目依赖不完整或与锁文件不一致'))
          else finish(problem('SERVER_START_FAILED', '本机对战服务准备失败，请检查已安装依赖和代码准入'))
        })
        child.stdout.setEncoding('utf8')
        child.stdout.on('data', chunk => {
          if (managedNetwork || checking || settled) return
          buffer = (buffer + chunk).slice(-8192)
          const line = `Battle server ${serverId} listening on port `
          const start = buffer.indexOf(line)
          if (start < 0) return
          const match = buffer.slice(start + line.length).match(/^(\d+)\r?\n/)
          if (!match) return
          const port = Number(match[1])
          if (!Number.isInteger(port) || port < 1 || port > 65535)
            return finish(problem('SERVER_START_FAILED', '本机端口无效'))
          check({ type: 'arcadia.desktop.listener', serverId, host: '127.0.0.1', port })
        })
      })
      if (generation !== this.#generation || this.#child !== child) throw problem('HOST_STOPPED', '本机对战服务已停止')
      if (localRecovery) listener.network.inviteUrls = []
      this.#state = {
        status: 'running',
        ...listener,
        ...(localRecovery ? { localRecovery: true } : {}),
        serverId,
        projectName: basename(directory),
      }
      this.#projects.clear()
      this.#uncertainProjects.clear()
      const descriptor = await this.#request('describe')
      this.#projects.set(descriptor.id, new Set([projectDirectory]))
      if (this.stateDirectory) await saveLocalServerProject(this.stateDirectory, projectDirectory)
      return this.status()
    } catch (error) {
      const wasCurrent = generation === this.#generation
      if (spawnedChild && this.#child === spawnedChild) await this.stop()
      else if (!spawnedChild && cache) await rm(cache, { recursive: true, force: true })
      const failure =
        error instanceof LocalBattleHostError ? error : problem('SERVER_START_FAILED', '无法启动本机对战服务')
      if (wasCurrent && (generation === this.#generation || generation + 1 === this.#generation))
        this.#state = { status: 'failed', code: failure.code, message: failure.message }
      throw failure
    }
  }
  /** Explicit owner stop first closes admission. Active games require a separate force choice. */
  async stopHosting({ force = false } = {}) {
    if (typeof force !== 'boolean') throw problem('INVALID_REQUEST', '停止选项无效')
    if (force) return this.stop()
    if (this.#state.status === 'running' && this.stateDirectory && this.workspaceRoot) {
      const response = await this.managementRequest({
        method: 'POST',
        path: `/servers/${encodeURIComponent(this.#state.serverId)}/drain`,
        body: { draining: true },
      })
      if (response.status !== 200 || !Number.isInteger(response.body?.activeBattles))
        throw problem('HOST_DRAIN_FAILED', '无法确认对局状态，请刷新后重试')
      if (response.body.activeBattles > 0)
        throw problem(
          'HOST_DRAINING',
          `已停止接纳新局，仍有 ${response.body.activeBattles} 场对战进行中。结束后再停止，或明确选择立即中断。`,
        )
    }
    return this.stop()
  }
  async stop() {
    if (this.#stopping) return this.#stopping
    const generation = ++this.#generation
    const child = this.#child,
      done = this.#closed
    if (!child || !done) {
      this.#state = { status: 'idle' }
      return this.status()
    }
    this.#state = { status: 'stopping' }
    const stopping = (async () => {
      child.kill('SIGTERM')
      let timer
      try {
        const exited = await Promise.race([
          done.then(() => true),
          new Promise(resolve => {
            timer = setTimeout(() => resolve(false), this.shutdownTimeoutMs)
          }),
        ])
        if (!exited) {
          child.kill('SIGKILL')
          let killTimer
          try {
            await Promise.race([
              done,
              new Promise((_, reject) => {
                killTimer = setTimeout(
                  () => reject(problem('HOST_STOP_FAILED', '本机对战服务未能退出')),
                  this.shutdownTimeoutMs,
                )
              }),
            ])
          } finally {
            clearTimeout(killTimer)
          }
        }
      } finally {
        clearTimeout(timer)
      }
      if (generation === this.#generation) {
        if (this.#child === child) this.#child = undefined
        this.#closed = undefined
        this.#state = { status: 'idle' }
      }
      return this.status()
    })()
    this.#stopping = stopping
    try {
      return await stopping
    } finally {
      if (this.#stopping === stopping) this.#stopping = undefined
    }
  }
}
