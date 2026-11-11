import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { WorkspaceError } from './workspace.ts'
import { playersFromTeams, type ProjectTeam } from './project-teams.ts'
import type { prepareContentPack } from './testing.ts'
import { errorCode, errorMessage, isRecord, type UnknownRecord } from './types.ts'

const operations = new Set(['create', 'read', 'events', 'action', 'reset', 'close'])
const idPattern = /^[a-z0-9][a-z0-9_-]{0,79}$/
function fail(code: string, message: string): never {
  throw new WorkspaceError(code, message)
}

type PreviewPrepared = Awaited<ReturnType<typeof prepareContentPack>>
type BattleSystem = Awaited<ReturnType<PreviewPrepared['createBattleSession']>>
type PendingDecision = Awaited<ReturnType<BattleSystem['waitForPendingDecision']>>

interface AutomationEntry {
  seed: string
  teamIds: string[]
  teamVersions: Record<string, string>
  sessionId: string
  revision: number
  playerId: string
  system: BattleSystem
  events: Array<{ cursor: number; revision: number; message: unknown }>
  cursor: number
  eventFloor: number
  failure?: { code: string; message: string }
  lastState?: unknown
  unsubscribe?: () => void
}

function setup(input: unknown): { teamIds: string[]; seed: string } {
  if (
    !isRecord(input) ||
    !Array.isArray(input.teamIds) ||
    input.teamIds.length !== 2 ||
    input.teamIds.some((id: unknown) => typeof id !== 'string' || !idPattern.test(id))
  )
    fail('BATTLE_INPUT_INVALID', '请选择两个已保存的项目队伍标识')
  if (typeof input.seed !== 'string' || !input.seed.length || input.seed.length > 200)
    fail('BATTLE_INPUT_INVALID', '自动调试需要 1–200 字符的固定随机种子')
  return { teamIds: [...(input.teamIds as string[])], seed: input.seed }
}

/** Independent battles over the captured candidate. Never receives the human preview's host or drafts. */
export class PreviewAutomation {
  prepared: PreviewPrepared
  readTeams: () => Promise<ProjectTeam[]>
  #sessions = new Map<string, AutomationEntry>()
  #queue: Promise<unknown> = Promise.resolve()
  #closed = false
  constructor(
    prepared: PreviewPrepared,
    { readTeams = async () => prepared.teams }: { readTeams?: () => Promise<ProjectTeam[]> } = {},
  ) {
    this.prepared = prepared
    this.readTeams = readTeams
  }
  call(operation: string, input: unknown = {}): Promise<unknown> {
    if (!operations.has(operation))
      return Promise.reject(new WorkspaceError('BATTLE_OPERATION_INVALID', '不支持的战斗调试操作'))
    if (!input || typeof input !== 'object' || Array.isArray(input))
      return Promise.reject(new WorkspaceError('BATTLE_INPUT_INVALID', '战斗参数需要对象'))
    const next = this.#queue
      .catch(() => {})
      .then(async () => {
        if (this.#closed) fail('BATTLE_HOST_CLOSED', '试玩宿主已关闭')
        return this.#call(operation, input as UnknownRecord)
      })
    this.#queue = next
    return next
  }
  async #create(input: unknown = undefined, previous?: AutomationEntry): Promise<AutomationEntry> {
    const config = setup(input)
    const teams = await this.readTeams()
    const players = playersFromTeams(teams, config.teamIds)
    const teamVersions = Object.fromEntries(
      config.teamIds.map(id => [id, teams.find(team => team.id === id)?.version]),
    ) as Record<string, string>
    const system = await this.prepared.createBattleSession(config.seed, {
      ai: true,
      players,
      // IDs from the saved teams are deterministic and local to this separate battle.
      runtimeIds: false,
      battleOptions: { timerConfig: { enabled: false } },
    })
    const entry: AutomationEntry = {
      ...config,
      teamVersions,
      sessionId: previous?.sessionId ?? randomUUID(),
      revision: previous ? previous.revision + 1 : 0,
      playerId: (await system.getState(undefined, true)).players[0].id,
      system,
      events: [],
      cursor: previous?.cursor ?? 0,
      eventFloor: previous?.cursor ?? 0,
    }
    entry.unsubscribe = entry.system.BattleEvent(
      (message: unknown) => {
        entry.events.push({ cursor: ++entry.cursor, revision: entry.revision, message })
        if (entry.events.length > 4096) entry.eventFloor = entry.events.shift()?.cursor ?? entry.eventFloor
      },
      { showHidden: true },
    )
    try {
      await this.#bounded(entry, () => entry.system.ready())
      entry.lastState = await entry.system.getState(undefined, true)
      return entry
    } catch (error) {
      await this.#dispose(entry)
      throw error
    }
  }
  async #bounded<T>(entry: AutomationEntry, action: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        action(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new WorkspaceError('BATTLE_TIMEOUT', '战斗未到达下一个决策点；此自动调试对局已关闭')),
            10000,
          )
        }),
      ])
    } catch (error) {
      if (errorCode(error) === 'BATTLE_TIMEOUT') {
        if (this.#sessions.get(entry.sessionId) === entry) this.#sessions.delete(entry.sessionId)
        await this.#dispose(entry)
      }
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
  async #dispose(entry: AutomationEntry): Promise<void> {
    await entry.system.cleanup()
  }
  async #read(entry: AutomationEntry) {
    let pending: PendingDecision | undefined
    if (!entry.failure) {
      try {
        pending = await this.#bounded(entry, () => entry.system.waitForPendingDecision())
        entry.lastState = await entry.system.getState(undefined, true)
      } catch (error) {
        if (errorCode(error) === 'BATTLE_TIMEOUT') throw error
        // Keep revision and evidence discoverable after engine failure so reset/close remain version checked.
        entry.failure = {
          code: errorCode(error) ?? 'BATTLE_EXECUTION_FAILED',
          message: errorMessage(error),
        }
        await this.#dispose(entry)
      }
    }
    const failure = entry.failure
    return {
      sessionId: entry.sessionId,
      revision: entry.revision,
      seed: entry.seed,
      teamIds: [...entry.teamIds],
      teamVersions: { ...entry.teamVersions },
      playerId: entry.playerId,
      state: entry.lastState,
      stateCurrent: !failure,
      ...(failure ? { failure } : {}),
      selections: failure ? [] : (pending?.selections[0] ?? []),
      cursor: entry.cursor,
    }
  }
  async #call(operation: string, input: UnknownRecord): Promise<unknown> {
    if (operation === 'create') {
      if (this.#sessions.size >= 4) fail('BATTLE_SESSION_LIMIT', '请先关闭一个自动调试对局（最多四个）')
      const entry = await this.#create(input)
      this.#sessions.set(entry.sessionId, entry)
      return this.#read(entry)
    }
    const sessionId = input.sessionId
    if (typeof sessionId !== 'string')
      fail('BATTLE_SESSION_UNKNOWN', '自动调试对局不存在或已关闭；用户试玩不接受此操作')
    const entry = this.#sessions.get(sessionId)
    if (!entry) fail('BATTLE_SESSION_UNKNOWN', '自动调试对局不存在或已关闭；用户试玩不接受此操作')
    if (operation === 'read') return this.#read(entry)
    if (operation === 'events') {
      const afterCursor = typeof input.afterCursor === 'number' ? input.afterCursor : 0,
        limit = typeof input.limit === 'number' ? input.limit : 50
      if (
        !Number.isSafeInteger(afterCursor) ||
        afterCursor < 0 ||
        afterCursor > entry.cursor ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        fail('BATTLE_INPUT_INVALID', '事件游标无效，条数须为 1–100')
      if (afterCursor < entry.eventFloor)
        fail('BATTLE_EVENTS_EXPIRED', '事件已过期或对局已重置，请重新读取状态并采用最新游标')
      const events: AutomationEntry['events'] = []
      let size = 0
      for (const event of entry.events) {
        if (event.cursor <= afterCursor) continue
        const bytes = Buffer.byteLength(JSON.stringify(event))
        if (size + bytes > 128 * 1024) {
          if (!events.length) fail('BATTLE_EVENT_TOO_LARGE', '单条事件超过 128 KiB，请读取战斗状态')
          break
        }
        events.push(event)
        size += bytes
        if (events.length === limit) break
      }
      const nextCursor = events.at(-1)?.cursor ?? afterCursor
      return {
        sessionId: entry.sessionId,
        revision: entry.revision,
        events,
        nextCursor,
        cursor: entry.cursor,
        hasMore: nextCursor < entry.cursor,
      }
    }
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision !== entry.revision)
      fail('BATTLE_REVISION_CONFLICT', '对局已改变，请重新读取状态与可用行动；不能重放旧操作')
    if (operation === 'close') {
      await this.#dispose(entry)
      this.#sessions.delete(entry.sessionId)
      return { sessionId: entry.sessionId, revision: entry.revision + 1, closed: true }
    }
    if (operation === 'reset') {
      // Invalid replacement inputs leave this automation battle intact as well.
      const replacement = await this.#create(
        { seed: input.seed ?? entry.seed, teamIds: input.teamIds ?? entry.teamIds },
        entry,
      )
      await this.#dispose(entry)
      this.#sessions.set(entry.sessionId, replacement)
      return this.#read(replacement)
    }
    const current = await this.#read(entry)
    if (!current.selections.some(selection => isDeepStrictEqual(selection, input.selection)))
      fail('BATTLE_ACTION_INVALID', '请选择当前返回的可用行动；不能操作对手或用户的对局')
    entry.revision++
    try {
      await this.#bounded(entry, () =>
        entry.system.submitAction(input.selection as Parameters<BattleSystem['submitAction']>[0]),
      )
    } catch (error) {
      if (errorCode(error) === 'BATTLE_TIMEOUT') throw error
      // Submission may already have changed the battle before failing. Never offer replay with the old revision.
      entry.failure = {
        code: errorCode(error) ?? 'BATTLE_EXECUTION_FAILED',
        message: errorMessage(error),
      }
      await this.#dispose(entry)
    }
    return this.#read(entry)
  }
  async close() {
    this.#closed = true
    await this.#queue.catch(() => {})
    await Promise.allSettled([...this.#sessions.values()].map(entry => this.#dispose(entry)))
    this.#sessions.clear()
  }
}

/** The caller resolves endpoint from its bound project's preview receipt; no arbitrary host or method is accepted. */
export async function callPreviewControl(endpoint: string, operation: string, input: unknown = {}) {
  if (!operations.has(operation)) fail('BATTLE_OPERATION_INVALID', '不支持的战斗调试操作')
  let url
  try {
    url = new URL(endpoint)
  } catch {
    fail('PREVIEW_UNAVAILABLE', '试玩地址无效，请重新准备')
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    !/^\/[a-f0-9]{48}$/.test(url.pathname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    fail('PREVIEW_UNAVAILABLE', '需要此项目的本机试玩宿主')
  let response
  try {
    response = await fetch(`${url.href}/automation/${operation}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(15000),
      redirect: 'error',
    })
  } catch {
    fail('PREVIEW_UNAVAILABLE', '试玩宿主不可用或请求超时；请查询任务并重新读取对局，不要直接重放行动')
  }
  const data = (await response.json()) as UnknownRecord
  if (!response.ok)
    fail(
      typeof data.code === 'string' ? data.code : 'BATTLE_CONTROL_FAILED',
      typeof data.error === 'string' ? data.error : '战斗调试失败',
    )
  return data.result
}
