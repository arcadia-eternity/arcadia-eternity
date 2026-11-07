import { setTimeout as delay } from 'node:timers/promises'
import { loadLocalServerProfile } from './local-server-profile.mjs'

const fail = (code, message) => Object.assign(new Error(message), { code })

/** User intent only: no executable, directory, arbitrary command or management target. */
export function launchConfiguration(input) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(key => !['name', 'scope', 'port', 'publicOrigin', 'content'].includes(key))
  )
    throw fail('INVALID_LAUNCH', '开服设置无效')
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80)
    throw fail('INVALID_LAUNCH', '请输入 1–80 个字符的服务器名称')
  if (
    !['local', 'lan', 'public'].includes(input.scope) ||
    !Number.isInteger(input.port) ||
    input.port < 0 ||
    input.port > 65535 ||
    !['official', 'current', 'saved'].includes(input.content)
  )
    throw fail('INVALID_LAUNCH', '连接范围、端口或玩法选择无效')
  let publicOrigin
  if (input.scope === 'public') {
    try {
      const url = new URL(input.publicOrigin)
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash
      )
        throw new Error()
      publicOrigin = url.origin
    } catch {
      throw fail('INVALID_LAUNCH', '请输入完整的公网 HTTP 或 HTTPS 主机地址')
    }
  }
  return {
    name: input.name.trim(),
    scope: input.scope,
    port: input.port,
    content: input.content,
    ...(publicOrigin ? { publicOrigin } : {}),
  }
}

/** Owns preparation/start/drain/restart. Status polling never starts a process. */
export class LocalServerController {
  #operation
  #action
  #closed = false
  #cancelRestart = false
  #phase = 'idle'
  #error
  constructor({
    host,
    library,
    startProject,
    profile = () => loadLocalServerProfile(host.stateDirectory),
    wait = () => delay(1000),
  }) {
    this.host = host
    this.library = library
    this.startProject = startProject
    this.profile = profile
    this.wait = wait
  }
  async snapshot() {
    const profile = await this.profile()
    return {
      host: this.host.status(),
      phase: this.#phase,
      configured: !!profile.projectDirectory,
      ...(this.#error ? { error: this.#error } : {}),
    }
  }
  async request(input) {
    if (
      !input ||
      typeof input !== 'object' ||
      !['status', 'start', 'start-project', 'stop', 'restart', 'recover'].includes(input.action)
    )
      throw fail('INVALID_REQUEST', '服务器操作无效')
    const keys =
      input.action === 'start'
        ? ['action', 'configuration']
        : input.action === 'start-project'
          ? ['action', 'projectId']
          : input.action === 'stop'
            ? ['action', 'force']
            : ['action']
    if (
      Object.keys(input).some(key => !keys.includes(key)) ||
      (input.force !== undefined && typeof input.force !== 'boolean')
    )
      throw fail('INVALID_REQUEST', '服务器操作参数无效')
    if (
      input.action === 'start-project' &&
      (typeof input.projectId !== 'string' || !input.projectId || input.projectId.length > 200)
    )
      throw fail('INVALID_REQUEST', '请选择已登记项目')
    if (input.configuration !== undefined) launchConfiguration(input.configuration)
    if (input.action === 'status') return this.snapshot()
    if (this.#closed) throw fail('HOST_CLOSED', '客户端正在退出')
    if (this.#operation) {
      if (input.action === 'stop' && input.force === true && this.#phase === 'draining') {
        this.#cancelRestart = true
        await this.host.stopHosting({ force: true })
      } else if (input.action !== 'start' || this.#action !== 'start')
        throw fail('HOST_BUSY', '请等待当前服务器操作完成')
      await this.#operation
      return this.snapshot()
    }
    this.#error = undefined
    this.#action = input.action
    this.#cancelRestart = false
    this.#operation = this.#run(input)
      .catch(error => {
        this.#error = { code: error.code ?? 'HOST_FAILED', message: error.message || '服务器操作失败' }
        this.#phase = 'failed'
      })
      .finally(() => {
        this.#operation = undefined
      })
    await this.#operation
    return this.snapshot()
  }
  close() {
    this.#closed = true
    this.#cancelRestart = true
  }
  async #stop(force = false) {
    if (typeof force !== 'boolean') throw fail('INVALID_REQUEST', '停止选项无效')
    this.#phase = 'draining'
    while (true) {
      try {
        await this.host.stopHosting({ force })
        break
      } catch (error) {
        if (error.code !== 'HOST_DRAINING') throw error
        await this.wait()
      }
    }
    this.#phase = 'idle'
  }
  async #run(input) {
    if (input.action === 'start-project') {
      if (!this.startProject) throw fail('UNSUPPORTED', '此宿主不支持项目启动')
      if (this.host.status().status === 'running') throw fail('HOST_RUNNING', '请先在服务器页停止当前托管')
      this.#phase = 'starting'
      await this.startProject(input.projectId)
      this.#phase = 'ready'
      return
    }
    if (input.action === 'stop') return this.#stop(input.force)
    if (input.action === 'restart') {
      await this.#stop(false)
      if (!this.#cancelRestart && !this.#closed) return this.#start()
      return
    }
    if (input.action === 'recover') {
      this.#phase = 'starting'
      await this.host.startLocalRecovery()
      this.#phase = 'ready'
      return
    }
    return this.#start(input.configuration)
  }
  async #start(configuration) {
    if (this.host.status().status === 'running') {
      this.#phase = 'ready'
      return
    }
    const config = configuration === undefined ? undefined : launchConfiguration(configuration)
    const profile = await this.profile()
    if (profile.projectDirectory && config && config.content !== 'saved')
      throw fail('CONTENT_ALREADY_CONFIGURED', '服务器已有独立玩法，请在“玩法与版本”中修改')
    if (!profile.projectDirectory && (!config || config.content === 'saved'))
      throw fail('LAUNCH_REQUIRED', '请先选择服务器名称、玩法与连接范围')
    this.#phase = 'preparing'
    let lease
    try {
      if (!profile.projectDirectory) {
        const library = this.library()
        if (config.content === 'current') {
          const snapshot = await library.list()
          if (
            snapshot.selection.status === 'preparing' ||
            snapshot.selection.status === 'failed' ||
            (snapshot.desiredIds?.length && !snapshot.hasSelection)
          )
            throw fail('CONTENT_NOT_READY', snapshot.selection.message || '本地玩法尚未准备完成，请在内容库完成准备')
          lease = await library.acquireProject()
        } else lease = await library.acquireDefaultProject()
        if (!lease.directory) throw fail('CONTENT_NOT_READY', '请先准备所选内容环境')
      }
      if (this.#closed) throw fail('HOST_CLOSED', '客户端正在退出')
      this.#phase = 'starting'
      await this.host.start(profile.projectDirectory ?? lease.directory, {
        ...(config
          ? {
              launch: {
                name: config.name,
                host: config.scope === 'local' ? '127.0.0.1' : '0.0.0.0',
                port: config.port,
                publicOrigin: config.publicOrigin ?? null,
                ...(config.content === 'official' ? { officialContent: true } : {}),
              },
            }
          : {}),
      })
      this.#phase = 'ready'
    } finally {
      await lease?.release()
    }
  }
}
