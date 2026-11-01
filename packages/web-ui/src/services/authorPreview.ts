import type { BattleMessage } from '@arcadia-eternity/const'
import type { IBattleSystem } from '@arcadia-eternity/interface'
import type { ServerEnvironmentContent } from '@arcadia-eternity/protocol'
import { validateEnvironmentContent } from './serverContentValidation'

/** The capability points only at a local, captured Node candidate. No UGC code enters the renderer. */
export function previewEndpoint(value: string): string {
  const url = new URL(value)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/[a-f0-9]{48}$/.test(url.pathname)
  )
    throw new Error('试玩地址无效，请从源项目重新准备试玩。')
  return url.href.replace(/\/$/, '')
}

export async function connectAuthorPreview(value: string, onFailure: (error: Error) => void = () => {}) {
  const endpoint = previewEndpoint(value)
  const controller = new AbortController()
  let cursor = 0,
    polling = false,
    disposed = false
  const listeners = new Set<(message: BattleMessage) => void>()
  async function request<T>(route: string, args?: unknown[], signal = controller.signal): Promise<T> {
    const response = await fetch(`${endpoint}/${route}`, {
      method: args ? 'POST' : 'GET',
      ...(args ? { body: JSON.stringify({ args }), headers: { 'content-type': 'application/json' } } : {}),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error ?? `试玩连接失败（${response.status}）`)
    return args ? (data.result as T) : (data as T)
  }
  const { content } = await request<{ content: ServerEnvironmentContent }>('content')
  validateEnvironmentContent(content)
  const initial = await request<{ cursor: number }>('open', [])
  cursor = initial.cursor
  const call = <T>(method: string, ...args: unknown[]) => request<T>(method, args)
  async function poll() {
    if (polling) return
    polling = true
    try {
      while (!disposed) {
        const batch = await request<{ cursor: number; events: { cursor: number; message: BattleMessage }[] }>(
          `events?after=${cursor}`,
        )
        for (const entry of batch.events) {
          cursor = entry.cursor
          for (const listener of listeners) listener(entry.message)
        }
        await new Promise<void>(resolve => setTimeout(resolve, 75))
      }
    } catch (error) {
      if (!disposed) onFailure(error instanceof Error ? error : new Error(String(error)))
    } finally {
      polling = false
    }
  }
  const system: IBattleSystem = {
    async ready() {
      await call('ready')
      void poll()
    },
    getState: (...args) => call('getState', ...args),
    getAvailableSelection: (...args) => call('getAvailableSelection', ...args),
    submitAction: (...args) => call('submitAction', ...args),
    BattleEvent(callback) {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },
    isTimerEnabled: () => call('isTimerEnabled'),
    getPlayerTimerState: (...args) => call('getPlayerTimerState', ...args),
    getAllPlayerTimerStates: () => call('getAllPlayerTimerStates'),
    getTimerConfig: () => call('getTimerConfig'),
    startAnimation: (...args) => call('startAnimation', ...args),
    endAnimation: (...args) => call('endAnimation', ...args),
    // Preview timers are disabled by the Node host.
    onTimerEvent: () => () => {},
    offTimerEvent() {},
    createRuntimeSnapshot: () => call('createRuntimeSnapshot'),
    restoreRuntimeSnapshot: (...args) => call('restoreRuntimeSnapshot', ...args),
    async cleanup() {
      if (disposed) return
      disposed = true
      controller.abort()
      listeners.clear()
      await request('cleanup', [], new AbortController().signal).catch(() => {})
    },
  }
  return { system, content }
}
