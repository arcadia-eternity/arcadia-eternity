import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { reactive } from 'vue'

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  content: { species: [], skills: [], marks: [] },
  apply: vi.fn(),
  client: {
    playerId: 'host',
    serverUrl: 'https://peer.test',
    currentState: { matchmaking: 'idle' },
    _instance: {},
    on: vi.fn(),
    toggleRoomReady: vi.fn(),
    startRoomBattle: vi.fn(),
  },
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ currentRoute: { value: { path: '/', query: {} } }, push: vi.fn() }),
}))
vi.mock('@/stores/battleClient', () => ({ useBattleClientStore: () => reactive(mocks.client) }))
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ serverGeneration: 0, serverInfo: { serverId: 'a', bootId: 'b' } }),
}))
vi.mock('@/stores/battle', () => ({ useBattleStore: () => ({}) }))
vi.mock('@/stores/player', () => ({ usePlayerStore: () => ({ player: { name: 'Host' } }) }))
vi.mock('@/stores/petStorage', () => ({ usePetStorageStore: () => ({ getCurrentTeam: () => [{ id: 'pet' }] }) }))
vi.mock('@/stores/gameData', () => ({
  useGameDataStore: () => ({ applyServerEnvironment: mocks.apply, clearServerEnvironment: vi.fn() }),
}))
vi.mock('@/stores/serverState', () => ({ useServerStateStore: () => ({ updateServerState: vi.fn() }) }))
vi.mock('@/services/serverEnvironment', () => ({ listServerEnvironments: vi.fn(), prepareServerEnvironment: vi.fn() }))
vi.mock('@/services/peerEnvironment', () => ({ preparePeerEnvironment: mocks.prepare }))

import { usePrivateRoomStore } from '../privateRoom'

const descriptor = {
  id: 'a'.repeat(64),
  protocolVersion: 1 as const,
  resourceRevision: 'b'.repeat(64),
  peerRevision: 'captured-effects',
  executionPolicy: 'peer' as const,
  resources: [],
  packages: [],
  runtime: {
    kind: 'native-v4' as const,
    contentRevision: 'fixed-content',
    coreBuildId: 'core',
    registryBuildId: 'registry',
  },
}
const environment = { revision: descriptor.peerRevision, data: { species: [], skills: [], marks: [] }, modules: [] }
const prepared = () => ({
  content: mocks.content,
  environment,
  acceptance: {
    environmentId: descriptor.id,
    protocolVersion: 1,
    resourceRevision: descriptor.resourceRevision,
    peerRevision: descriptor.peerRevision,
    resourcesReady: true,
  },
})
let store: ReturnType<typeof usePrivateRoomStore>
beforeEach(() => {
  vi.clearAllMocks()
  mocks.prepare.mockReset().mockResolvedValue(prepared())
  reactive(mocks.client).serverUrl = 'https://peer.test'
  setActivePinia(createPinia())
  store = usePrivateRoomStore()
  store.selectedTeam = [{ id: 'pet' }] as typeof store.selectedTeam
  store.currentRoom = {
    config: { roomCode: 'ABC123', battleMode: 'p2p', hostPlayerId: 'host' },
    environment: descriptor,
    status: 'waiting',
    players: [{ playerId: 'host', isReady: false }],
    spectators: [],
  } as unknown as NonNullable<typeof store.currentRoom>
})
afterEach(() => store.cleanup())

it('does not acknowledge ready until exact peer materials are acquired', async () => {
  let resolve!: (value: ReturnType<typeof prepared>) => void
  mocks.prepare.mockImplementationOnce(
    () =>
      new Promise(done => {
        resolve = done
      }),
  )
  const pending = store.toggleReady()
  expect(mocks.prepare).toHaveBeenCalledWith(
    'https://peer.test',
    descriptor,
    expect.any(Function),
    expect.any(AbortSignal),
  )
  expect(mocks.client.toggleRoomReady).not.toHaveBeenCalled()
  expect(mocks.apply).not.toHaveBeenCalled()
  resolve(prepared())
  await pending
  expect(mocks.client.toggleRoomReady).toHaveBeenCalledWith([{ id: 'pet' }], prepared().acceptance)
  expect(mocks.apply).toHaveBeenCalledWith(mocks.content)
})

it('does not acknowledge mismatched or unavailable peer materials', async () => {
  mocks.prepare.mockRejectedValueOnce(new Error('对战环境材料版本不一致'))
  await expect(store.toggleReady()).rejects.toThrow('版本不一致')
  expect(mocks.client.toggleRoomReady).not.toHaveBeenCalled()
  expect(mocks.apply).not.toHaveBeenCalled()
})

it('pins preparation to the room even when the next room selects the same environment', async () => {
  let resolve!: (value: ReturnType<typeof prepared>) => void
  mocks.prepare.mockImplementationOnce(
    () =>
      new Promise(done => {
        resolve = done
      }),
  )
  const pending = store.toggleReady()
  store.currentRoom = { ...store.currentRoom!, config: { ...store.currentRoom!.config, roomCode: 'DEF456' } }
  resolve(prepared())
  await expect(pending).rejects.toThrow('房间环境已变化')
  expect(mocks.client.toggleRoomReady).not.toHaveBeenCalled()
  expect(mocks.apply).not.toHaveBeenCalled()
})

it('reuses the fixed prepared recipe when starting and sends its execution revision', async () => {
  await store.toggleReady()
  await store.startBattle()
  expect(mocks.prepare).toHaveBeenCalledOnce()
  expect(mocks.client.startRoomBattle).toHaveBeenCalledWith([{ id: 'pet' }], prepared().acceptance)
})

it('allows ready cancellation without reacquiring any code', async () => {
  store.currentRoom!.players[0].isReady = true
  await store.toggleReady()
  expect(mocks.prepare).not.toHaveBeenCalled()
  expect(mocks.client.toggleRoomReady).toHaveBeenCalledWith(undefined, undefined)
})

it('cannot start or acknowledge a metadata-only legacy peer room', async () => {
  store.currentRoom!.environment = undefined
  await expect(store.toggleReady()).rejects.toThrow('尚未准备完成')
  await expect(store.startBattle()).rejects.toThrow('尚未准备完成')
  expect(mocks.client.toggleRoomReady).not.toHaveBeenCalled()
  expect(mocks.client.startRoomBattle).not.toHaveBeenCalled()
})
