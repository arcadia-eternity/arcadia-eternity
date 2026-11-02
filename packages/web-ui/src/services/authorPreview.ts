import { Type } from '@sinclair/typebox'
import { PlayerSchema, PetSchema, parseWithErrors, type PlayerSchemaType } from '@arcadia-eternity/schema'
import type { NativeWebBattleConfig } from './nativeBattleFactory'
import { nanoid } from 'nanoid'
import type { BattleMessage, Events } from '@arcadia-eternity/const'
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

async function previewRequest<T>(
  endpoint: string,
  route: string,
  args?: unknown[],
  signal = new AbortController().signal,
): Promise<T> {
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

export async function loadAuthorPreviewSetup(value: string) {
  const result = await previewRequest<{
    content: ServerEnvironmentContent
    players: PlayerSchemaType[]
    active: boolean
    warning?: string
    candidate?: { environmentId?: string; environmentConfigVersion?: string | null }
  }>(previewEndpoint(value), 'content')
  validateEnvironmentContent(result.content)
  if (!Array.isArray(result.players) || result.players.length !== 2) throw new Error('项目需要配置双方默认队伍')
  const players = result.players.map(player =>
    parseWithErrors(Type.Object({ ...PlayerSchema.properties, team: Type.Array(PetSchema, { maxItems: 6 }) }), {
      ...player,
      id: player.id ?? nanoid(),
      team: player.team.map(pet => ({ ...pet, id: pet.id ?? nanoid() })),
    }),
  )
  return { ...result, players }
}

export async function configureAuthorPreview(
  value: string,
  players: PlayerSchemaType[],
  options: NativeWebBattleConfig = {},
) {
  return previewRequest(previewEndpoint(value), 'configure', [players, options])
}

export async function connectAuthorPreview(value: string, onFailure: (error: Error) => void = () => {}) {
  const endpoint = previewEndpoint(value)
  const controller = new AbortController()
  let cursor = 0,
    polling = false,
    disposed = false
  const timerListeners = new Map<keyof Events, Set<(data: never) => void>>()
  const listeners = new Set<(message: BattleMessage) => void>()
  const request = <T>(route: string, args?: unknown[]) => previewRequest<T>(endpoint, route, args, controller.signal)
  const { content } = await request<{ content: ServerEnvironmentContent }>('content')
  validateEnvironmentContent(content)
  const initial = await request<{ cursor: number; outcome?: { winner: string | null } }>('open', [])
  cursor = initial.cursor
  const call = <T>(method: string, ...args: unknown[]) => request<T>(method, args)
  async function poll() {
    if (polling) return
    polling = true
    try {
      while (!disposed) {
        const batch = await request<{
          cursor: number
          events: { cursor: number; message?: BattleMessage; timer?: { type: keyof Events; data: unknown } }[]
        }>(`events?after=${cursor}`)
        for (const entry of batch.events) {
          cursor = entry.cursor
          if (entry.message) for (const listener of listeners) listener(entry.message)
          if (entry.timer)
            for (const listener of timerListeners.get(entry.timer.type) ?? []) listener(entry.timer.data as never)
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
    onTimerEvent(type, handler) {
      let handlers = timerListeners.get(type)
      if (!handlers) timerListeners.set(type, (handlers = new Set()))
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    offTimerEvent(type, handler) {
      timerListeners.get(type)?.delete(handler)
    },
    createRuntimeSnapshot: () => call('createRuntimeSnapshot'),
    restoreRuntimeSnapshot: (...args) => call('restoreRuntimeSnapshot', ...args),
    async cleanup() {
      if (disposed) return
      disposed = true
      controller.abort()
      listeners.clear()
      timerListeners.clear()
      await previewRequest(endpoint, 'cleanup', []).catch(() => {})
    },
  }
  return { system, content, outcome: initial.outcome }
}
