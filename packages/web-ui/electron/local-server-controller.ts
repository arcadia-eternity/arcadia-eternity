import { setTimeout as delay } from 'node:timers/promises'
import { loadLocalServerProfile, type LocalServerProfile } from './local-server-profile.ts'
import type { LocalBattleHost } from './local-battle-host.ts'
import type { LocalServerConfiguration, LocalServerRequest, LocalServerSnapshot } from '../src/types/localServer.ts'

const fail = (code: string, message: string) => Object.assign(new Error(message), { code })

interface ControllerOptions {
  host: Pick<LocalBattleHost, 'start' | 'stateDirectory' | 'status' | 'stopHosting'>
  defaultProject: () => string | undefined | Promise<string | undefined>
  profile?: () => Promise<Pick<LocalServerProfile, 'projectDirectory'>>
  wait?: () => Promise<void>
}

interface ValidatedRequest {
  action: LocalServerRequest['action']
  configuration?: unknown
  force?: boolean
}

/** User intent only: no executable, directory, arbitrary command or management target. */
export function launchConfiguration(value: unknown): LocalServerConfiguration {
  const input = value as Record<string, unknown> | null | undefined
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(key => !['name', 'scope', 'port', 'publicOrigin'].includes(key))
  )
    throw fail('INVALID_LAUNCH', '开服设置无效')
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80)
    throw fail('INVALID_LAUNCH', '请输入 1–80 个字符的服务器名称')
  if (
    (input.scope !== 'local' && input.scope !== 'lan' && input.scope !== 'public') ||
    typeof input.port !== 'number' ||
    !Number.isInteger(input.port) ||
    input.port < 0 ||
    input.port > 65535
  )
    throw fail('INVALID_LAUNCH', '连接范围或端口无效')
  let publicOrigin
  if (input.scope === 'public') {
    try {
      const url = new URL(input.publicOrigin as string)
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
    ...(publicOrigin ? { publicOrigin } : {}),
  }
}

/** Owns preparation/start/drain/restart. Status polling never starts a process. */
export class LocalServerController {
  #operation: Promise<void> | undefined
  #action: LocalServerRequest['action'] | undefined
  #closed = false
  #cancelRestart = false
  #phase: LocalServerSnapshot['phase'] = 'idle'
  #error: LocalServerSnapshot['error']
  declare readonly host: ControllerOptions['host']
  declare readonly defaultProject: ControllerOptions['defaultProject']
  declare profile: NonNullable<ControllerOptions['profile']>
  declare readonly wait: NonNullable<ControllerOptions['wait']>
  constructor({
    host,
    defaultProject,
    profile = () => loadLocalServerProfile(host.stateDirectory!),
    wait = () => delay(1000),
  }: ControllerOptions) {
    this.host = host
    this.defaultProject = defaultProject
    this.profile = profile
    this.wait = wait
  }
  async snapshot(): Promise<LocalServerSnapshot> {
    const profile = await this.profile()
    return {
      host: this.host.status(),
      phase: this.#phase,
      configured: !!profile.projectDirectory,
      ...(this.#error ? { error: this.#error } : {}),
    }
  }
  async request(value: unknown, { firstLaunchOnly = false } = {}): Promise<LocalServerSnapshot> {
    const input = value as Partial<ValidatedRequest> | null | undefined
    if (
      !input ||
      typeof input !== 'object' ||
      input.action === undefined ||
      !['status', 'start', 'stop', 'restart', 'recover'].includes(input.action)
    )
      throw fail('INVALID_REQUEST', '服务器操作无效')
    const keys =
      input.action === 'start'
        ? ['action', 'configuration']
        : input.action === 'stop'
          ? ['action', 'force']
          : ['action']
    if (
      Object.keys(input).some(key => !keys.includes(key)) ||
      (input.force !== undefined && typeof input.force !== 'boolean')
    )
      throw fail('INVALID_REQUEST', '服务器操作参数无效')
    if (input.configuration !== undefined) launchConfiguration(input.configuration)
    if (input.action === 'status') return this.snapshot()
    if (this.#closed) throw fail('HOST_CLOSED', '客户端正在退出')
    if (this.#operation) {
      if (input.action === 'stop' && input.force === true && this.#phase === 'draining') {
        this.#cancelRestart = true
        await this.host.stopHosting({ force: true })
      } else if (input.action !== 'start' || this.#action !== 'start' || firstLaunchOnly)
        throw fail('HOST_BUSY', '请等待当前服务器操作完成')
      await this.#operation
      return this.snapshot()
    }
    const previousError = this.#error
    this.#error = undefined
    this.#action = input.action
    this.#cancelRestart = false
    this.#operation = this.#run(input as ValidatedRequest, firstLaunchOnly)
      .catch(error => {
        if (error.code === 'SERVER_ALREADY_CONFIGURED') {
          this.#error = previousError
          throw error
        }
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
        if ((error as NodeJS.ErrnoException).code !== 'HOST_DRAINING') throw error
        await this.wait()
      }
    }
    this.#phase = 'idle'
  }
  async #run(input: ValidatedRequest, firstLaunchOnly: boolean) {
    if (input.action === 'stop') return this.#stop(input.force)
    if (input.action === 'restart') {
      await this.#stop(false)
      if (!this.#cancelRestart && !this.#closed) return this.#start()
      return
    }
    return this.#start(input.configuration, firstLaunchOnly, input.action === 'recover')
  }
  async #start(configuration?: unknown, firstLaunchOnly = false, localRecovery = false) {
    const profile = await this.profile()
    const running = this.host.status().status === 'running'
    if (firstLaunchOnly && (running || profile.projectDirectory)) {
      throw fail('SERVER_ALREADY_CONFIGURED', '服务器已有启动设置，请省略开服参数；可在服务器管理中修改已保存的设置')
    }
    if (running) {
      this.#phase = 'ready'
      return
    }
    // Quick start can arrive before the renderer has read the saved profile.
    const config = !profile.projectDirectory && configuration ? launchConfiguration(configuration) : undefined
    if (!profile.projectDirectory && !config && !localRecovery)
      throw fail('LAUNCH_REQUIRED', '请先设置服务器名称与连接范围')
    this.#phase = 'preparing'
    const directory = await this.defaultProject()
    if (!directory) throw fail('CONTENT_NOT_READY', '官方基础环境尚未就绪')
    if (this.#closed) throw fail('HOST_CLOSED', '客户端正在退出')
    this.#phase = 'starting'
    await this.host.start(directory, {
      publishClientEnvironments: true,
      ...(localRecovery ? { localRecovery: true } : {}),
      ...(config
        ? {
            launch: {
              name: config.name,
              host: config.scope === 'local' ? '127.0.0.1' : '0.0.0.0',
              port: config.port,
              publicOrigin: config.publicOrigin ?? null,
            },
          }
        : {}),
    })
    this.#phase = 'ready'
  }
}
