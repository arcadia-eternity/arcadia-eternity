import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { BattleState } from '@arcadia-eternity/const'
import { useBattleStore } from '@/stores/battle'
import { useGameDataStore } from '@/stores/gameData'
import { LocalBattleSession } from '../localBattleSession'
import type { createNativeWebBattleSession } from '../nativeBattleFactory'

type Prepared = Awaited<ReturnType<typeof createNativeWebBattleSession>>
const emptyData = { marks: [], skills: [], species: [] }
const player = { name: 'test', team: [] }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
function prepared(): Prepared {
  const native = {
    getState: vi.fn(
      async () => ({ status: 'Unstarted', sequenceId: 0, players: [{ id: 'a' }, { id: 'b' }] }) as BattleState,
    ),
    getAvailableSelection: vi.fn(async () => []),
    BattleEvent: vi.fn(() => vi.fn()),
    cleanup: vi.fn(async () => {}),
    submitAction: vi.fn(async () => {}),
    ready: vi.fn(),
    isTimerEnabled: vi.fn(),
    getPlayerTimerState: vi.fn(),
    getAllPlayerTimerStates: vi.fn(),
    getTimerConfig: vi.fn(),
    startAnimation: vi.fn(),
    endAnimation: vi.fn(),
    startReconnectGraceTimer: vi.fn(),
    cancelReconnectGraceTimer: vi.fn(),
    onTimerEvent: vi.fn(),
    offTimerEvent: vi.fn(),
    createRuntimeSnapshot: vi.fn(),
    restoreRuntimeSnapshot: vi.fn(),
  } as unknown as Prepared['system']
  return { system: native, data: emptyData }
}
function destination() {
  const data = useGameDataStore(),
    battle = useBattleStore()
  data.loaded = true
  return { data, battle, navigate: vi.fn(async () => {}) }
}
const sessions: LocalBattleSession[] = []
function session(factory: typeof createNativeWebBattleSession = vi.fn(async () => prepared())) {
  const value = new LocalBattleSession(factory)
  sessions.push(value)
  return value
}
beforeEach(() => setActivePinia(createPinia()))
afterEach(async () => {
  for (const value of sessions.splice(0)) await value.dispose().catch(() => {})
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('pins desktop content from configuration through retries and battle cleanup', async () => {
  const content = { species: [], skills: [], marks: [] }
  const environment = { revision: 'fixed-local', data: emptyData, modules: [] }
  const releaseLocalContent = vi.fn(async () => {})
  const prepareLocalContent = vi.fn(async () => ({ token: 'configuration', environment, content }))
  vi.stubGlobal('window', { arcadiaDesktop: { prepareLocalContent, releaseLocalContent } })
  const native = prepared(),
    factory = vi.fn<typeof createNativeWebBattleSession>(async () => native),
    value = session(factory)
  const target = destination(),
    original = target.data.species
  target.data.applyServerEnvironment({ species: [], skills: [], marks: [] })
  await value.prepareContent(target.data)
  expect(prepareLocalContent).toHaveBeenCalledOnce()
  expect(target.data.species).not.toBe(original)
  // The library may change after configuration; this session keeps the captured recipe.
  prepareLocalContent.mockResolvedValue({ token: 'later', environment: { ...environment, revision: 'later' }, content })
  target.navigate.mockRejectedValueOnce(new Error('route failed'))
  await expect(value.start(player, player, {}, target)).rejects.toThrow('route failed')
  expect(releaseLocalContent).not.toHaveBeenCalled()
  await value.start(player, player, {}, target)
  expect(factory.mock.calls[0]?.[3]?.environment).toEqual(environment)
  expect(factory.mock.calls[1]?.[3]?.environment).toEqual(environment)
  expect(prepareLocalContent).toHaveBeenCalledOnce()
  expect(releaseLocalContent).not.toHaveBeenCalled()
  await target.battle.resetBattleWithoutSurrender()
  expect(releaseLocalContent).toHaveBeenCalledExactlyOnceWith('configuration')
  await value.dispose()
  expect(releaseLocalContent).toHaveBeenCalledOnce()
})

it('can retry a failed desktop capture and releases the successful configuration once', async () => {
  const releaseLocalContent = vi.fn(async () => {})
  const prepareLocalContent = vi
    .fn(async () => ({
      token: 'retry',
      environment: { revision: 'retry', data: emptyData, modules: [] },
      content: { species: [], skills: [], marks: [] },
    }))
    .mockRejectedValueOnce(new Error('temporary preparation failure'))
  vi.stubGlobal('window', { arcadiaDesktop: { prepareLocalContent, releaseLocalContent } })
  const value = session(),
    target = destination()
  await expect(value.prepareContent(target.data)).rejects.toThrow('temporary preparation failure')
  await value.prepareContent(target.data)
  await value.dispose()
  expect(prepareLocalContent).toHaveBeenCalledTimes(2)
  expect(releaseLocalContent).toHaveBeenCalledExactlyOnceWith('retry')
})

it('captures player and option inputs, transfers to battle, and releases its runtime exactly once', async () => {
  const native = prepared(),
    factory = vi.fn<typeof createNativeWebBattleSession>(async () => native)
  const value = session(factory),
    target = destination(),
    original = target.data.species
  const restore = vi.spyOn(target.data, 'useLocalBattleContent')
  const first = { name: 'Player A', team: [] },
    second = { name: 'Player B', team: [] }
  const config = { timerConfig: { enabled: false } }
  target.navigate.mockImplementation(async () => {
    await value.releaseConfiguration()
  })
  const starting = value.start(first, second, config, target)
  first.name = 'later edit'
  config.timerConfig.enabled = true
  await expect(starting).resolves.toBe(true)
  expect(factory.mock.calls[0]?.[0].name).toBe('Player A')
  expect(factory.mock.calls[0]?.[3]?.timerConfig?.enabled).toBe(false)
  expect(value.state).toBe('active')
  expect(native.system.cleanup).not.toHaveBeenCalled()
  expect(restore).not.toHaveBeenCalled()
  const system = target.battle.battleInterface!
  await target.battle.resetBattleWithoutSurrender()
  await system.cleanup()
  await value.dispose()
  expect(value.state).toBe('disposed')
  expect(target.data.species).toBe(original)
  expect(native.system.cleanup).toHaveBeenCalledOnce()
})

it('releases an abandoned configuration and refuses to launch it later', async () => {
  const factory = vi.fn(async () => prepared()),
    value = session(factory)
  await value.releaseConfiguration()
  await expect(value.start(player, player, {}, destination())).rejects.toThrow('重新准备')
  expect(factory).not.toHaveBeenCalled()
})

it('cancels pending creation, cleans its late runtime, and never mounts or navigates', async () => {
  const pending = deferred<Prepared>(),
    native = prepared()
  const value = session(vi.fn(() => pending.promise)),
    target = destination()
  const mount = vi.spyOn(target.battle, 'initBattle'),
    project = vi.spyOn(target.data, 'useLocalBattleContent')
  const start = value.start(player, player, {}, target)
  await expect(value.start(player, player, {}, target)).rejects.toThrow('重复启动')
  const closing = value.releaseConfiguration()
  pending.resolve(native)
  await closing
  await expect(start).resolves.toBe(false)
  expect(native.system.cleanup).toHaveBeenCalledOnce()
  expect(mount).not.toHaveBeenCalled()
  expect(project).not.toHaveBeenCalled()
  expect(target.navigate).not.toHaveBeenCalled()
})

it('cleans a failed launch and allows retry with the same configuration', async () => {
  const bad = prepared(),
    good = prepared()
  vi.mocked(bad.system.getState).mockRejectedValueOnce(new Error('bad initial state'))
  const factory = vi.fn<typeof createNativeWebBattleSession>(async () => good).mockResolvedValueOnce(bad)
  const value = session(factory),
    target = destination(),
    original = target.data.species
  await expect(value.start(player, player, {}, target)).rejects.toThrow('bad initial state')
  expect(value.state).toBe('configuring')
  expect(target.data.species).toBe(original)
  expect(bad.system.cleanup).toHaveBeenCalledOnce()
  await expect(value.start(player, player, {}, target)).resolves.toBe(true)
  expect(factory.mock.calls[0]?.[3]).toEqual(factory.mock.calls[1]?.[3])
})

it('cancels a failed route transfer after configuration unmount without leaving a bound battle', async () => {
  const native = prepared(),
    value = session(vi.fn(async () => native)),
    target = destination()
  const original = target.data.species
  target.navigate.mockImplementation(async () => {
    await value.releaseConfiguration()
    throw new Error('navigation failed')
  })
  await expect(value.start(player, player, {}, target)).rejects.toThrow('navigation failed')
  expect(value.state).toBe('disposed')
  expect(target.battle.battleInterface).toBeNull()
  expect(target.data.species).toBe(original)
  expect(native.system.cleanup).toHaveBeenCalledOnce()
})

it('a cancelled initial-state read cannot mount over a newer session', async () => {
  const pending = deferred<BattleState>(),
    old = prepared(),
    fresh = prepared()
  vi.mocked(old.system.getState).mockReturnValue(pending.promise)
  const first = session(vi.fn(async () => old)),
    second = session(vi.fn(async () => fresh))
  const target = destination(),
    start = first.start(player, player, {}, target)
  await vi.waitFor(() => expect(old.system.getState).toHaveBeenCalled())
  await first.dispose()
  await second.start(player, player, {}, target)
  const active = target.battle.battleInterface
  pending.resolve({ status: 'Unstarted', players: [{ id: 'old' }] } as BattleState)
  await expect(start).resolves.toBe(false)
  expect(target.battle.battleInterface).toBe(active)
  expect(target.navigate).toHaveBeenCalledOnce()
  expect(old.system.cleanup).toHaveBeenCalledOnce()
})

it('detaches the store even when native cleanup fails', async () => {
  const native = prepared(),
    value = session(vi.fn(async () => native)),
    target = destination()
  const original = target.data.species
  await value.start(player, player, {}, target)
  vi.mocked(native.system.cleanup).mockRejectedValueOnce(new Error('cleanup failed'))
  await expect(value.dispose()).rejects.toThrow('cleanup failed')
  expect(value.state).toBe('disposed')
  expect(target.data.species).toBe(original)
  expect(target.battle.battleInterface).toBeNull()
  expect(native.system.cleanup).toHaveBeenCalledOnce()
})
