import { roomFixture, environmentFixture } from './fixtures/rooms'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, reactive } from 'vue'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  notify: vi.fn(),
  createHost: vi.fn(),
  preparePeer: vi.fn(),
  gameData: { loaded: true, clearServerEnvironment: vi.fn(), applyServerEnvironment: vi.fn() },
  transports: [] as Array<{ change(state: string): void }>,
  client: {
    playerId: 'host',
    serverUrl: 'https://server-a.test',
    currentState: { matchmaking: 'idle' },
    _instance: {},
    on: vi.fn(),
    getPrivateRoomInfo: vi.fn(),
    leavePrivateRoom: vi.fn(),
  },
  battle: {
    initBattle: vi.fn(),
    ready: vi.fn(),
    fetchAvailableSelection: vi.fn(),
    battleInterface: null,
    lastProcessedSequenceId: -1,
    availableActions: [],
    battleState: null,
  },
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ currentRoute: { value: { path: '/', query: {} } }, push: mocks.push }),
}))
vi.mock('element-plus', () => ({ ElNotification: mocks.notify, ElMessageBox: {} }))
vi.mock('@/stores/battleClient', async () => {
  const { reactive } = await import('vue')
  return { useBattleClientStore: () => reactive(mocks.client) }
})
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ serverGeneration: 0, serverInfo: { serverId: 'a', bootId: 'boot' } }),
}))
vi.mock('@/stores/battle', () => ({ useBattleStore: () => mocks.battle }))
vi.mock('@/stores/player', () => ({ usePlayerStore: () => ({ player: { name: 'Host' } }) }))
vi.mock('@/stores/petStorage', () => ({ usePetStorageStore: () => ({ getCurrentTeam: () => [] }) }))
vi.mock('@/stores/gameData', () => ({ useGameDataStore: () => mocks.gameData }))
vi.mock('@/stores/serverState', () => ({ useServerStateStore: () => ({ updateServerState: vi.fn() }) }))
vi.mock('@/services/serverEnvironment', () => ({ listServerEnvironments: vi.fn(), prepareServerEnvironment: vi.fn() }))
vi.mock('@/services/peerEnvironment', () => ({ preparePeerEnvironment: mocks.preparePeer }))
vi.mock('@/p2p/p2pBattleSystem', () => ({ createP2PHostBattleSystem: mocks.createHost, P2PPeerBattleSystem: class {} }))
vi.mock('@/p2p/webRtcPeerTransport', () => ({
  WebRTCPeerTransport: class {
    listeners = new Set<(state: string) => void>()
    constructor() {
      mocks.transports.push(this)
    }
    onStateChange(listener: (state: string) => void) {
      this.listeners.add(listener)
      return () => this.listeners.delete(listener)
    }
    change(state: string) {
      for (const listener of this.listeners) listener(state)
    }
  },
}))
vi.mock('@/p2p/privateRoomSignalBridge', () => ({
  createPrivateRoomSignalBridge: () => ({
    connect: async () => {},
    close: async () => {},
    handleSignal: async () => {},
  }),
}))

import { usePrivateRoomStore } from '../privateRoom'
let store: ReturnType<typeof usePrivateRoomStore>
const descriptor = environmentFixture({
  id: 'a'.repeat(64),
  protocolVersion: 1,
  executionPolicy: 'peer',
  peerRevision: 'fixed-peer-revision',
  resourceRevision: 'b'.repeat(64),
  runtime: { kind: 'native-v4', contentRevision: 'fixed-content', coreBuildId: 'core', registryBuildId: 'registry' },
  packages: [],
  resources: [],
})
const prepared = {
  environment: { revision: descriptor.peerRevision, data: { species: [], skills: [], marks: [] }, modules: [] },
  content: { species: [], skills: [], marks: [] },
  acceptance: {
    environmentId: descriptor.id,
    protocolVersion: 1,
    resourceRevision: descriptor.resourceRevision,
    peerRevision: descriptor.peerRevision,
    resourcesReady: true,
  },
}
const room = (battleRoomId = 'battle-a') =>
  roomFixture({
    config: { roomCode: 'ABC123', hostPlayerId: 'host', battleMode: 'p2p', p2pTransport: 'webrtc' },
    status: 'started',
    battleRoomId,
    environment: descriptor,
    players: [
      { playerId: 'host', playerName: 'Host', team: [] },
      { playerId: 'peer', playerName: 'Peer', team: [] },
    ],
    spectators: [],
  })
function start(battleRoomId = 'battle-a'): Promise<void> {
  const handler = mocks.client.on.mock.calls.find(([name]) => name === 'privateRoomEvent')![1]
  return handler({
    type: 'battleStarted',
    data: { battleMode: 'p2p', battleRoomId, battleHost: { playerId: 'host', sessionId: 'host-session' } },
  })
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.transports.length = 0
  reactive(mocks.client).serverUrl = 'https://server-a.test'
  mocks.client.leavePrivateRoom.mockReset().mockResolvedValue(undefined)
  mocks.client.getPrivateRoomInfo.mockReset().mockResolvedValue(room())
  mocks.preparePeer.mockReset().mockResolvedValue(prepared)
  mocks.createHost.mockReset().mockImplementation(
    ({ signal }: { signal: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })
      }),
  )
  setActivePinia(createPinia())
  store = usePrivateRoomStore()
  store.currentRoom = room() as typeof store.currentRoom
})
afterEach(() => {
  store.cleanup()
})

it('cancels a queued host immediately when leaving, before the server acknowledges', async () => {
  const starting = start()
  await vi.waitFor(() => expect(mocks.createHost).toHaveBeenCalledOnce())
  expect(mocks.createHost.mock.calls[0][0].battleConfig.environment).toBe(prepared.environment)
  expect(mocks.gameData.applyServerEnvironment).toHaveBeenCalledWith(prepared.content)
  const signal = mocks.createHost.mock.calls[0][0].signal as AbortSignal
  let acknowledge!: () => void
  mocks.client.leavePrivateRoom.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        acknowledge = resolve
      }),
  )
  const leaving = store.leaveRoom()
  expect(signal.aborted).toBe(true)
  await starting
  expect(store.currentRoom).not.toBeNull()
  expect(mocks.battle.initBattle).not.toHaveBeenCalled()
  expect(mocks.push).not.toHaveBeenCalled()
  expect(mocks.notify).not.toHaveBeenCalled()
  acknowledge()
  await leaving
})

it('reuses duplicate pending starts and cancels only the replaced generation', async () => {
  const first = start()
  await vi.waitFor(() => expect(mocks.createHost).toHaveBeenCalledOnce())
  const firstSignal = mocks.createHost.mock.calls[0][0].signal as AbortSignal
  const duplicate = start()
  await nextTick()
  expect(mocks.createHost).toHaveBeenCalledOnce()
  expect(firstSignal.aborted).toBe(false)
  mocks.client.getPrivateRoomInfo.mockResolvedValue(room('battle-b'))
  const replacement = start('battle-b')
  expect(firstSignal.aborted).toBe(true)
  await Promise.all([first, duplicate])
  await vi.waitFor(() => expect(mocks.createHost).toHaveBeenCalledTimes(2))
  const secondSignal = mocks.createHost.mock.calls[1][0].signal as AbortSignal
  expect(secondSignal.aborted).toBe(false)
  store.cleanup()
  expect(secondSignal.aborted).toBe(true)
  await replacement
  expect(mocks.notify).not.toHaveBeenCalled()
  expect(mocks.push).not.toHaveBeenCalled()
})

it.each(['failed', 'closed'])('releases a queued host when its transport becomes %s', async state => {
  const starting = start()
  await vi.waitFor(() => expect(mocks.createHost).toHaveBeenCalledOnce())
  const signal = mocks.createHost.mock.calls[0][0].signal as AbortSignal
  mocks.transports[0].change(state)
  expect(signal.aborted).toBe(true)
  await starting
  expect(mocks.notify).not.toHaveBeenCalled()
  expect(mocks.battle.initBattle).not.toHaveBeenCalled()
})

it('cancels a queued host when the connection authority changes', async () => {
  const starting = start()
  await vi.waitFor(() => expect(mocks.createHost).toHaveBeenCalledOnce())
  const signal = mocks.createHost.mock.calls[0][0].signal as AbortSignal
  reactive(mocks.client).serverUrl = 'https://server-b.test'
  await nextTick()
  expect(signal.aborted).toBe(true)
  await starting
  expect(mocks.notify).not.toHaveBeenCalled()
})

it('cleans a late host result without installing it after cancellation', async () => {
  let finish!: (value: unknown) => void
  mocks.createHost.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      }),
  )
  const starting = start()
  await vi.waitFor(() => expect(mocks.createHost).toHaveBeenCalledOnce())
  store.cleanup()
  const cleanup = vi.fn().mockResolvedValue(undefined)
  finish({ cleanup })
  await starting
  expect(cleanup).toHaveBeenCalledOnce()
  expect(mocks.battle.initBattle).not.toHaveBeenCalled()
  expect(mocks.push).not.toHaveBeenCalled()
  expect(mocks.notify).not.toHaveBeenCalled()
})

it('keeps an initialized host active when leaving fails', async () => {
  const host = {
    BattleEvent: vi.fn(() => () => {}),
    getState: vi.fn().mockResolvedValue({ sequenceId: 0 }),
    cleanup: vi.fn(),
  }
  mocks.createHost.mockResolvedValueOnce(host)
  await start()
  const signal = mocks.createHost.mock.calls[0][0].signal as AbortSignal
  expect(mocks.battle.initBattle).toHaveBeenCalledOnce()
  expect(mocks.push).toHaveBeenCalledOnce()
  mocks.client.leavePrivateRoom.mockRejectedValueOnce(new Error('leave failed'))
  await expect(store.leaveRoom()).rejects.toThrow('leave failed')
  expect(signal.aborted).toBe(false)
  expect(host.cleanup).not.toHaveBeenCalled()
  const isCurrent = mocks.battle.initBattle.mock.calls[0][2] as () => boolean
  expect(isCurrent()).toBe(true)
})

it('does not allocate or install a P2P host when fixed materials cannot be prepared', async () => {
  mocks.preparePeer.mockRejectedValueOnce(new Error('Fixed peer materials unavailable'))
  await start()
  expect(mocks.createHost).not.toHaveBeenCalled()
  expect(mocks.battle.initBattle).not.toHaveBeenCalled()
  expect(mocks.gameData.applyServerEnvironment).not.toHaveBeenCalled()
  expect(mocks.push).not.toHaveBeenCalled()
  expect(store.error).toContain('Fixed peer materials unavailable')
})
