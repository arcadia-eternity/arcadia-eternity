import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, reactive } from 'vue'
import type { PrivateRoomInfo } from '@arcadia-eternity/protocol'
import type { PreparedPersonalEnvironment } from '@/services/personalEnvironment'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  notify: vi.fn(),
  fetch: vi.fn(),
  preparePeer: vi.fn(),
  prepareServer: vi.fn(),
  validateTeam: vi.fn(),
  createHost: vi.fn(),
  gameData: { loaded: true, applyServerEnvironment: vi.fn(), clearServerEnvironment: vi.fn() },
  client: {
    playerId: 'host',
    serverUrl: 'https://server-a.test',
    currentState: { matchmaking: 'idle' },
    _instance: {},
    on: vi.fn(),
    createPrivateRoom: vi.fn(),
    joinPrivateRoom: vi.fn(),
    getPrivateRoomInfo: vi.fn(),
    getCurrentPrivateRoom: vi.fn(),
    updatePrivateRoomConfig: vi.fn(),
    leavePrivateRoom: vi.fn(),
    toggleRoomReady: vi.fn(),
    startRoomBattle: vi.fn(),
    disconnect: vi.fn(),
    replaceServer: vi.fn(),
    connect: vi.fn(),
    cancelMatchmaking: vi.fn(),
  },
  auth: {
    serverUrl: 'https://server-a.test',
    serverGeneration: 0,
    hasSelectedServer: true,
    serverInfo: {
      serverId: 'server-a',
      bootId: 'boot-a',
      runtime: { kind: 'native-v4', contentRevision: 'official', coreBuildId: 'core', registryBuildId: 'registry' },
    },
    checkServerUrl: vi.fn(),
    setServerUrl: vi.fn(),
  },
  battle: {
    initBattle: vi.fn(),
    ready: vi.fn(),
    fetchAvailableSelection: vi.fn(),
    resetBattleWithoutSurrender: vi.fn(),
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
vi.mock('@/stores/battleClient', () => ({ useBattleClientStore: () => reactive(mocks.client) }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => reactive(mocks.auth) }))
vi.mock('@/stores/battle', () => ({ useBattleStore: () => mocks.battle }))
vi.mock('@/stores/player', () => ({ usePlayerStore: () => ({ player: { name: 'Host' } }) }))
vi.mock('@/stores/petStorage', () => ({ usePetStorageStore: () => ({ getCurrentTeam: () => [{ id: 'local-pet' }] }) }))
vi.mock('@/stores/gameData', () => ({ useGameDataStore: () => mocks.gameData }))
vi.mock('@/stores/serverState', () => ({ useServerStateStore: () => ({ updateServerState: vi.fn() }) }))
vi.mock('@/services/serverEnvironment', () => ({
  listServerEnvironments: vi.fn(),
  prepareServerEnvironment: mocks.prepareServer,
}))
vi.mock('@/services/peerEnvironment', () => ({ preparePeerEnvironment: mocks.preparePeer }))
vi.mock('@/services/personalEnvironment', () => ({ validatePersonalEnvironmentTeam: mocks.validateTeam }))
vi.mock('@/p2p/p2pBattleSystem', () => ({ createP2PHostBattleSystem: mocks.createHost, P2PPeerBattleSystem: class {} }))
vi.mock('@/p2p/webRtcPeerTransport', () => ({
  WebRTCPeerTransport: class {
    onStateChange() {
      return () => {}
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

function prepared(key = 'a'): PreparedPersonalEnvironment & { release: ReturnType<typeof vi.fn<() => void>> } {
  const descriptor = {
    id: key.repeat(64),
    protocolVersion: 1 as const,
    executionPolicy: 'peer' as const,
    peerRevision: `fixed-personal-${key}`,
    resourceRevision: 'b'.repeat(64),
    runtime: {
      kind: 'native-v4' as const,
      contentRevision: `content-${key}`,
      coreBuildId: 'core',
      registryBuildId: 'registry',
    },
    packages: [],
    resources: [],
  }
  const environment = {
    revision: descriptor.peerRevision,
    data: { species: [], skills: [], marks: [] },
    modules: [
      {
        namespace: '',
        role: 'catalog' as const,
        artifact: {
          format: 'arcadia.effect-module' as const,
          version: 1 as const,
          sdkApi: 2 as const,
          packageId: 'official',
          source: `PRIVATE_AUTHOR_SOURCE_${key}`,
        },
      },
    ],
  }
  const content = { species: [], skills: [], marks: [] }
  const rules = { schemaVersion: 1 as const }
  return {
    bundle: {
      format: 'arcadia.personal-environment',
      version: 1,
      descriptor,
      rules,
      environment,
      content,
      assets: [{ id: 'image', mime: 'image/png', data: `PRIVATE_ASSET_BYTES_${key}` }],
    },
    reference: {
      kind: 'personal',
      protocolVersion: 1,
      descriptor,
      rules,
      source: { kind: 'file', name: `${key}.arcadia.json` },
    },
    environment,
    content,
    acceptance: {
      environmentId: descriptor.id,
      protocolVersion: 1,
      resourceRevision: descriptor.resourceRevision,
      peerRevision: descriptor.peerRevision,
      resourcesReady: true,
    },
    release: vi.fn<() => void>(),
  }
}
function room(value: PreparedPersonalEnvironment, generation = 1, id = 'room-a'): PrivateRoomInfo {
  return {
    id,
    config: { roomCode: 'ABC123', hostPlayerId: 'host', battleMode: 'p2p', p2pTransport: 'webrtc' },
    personalEnvironment: value.reference,
    environment: value.reference.descriptor,
    challengeGeneration: generation,
    status: 'waiting',
    players: [
      { playerId: 'host', playerName: 'Host', isReady: false, team: [{ id: 'host-pet' }] },
      { playerId: 'peer', playerName: 'Peer', isReady: false, team: [{ id: 'peer-pet' }] },
    ],
    spectators: [],
  } as unknown as PrivateRoomInfo
}
function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
let store: ReturnType<typeof usePrivateRoomStore>
let serverRoom: PrivateRoomInfo | null
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mocks.fetch)
  reactive(mocks.client).playerId = 'host'
  reactive(mocks.client).serverUrl = 'https://server-a.test'
  reactive(mocks.auth).serverUrl = 'https://server-a.test'
  reactive(mocks.auth).serverGeneration = 0
  mocks.auth.checkServerUrl.mockReset().mockImplementation((value: string) => value)
  mocks.auth.setServerUrl.mockReset().mockImplementation((value: string) => {
    reactive(mocks.auth).serverUrl = value
    reactive(mocks.auth).serverGeneration++
  })
  mocks.client.replaceServer.mockReset().mockImplementation((value: string) => {
    reactive(mocks.client).serverUrl = value
  })
  mocks.client.connect.mockReset().mockResolvedValue(undefined)
  mocks.client.createPrivateRoom.mockReset().mockResolvedValue('ABC123')
  mocks.client.joinPrivateRoom.mockReset().mockResolvedValue(undefined)
  mocks.client.leavePrivateRoom.mockReset().mockResolvedValue(undefined)
  mocks.client.toggleRoomReady.mockReset().mockResolvedValue(undefined)
  mocks.client.startRoomBattle.mockReset().mockResolvedValue(undefined)
  mocks.client.updatePrivateRoomConfig.mockReset().mockResolvedValue(undefined)
  mocks.client.getPrivateRoomInfo.mockReset().mockImplementation(async () => serverRoom)
  mocks.client.getCurrentPrivateRoom.mockReset().mockImplementation(async () => serverRoom)
  mocks.validateTeam.mockReset().mockImplementation((_prepared, team) => team)
  mocks.createHost.mockReset().mockResolvedValue({
    BattleEvent: vi.fn(() => () => {}),
    getState: vi.fn().mockResolvedValue({ sequenceId: 0 }),
    cleanup: vi.fn(),
  })
  mocks.battle.fetchAvailableSelection.mockReset().mockResolvedValue([])
  serverRoom = null
  setActivePinia(createPinia())
  store = usePrivateRoomStore()
  store.selectedTeam = [{ id: 'local-pet' }] as typeof store.selectedTeam
})
afterEach(() => {
  store.cleanup()
  vi.unstubAllGlobals()
})

it('creates a personal challenge using only its reference, without uploading source or embedded media', async () => {
  const value = prepared()
  await store.setPersonalEnvironment(value)
  serverRoom = room(value)
  await store.createRoom({ battleMode: 'p2p' }, undefined, value.reference)
  expect(mocks.client.createPrivateRoom).toHaveBeenCalledWith({
    config: { battleMode: 'p2p' },
    personalEnvironment: value.reference,
    expectedRuntime: value.reference.descriptor.runtime,
  })
  const request = JSON.stringify(mocks.client.createPrivateRoom.mock.calls[0][0])
  expect(request).not.toContain('PRIVATE_AUTHOR_SOURCE')
  expect(request).not.toContain('PRIVATE_ASSET_BYTES')
  expect(mocks.preparePeer).not.toHaveBeenCalled()
  expect(mocks.prepareServer).not.toHaveBeenCalled()
  expect(mocks.fetch).not.toHaveBeenCalled()
  expect(store.personalEnvironmentReady).toBe(true)
})

it.each([
  ['server execution', 'server', undefined],
  ['a published environment', 'p2p', 'published-environment'],
] as const)('does not combine a personal environment with %s', async (_label, battleMode, environmentId) => {
  const value = prepared()
  await store.setPersonalEnvironment(value)
  await expect(store.createRoom({ battleMode }, environmentId, value.reference)).rejects.toThrow()
  expect(mocks.client.createPrivateRoom).not.toHaveBeenCalled()
})

it('joins a file challenge without its bundle and waits for an explicit matching import before ready', async () => {
  const value = prepared()
  serverRoom = room(value, 3)
  reactive(mocks.client).playerId = 'peer'
  await store.joinRoom('ABC123')
  expect(store.currentRoom?.id).toBe('room-a')
  expect(store.personalEnvironmentReady).toBe(false)
  expect(mocks.client.leavePrivateRoom).not.toHaveBeenCalled()
  await expect(store.toggleReady()).rejects.toThrow('导入')
  expect(mocks.client.toggleRoomReady).not.toHaveBeenCalled()
  await store.setPersonalEnvironment(value)
  await store.toggleReady()
  expect(mocks.validateTeam).toHaveBeenCalledWith(value, [{ id: 'local-pet' }])
  expect(mocks.client.toggleRoomReady).toHaveBeenCalledWith([{ id: 'local-pet' }], {
    ...value.acceptance,
    challengeGeneration: 3,
  })
  expect(mocks.fetch).not.toHaveBeenCalled()
  expect(mocks.preparePeer).not.toHaveBeenCalled()
})

it('restores room discovery without implicitly fetching a missing personal environment', async () => {
  serverRoom = room(prepared())
  expect(await store.checkCurrentRoom()).toEqual(serverRoom)
  expect(store.personalEnvironmentReady).toBe(false)
  expect(mocks.gameData.applyServerEnvironment).not.toHaveBeenCalled()
  expect(mocks.fetch).not.toHaveBeenCalled()
  expect(mocks.preparePeer).not.toHaveBeenCalled()
})

it('releases a guest import that does not match the host and preserves the accepted environment', async () => {
  const accepted = prepared(),
    wrong = prepared('c')
  await store.setPersonalEnvironment(accepted)
  store.currentRoom = serverRoom = room(accepted)
  reactive(mocks.client).playerId = 'peer'
  await expect(store.setPersonalEnvironment(wrong)).rejects.toThrow('不一致')
  expect(wrong.release).toHaveBeenCalledOnce()
  expect(accepted.release).not.toHaveBeenCalled()
  expect(store.personalEnvironment).toBe(accepted)
  expect(mocks.client.updatePrivateRoomConfig).not.toHaveBeenCalled()
})

it('allows the host to replace the environment and acknowledges the new challenge generation', async () => {
  const old = prepared(),
    replacement = prepared('c')
  await store.setPersonalEnvironment(old)
  store.currentRoom = serverRoom = room(old, 1)
  mocks.client.updatePrivateRoomConfig.mockImplementationOnce(async () => {
    serverRoom = room(replacement, 2)
  })
  await store.setPersonalEnvironment(replacement)
  expect(mocks.client.updatePrivateRoomConfig).toHaveBeenCalledWith({ personalEnvironment: replacement.reference })
  expect(old.release).toHaveBeenCalledOnce()
  expect(store.personalEnvironment).toBe(replacement)
  expect(store.personalEnvironmentReady).toBe(true)
  await store.startBattle()
  expect(mocks.validateTeam).toHaveBeenCalledWith(replacement, [{ id: 'local-pet' }])
  expect(mocks.client.startRoomBattle).toHaveBeenCalledWith([{ id: 'local-pet' }], {
    ...replacement.acceptance,
    challengeGeneration: 2,
  })
})

it.each(['toggleReady', 'startBattle'] as const)(
  'does not send %s after static team validation fails',
  async action => {
    const value = prepared()
    await store.setPersonalEnvironment(value)
    store.currentRoom = serverRoom = room(value)
    mocks.validateTeam.mockImplementationOnce(() => {
      throw new Error('Invalid personal team')
    })
    await expect(store[action]()).rejects.toThrow('Invalid personal team')
    expect(mocks.client.toggleRoomReady).not.toHaveBeenCalled()
    expect(mocks.client.startRoomBattle).not.toHaveBeenCalled()
  },
)

it.each(['toggleReady', 'startBattle'] as const)(
  'fences %s when the challenge changes during preparation',
  async action => {
    const value = prepared()
    await store.setPersonalEnvironment(value)
    store.currentRoom = serverRoom = room(value, 1)
    const pending = store[action]()
    store.currentRoom = serverRoom = room(value, 2)
    await expect(pending).rejects.toThrow()
    expect(mocks.client.toggleRoomReady).not.toHaveBeenCalled()
    expect(mocks.client.startRoomBattle).not.toHaveBeenCalled()
  },
)

it('fences ready when a different room uses the same personal environment', async () => {
  const value = prepared()
  await store.setPersonalEnvironment(value)
  store.currentRoom = room(value, 1, 'room-a')
  const pending = store.toggleReady()
  store.currentRoom = room(value, 1, 'room-b')
  await expect(pending).rejects.toThrow()
  expect(mocks.client.toggleRoomReady).not.toHaveBeenCalled()
})

it('does not replace a newer import after an older host configuration request finishes late', async () => {
  const old = prepared(),
    stale = prepared('c'),
    newest = prepared('d')
  await store.setPersonalEnvironment(old)
  store.currentRoom = serverRoom = room(old)
  const update = deferred()
  mocks.client.updatePrivateRoomConfig.mockImplementationOnce(() => update.promise)
  const pending = store.setPersonalEnvironment(stale)
  const rejected = expect(pending).rejects.toThrow()
  mocks.client.updatePrivateRoomConfig.mockImplementationOnce(async () => {
    serverRoom = room(newest, 3)
  })
  await store.setPersonalEnvironment(newest)
  mocks.gameData.applyServerEnvironment.mockClear()
  update.resolve()
  await rejected
  expect(store.personalEnvironment).toBe(newest)
  expect(stale.release).toHaveBeenCalledOnce()
  expect(newest.release).not.toHaveBeenCalled()
  expect(mocks.gameData.applyServerEnvironment).not.toHaveBeenCalledWith(stale.content)
})

it('does not install a delayed host replacement after switching servers', async () => {
  const old = prepared(),
    stale = prepared('c')
  await store.setPersonalEnvironment(old)
  store.currentRoom = serverRoom = room(old)
  const update = deferred()
  mocks.client.updatePrivateRoomConfig.mockImplementationOnce(() => update.promise)
  const pending = store.setPersonalEnvironment(stale)
  const rejected = expect(pending).rejects.toThrow()
  await store.switchServer('https://server-b.test')
  mocks.gameData.applyServerEnvironment.mockClear()
  update.resolve()
  await rejected
  expect(stale.release).toHaveBeenCalledOnce()
  expect(old.release).toHaveBeenCalledOnce()
  expect(store.personalEnvironment).toBeUndefined()
  expect(store.currentRoom).toBeNull()
  expect(mocks.gameData.applyServerEnvironment).not.toHaveBeenCalled()
})

it('does not restore an older room snapshot after a newer import finishes first', async () => {
  const old = prepared(),
    stale = prepared('c'),
    newest = prepared('d')
  await store.setPersonalEnvironment(old)
  store.currentRoom = serverRoom = room(old)
  const lookup = deferred<PrivateRoomInfo>()
  mocks.client.updatePrivateRoomConfig.mockImplementationOnce(async () => {
    serverRoom = room(stale, 2)
  })
  mocks.client.getPrivateRoomInfo.mockImplementationOnce(() => lookup.promise)
  const pending = store.setPersonalEnvironment(stale)
  const rejected = expect(pending).rejects.toThrow()
  await vi.waitFor(() => expect(mocks.client.getPrivateRoomInfo).toHaveBeenCalledOnce())
  mocks.client.updatePrivateRoomConfig.mockImplementationOnce(async () => {
    serverRoom = room(newest, 3)
  })
  await store.setPersonalEnvironment(newest)
  lookup.resolve(room(stale, 2))
  await rejected
  expect(store.currentRoom?.challengeGeneration).toBe(3)
  expect(store.currentRoom?.personalEnvironment?.descriptor.id).toBe(newest.reference.descriptor.id)
  expect(store.personalEnvironment).toBe(newest)
  expect(stale.release).toHaveBeenCalledOnce()
})

it('keeps the previous import when the server rejects a host environment change', async () => {
  const old = prepared(),
    rejected = prepared('c')
  await store.setPersonalEnvironment(old)
  store.currentRoom = serverRoom = room(old)
  mocks.client.updatePrivateRoomConfig.mockRejectedValueOnce(new Error('Not host anymore'))
  await expect(store.setPersonalEnvironment(rejected)).rejects.toThrow('Not host anymore')
  expect(store.personalEnvironment).toBe(old)
  expect(old.release).not.toHaveBeenCalled()
  expect(rejected.release).toHaveBeenCalledOnce()
})

it('does not replace materials while a personal battle is running', async () => {
  const current = prepared(),
    replacement = prepared('c')
  await store.setPersonalEnvironment(current)
  store.currentRoom = { ...room(current), status: 'started' }
  await expect(store.setPersonalEnvironment(replacement)).rejects.toThrow('无法更换')
  expect(store.personalEnvironment).toBe(current)
  expect(current.release).not.toHaveBeenCalled()
  expect(replacement.release).toHaveBeenCalledOnce()
  expect(mocks.client.updatePrivateRoomConfig).not.toHaveBeenCalled()
})

it('releases imported resources once when cleanup runs more than once', async () => {
  const value = prepared()
  await store.setPersonalEnvironment(value)
  store.cleanup()
  store.cleanup()
  expect(value.release).toHaveBeenCalledOnce()
  expect(store.personalEnvironment).toBeUndefined()
  expect(store.personalEnvironmentReady).toBe(false)
})

it('releases the capture when the connection authority changes without a room', async () => {
  const value = prepared()
  await store.setPersonalEnvironment(value)
  reactive(mocks.client).serverUrl = 'https://server-b.test'
  await nextTick()
  expect(value.release).toHaveBeenCalledOnce()
  expect(store.personalEnvironment).toBeUndefined()
})

it.each(['host', 'peer'])('checks the %s team before allocating the personal host Worker', async invalidPlayer => {
  const value = prepared()
  await store.setPersonalEnvironment(value)
  store.currentRoom = serverRoom = { ...room(value), status: 'started', battleRoomId: 'battle-a' }
  mocks.validateTeam.mockImplementation((_value, team: { id: string }[]) => {
    if (team[0]?.id === `${invalidPlayer}-pet`) throw new Error(`Invalid ${invalidPlayer} team`)
    return team
  })
  const handler = mocks.client.on.mock.calls.find(([name]) => name === 'privateRoomEvent')![1]
  await handler({
    type: 'battleStarted',
    data: { battleMode: 'p2p', battleRoomId: 'battle-a', battleHost: { playerId: 'host', sessionId: 'host-session' } },
  })
  expect(mocks.validateTeam).toHaveBeenCalledWith(value, [{ id: `${invalidPlayer}-pet` }])
  expect(mocks.createHost).not.toHaveBeenCalled()
  expect(mocks.battle.initBattle).not.toHaveBeenCalled()
  expect(store.error).toContain(`Invalid ${invalidPlayer} team`)
})
