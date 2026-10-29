import { beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { reactive, nextTick } from 'vue'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  battle: { initBattle: vi.fn(), resetBattleWithoutSurrender: vi.fn() },
  client: {
    _instance: {},
    currentState: { matchmaking: 'idle' },
    cancelMatchmaking: vi.fn(),
    joinMatchmaking: vi.fn(),
    playerId: 'host',
    serverUrl: 'https://server-a.test',
    on: vi.fn(),
    joinPrivateRoom: vi.fn(),
    joinPrivateRoomAsSpectator: vi.fn(),
    getPrivateRoomInfo: vi.fn(),
    leavePrivateRoom: vi.fn(),
    toggleRoomReady: vi.fn(),
    startRoomBattle: vi.fn(),
    disconnect: vi.fn(),
    replaceServer: vi.fn(),
    connect: vi.fn(),
  },
  auth: {
    serverGeneration: 0,
    serverUrl: 'https://server-a.test',
    hasSelectedServer: true,
    setServerUrl: vi.fn(),
    checkServerUrl: vi.fn(),
    serverInfo: {
      serverId: 'server-a',
      bootId: 'boot-a',
      runtime: { kind: 'native-v4', contentRevision: 'r', coreBuildId: 'incorrect', registryBuildId: 'incorrect' },
    },
  },
  gameData: { applyServerEnvironment: vi.fn(), clearServerEnvironment: vi.fn() },
  list: vi.fn(),
  prepare: vi.fn(),
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ currentRoute: { value: { path: '/', query: {} } }, push: mocks.push }),
}))
vi.mock('@/stores/battleClient', async () => {
  const { reactive } = await import('vue')
  return { useBattleClientStore: () => reactive(mocks.client) }
})
vi.mock('@/stores/auth', () => ({ useAuthStore: () => mocks.auth }))
vi.mock('@/stores/battle', () => ({ useBattleStore: () => mocks.battle }))
vi.mock('@/stores/player', () => ({ usePlayerStore: () => ({}) }))
vi.mock('@/stores/petStorage', () => ({ usePetStorageStore: () => ({ getCurrentTeam: () => [] }) }))
vi.mock('@/stores/gameData', () => ({ useGameDataStore: () => mocks.gameData }))
vi.mock('@/stores/serverState', () => ({ useServerStateStore: () => ({ updateServerState: vi.fn() }) }))
vi.mock('@/services/serverEnvironment', () => ({
  listServerEnvironments: mocks.list,
  prepareServerEnvironment: mocks.prepare,
}))

import { usePrivateRoomStore } from '../privateRoom'

beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  reactive(mocks.client).serverUrl = 'https://server-a.test'
  mocks.auth.serverUrl = 'https://server-a.test'
  mocks.auth.serverGeneration = 0
  mocks.auth.checkServerUrl.mockImplementation((value: string) => value)
  mocks.auth.setServerUrl.mockImplementation((value: string) => {
    mocks.auth.serverUrl = value
    mocks.auth.serverGeneration++
  })
  mocks.client.replaceServer.mockImplementation((value: string) => {
    reactive(mocks.client).serverUrl = value
  })
  mocks.client.connect.mockResolvedValue(undefined)
  mocks.client.joinPrivateRoom.mockResolvedValue(undefined)
  mocks.client.joinPrivateRoomAsSpectator.mockResolvedValue(undefined)
  mocks.client.leavePrivateRoom.mockResolvedValue(undefined)
  mocks.client.getPrivateRoomInfo.mockResolvedValue({
    config: { roomCode: 'ABC123', hostPlayerId: 'host', battleMode: 'p2p' },
    players: [{ playerId: 'host', isReady: false }],
    spectators: [],
    status: 'waiting',
  })
})

it('leaves the old room before replacing its authentication and connection', async () => {
  const store = usePrivateRoomStore()
  store.currentRoom = { config: { roomCode: 'ABC123' }, status: 'waiting' } as typeof store.currentRoom
  await store.switchServer('https://server-b.test')
  expect(mocks.client.leavePrivateRoom).toHaveBeenCalledOnce()
  expect(mocks.client.leavePrivateRoom.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.client.disconnect.mock.invocationCallOrder[0],
  )
  expect(mocks.client.disconnect.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.auth.setServerUrl.mock.invocationCallOrder[0],
  )
  expect(mocks.auth.setServerUrl).toHaveBeenCalledWith('https://server-b.test')
  expect(mocks.client.replaceServer).toHaveBeenCalledWith('https://server-b.test')
  expect(mocks.client.connect).toHaveBeenCalledOnce()
  expect(store.currentRoom).toBeNull()
  expect(store.isSwitchingServer).toBe(false)
})

it('keeps the old authority when leaving its room fails', async () => {
  const store = usePrivateRoomStore()
  store.currentRoom = { config: { roomCode: 'ABC123' }, status: 'waiting' } as typeof store.currentRoom
  mocks.client.leavePrivateRoom.mockRejectedValueOnce(new Error('leave failed'))
  await expect(store.switchServer('https://server-b.test')).rejects.toThrow('leave failed')
  expect(store.currentRoom?.config.roomCode).toBe('ABC123')
  expect(mocks.auth.setServerUrl).not.toHaveBeenCalled()
  expect(mocks.client.disconnect).not.toHaveBeenCalled()
})

it('does not leave a room if server selection storage cannot be prepared', async () => {
  const store = usePrivateRoomStore()
  store.currentRoom = { config: { roomCode: 'ABC123' }, status: 'waiting' } as typeof store.currentRoom
  mocks.auth.checkServerUrl.mockImplementationOnce(() => {
    throw new Error('storage unavailable')
  })
  await expect(store.switchServer('https://server-b.test')).rejects.toThrow('storage unavailable')
  expect(mocks.client.leavePrivateRoom).not.toHaveBeenCalled()
  expect(mocks.client.disconnect).not.toHaveBeenCalled()
  expect(store.currentRoom?.config.roomCode).toBe('ABC123')
})

it('reconnects the old authority if persisting selection fails before authentication changes', async () => {
  const store = usePrivateRoomStore()
  mocks.auth.setServerUrl.mockImplementationOnce(() => {
    throw new Error('storage unavailable')
  })
  await expect(store.switchServer('https://server-b.test')).rejects.toThrow('storage unavailable')
  expect(mocks.client.replaceServer).toHaveBeenCalledWith('https://server-a.test')
  expect(mocks.client.connect).toHaveBeenCalledOnce()
  expect(mocks.auth.serverUrl).toBe('https://server-a.test')
})

it('explains when the old connection was stopped and the new server is unavailable', async () => {
  const store = usePrivateRoomStore()
  mocks.client.connect.mockRejectedValueOnce(new Error('timeout'))
  await expect(store.switchServer('https://server-b.test')).rejects.toThrow(
    '旧服务器连接已终止，无法连接新服务器：timeout',
  )
  expect(mocks.auth.serverUrl).toBe('https://server-b.test')
  expect(store.isSwitchingServer).toBe(false)
})

it('waits for an in-flight join and then leaves that room before switching', async () => {
  let resolveJoin!: () => void
  mocks.client.joinPrivateRoom.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        resolveJoin = resolve
      }),
  )
  mocks.client.getPrivateRoomInfo.mockResolvedValueOnce({
    config: { roomCode: 'ABC123', hostPlayerId: 'host', battleMode: 'server' },
    players: [{ playerId: 'host', isReady: false }],
    spectators: [],
    status: 'waiting',
  })
  const store = usePrivateRoomStore()
  const joining = store.joinRoom('ABC123')
  const switching = store.switchServer('https://server-b.test')
  expect(mocks.auth.setServerUrl).not.toHaveBeenCalled()
  resolveJoin()
  await joining
  await switching
  expect(mocks.client.leavePrivateRoom).toHaveBeenCalledOnce()
  expect(mocks.auth.setServerUrl).toHaveBeenCalledWith('https://server-b.test')
})

it('allows the newest switch to win when an older connection finishes late', async () => {
  const store = usePrivateRoomStore()
  let finishFirst!: () => void
  mocks.client.connect.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finishFirst = resolve
      }),
  )
  const first = store.switchServer('https://server-b.test')
  await vi.waitFor(() => expect(mocks.client.connect).toHaveBeenCalledOnce())
  await store.switchServer('https://server-c.test')
  finishFirst()
  await first
  expect(mocks.auth.serverUrl).toBe('https://server-c.test')
  expect(mocks.client.serverUrl).toBe('https://server-c.test')
  expect(store.isSwitchingServer).toBe(false)
})

it('discards an old catalog response after the active connection changes', async () => {
  const store = usePrivateRoomStore()
  let resolveA!: (value: unknown[]) => void
  mocks.list
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveA = resolve
        }),
    )
    .mockResolvedValueOnce([{ id: 'server-b', packages: [] }])
  const first = store.refreshEnvironments()
  reactive(mocks.client).serverUrl = 'https://server-b.test'
  await nextTick()
  await store.refreshEnvironments()
  resolveA([{ id: 'server-a', packages: [] }])
  await first
  expect(store.environments.map(item => item.id)).toEqual(['server-b'])
  expect(mocks.list).toHaveBeenNthCalledWith(1, 'https://server-a.test', expect.any(Function), expect.any(AbortSignal))
  expect(mocks.list).toHaveBeenNthCalledWith(2, 'https://server-b.test', expect.any(Function), expect.any(AbortSignal))
})

for (const spectator of [false, true])
  it(`releases the seat if a ${spectator ? 'spectator' : 'player'} joins an incompatible P2P room`, async () => {
    const store = usePrivateRoomStore()
    const joining = spectator ? store.joinAsSpectator('ABC123') : store.joinRoom('ABC123')
    await expect(joining).rejects.toThrow('网页和服务器的对战版本不同')
    expect(mocks.client.leavePrivateRoom).toHaveBeenCalledOnce()
    expect(store.currentRoom).toBeNull()
  })

it('releases an admitted seat if retrieving room details fails', async () => {
  mocks.client.getPrivateRoomInfo.mockRejectedValueOnce(new Error('network'))
  const store = usePrivateRoomStore()
  await expect(store.joinRoom('ABC123')).rejects.toThrow('network')
  expect(mocks.client.leavePrivateRoom).toHaveBeenCalledOnce()
  expect(store.currentRoom).toBeNull()
})

it.each([true, false])('prepares server content on ready with local UGC packages=%s', async ugc => {
  const descriptor = {
    id: 'a'.repeat(64),
    protocolVersion: 1,
    resourceRevision: 'b'.repeat(64),
    packages: ugc ? [{ name: 'ugc', version: '1', projectId: 'ugc', namespace: 'ugc' }] : [],
    resources: [],
  }
  const acceptance = {
    environmentId: descriptor.id,
    protocolVersion: 1,
    resourceRevision: descriptor.resourceRevision,
    resourcesReady: true,
  }
  mocks.client.getPrivateRoomInfo.mockResolvedValue({
    config: { roomCode: 'ABC123', hostPlayerId: 'host', battleMode: 'server' },
    environment: descriptor,
    players: [{ playerId: 'host', isReady: false }],
    spectators: [],
    status: 'waiting',
  })
  mocks.prepare.mockResolvedValue({ content: { species: [], skills: [], marks: [] }, acceptance })
  const store = usePrivateRoomStore()
  await store.joinRoom('ABC123')
  await store.toggleReady()
  expect(mocks.client.joinPrivateRoom).toHaveBeenCalledWith({ roomCode: 'ABC123', password: undefined })
  expect(mocks.client.toggleRoomReady).toHaveBeenCalledWith([], acceptance)
  expect(mocks.gameData.applyServerEnvironment).toHaveBeenCalled()
  store.cleanup()
})

it('does not apply a response from an old server even when both servers use the same environment id', async () => {
  const descriptor = {
    id: 'a'.repeat(64),
    protocolVersion: 1,
    resourceRevision: 'b'.repeat(64),
    packages: [{ name: 'ugc', version: '1', projectId: 'ugc', namespace: 'ugc' }],
    resources: [],
  }
  mocks.client.getPrivateRoomInfo.mockResolvedValue({
    config: { roomCode: 'ABC123', hostPlayerId: 'host', battleMode: 'server' },
    environment: descriptor,
    players: [{ playerId: 'host', isReady: false }],
    spectators: [],
    status: 'waiting',
  })
  let finish!: (value: unknown) => void
  mocks.prepare.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      }),
  )
  const store = usePrivateRoomStore()
  const joining = store.joinRoom('ABC123')
  await vi.waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce())
  reactive(mocks.client).serverUrl = 'https://server-b.test'
  finish({ content: { species: [], skills: [], marks: [] }, acceptance: {} })
  await expect(joining).rejects.toThrow('房间环境已变化')
  expect(mocks.gameData.applyServerEnvironment).not.toHaveBeenCalled()
  expect(mocks.client.leavePrivateRoom).not.toHaveBeenCalled()
})

for (const fails of [false, true]) {
  it(`ignores an old battle initialization after switching servers (${fails ? 'failure' : 'success'})`, async () => {
    let finish!: () => void
    mocks.battle.initBattle.mockImplementationOnce(
      () =>
        new Promise<void>((resolve, reject) => {
          finish = () => (fails ? reject(new Error('old connection failed')) : resolve())
        }),
    )
    const store = usePrivateRoomStore()
    store.currentRoom = {
      config: { roomCode: 'AAAAAA', battleMode: 'server', hostPlayerId: 'host' },
      status: 'started',
      players: [{ playerId: 'host' }],
      spectators: [],
      battleRoomId: 'battle-a',
    } as typeof store.currentRoom
    const handler = mocks.client.on.mock.calls.find(([name]) => name === 'privateRoomEvent')![1]
    const old = handler({ type: 'battleStarted', data: { battleMode: 'server', battleRoomId: 'battle-a' } })
    expect(mocks.battle.initBattle).toHaveBeenCalledOnce()
    const isCurrent = mocks.battle.initBattle.mock.calls[0][2]
    expect(isCurrent()).toBe(true)
    await store.switchServer('https://server-b.test')
    expect(isCurrent()).toBe(false)
    finish()
    await old
    expect(mocks.push).not.toHaveBeenCalled()
    expect(store.error).toBeNull()
    expect(store.currentRoom).toBeNull()
  })
}

it('does not initialize a P2P battle after its room lookup finishes on a different server', async () => {
  let finish!: (room: unknown) => void
  mocks.client.getPrivateRoomInfo.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      }),
  )
  const store = usePrivateRoomStore()
  const room = {
    config: { roomCode: 'AAAAAA', battleMode: 'p2p', hostPlayerId: 'host' },
    status: 'started',
    players: [{ playerId: 'host' }],
    spectators: [],
    battleRoomId: 'battle-a',
  }
  store.currentRoom = room as typeof store.currentRoom
  const handler = mocks.client.on.mock.calls.find(([name]) => name === 'privateRoomEvent')![1]
  const old = handler({ type: 'battleStarted', data: { battleMode: 'p2p', battleRoomId: 'battle-a' } })
  await store.switchServer('https://server-b.test')
  finish(room)
  await old
  expect(store.currentRoom).toBeNull()
  expect(mocks.battle.initBattle).not.toHaveBeenCalled()
  expect(mocks.push).not.toHaveBeenCalled()
})

it('keeps a running battle active if leaving the old server fails', async () => {
  const store = usePrivateRoomStore()
  store.currentRoom = {
    config: { roomCode: 'AAAAAA', battleMode: 'server', hostPlayerId: 'host' },
    status: 'started',
    players: [{ playerId: 'host' }],
    spectators: [],
    battleRoomId: 'battle-a',
  } as typeof store.currentRoom
  mocks.battle.initBattle.mockResolvedValueOnce(undefined)
  const handler = mocks.client.on.mock.calls.find(([name]) => name === 'privateRoomEvent')![1]
  await handler({ type: 'battleStarted', data: { battleMode: 'server', battleRoomId: 'battle-a' } })
  const isCurrent = mocks.battle.initBattle.mock.calls[0][2]
  mocks.client.leavePrivateRoom.mockImplementationOnce(async () => {
    expect(isCurrent()).toBe(true)
    throw new Error('leave failed')
  })
  await expect(store.switchServer('https://server-b.test')).rejects.toThrow('leave failed')
  expect(isCurrent()).toBe(true)
  expect(store.currentRoom?.battleRoomId).toBe('battle-a')
})

it('cancels content preparation before it can apply metadata or enter matchmaking', async () => {
  const store = usePrivateRoomStore()
  const descriptor = { id: 'match-environment', packages: [] }
  mocks.list.mockResolvedValueOnce([descriptor])
  let finish!: (value: unknown) => void
  mocks.prepare.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      }),
  )
  const joining = store.joinMatchmaking([], descriptor.id)
  const rejected = expect(joining).rejects.toThrow('对战内容已变化')
  await vi.waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce())
  await store.cancelMatchmaking()
  finish({ content: { species: [], skills: [], marks: [] }, acceptance: {} })
  await rejected
  expect(mocks.client.joinMatchmaking).not.toHaveBeenCalled()
  expect(mocks.gameData.applyServerEnvironment).not.toHaveBeenCalled()
})

it('cancels the old matchmaking queue before switching servers', async () => {
  const store = usePrivateRoomStore()
  mocks.client.currentState.matchmaking = 'searching'
  mocks.client.cancelMatchmaking.mockResolvedValueOnce(undefined)
  await store.switchServer('https://server-b.test')
  expect(mocks.client.cancelMatchmaking).toHaveBeenCalledOnce()
  expect(mocks.client.cancelMatchmaking.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.client.disconnect.mock.invocationCallOrder[0],
  )
  mocks.client.currentState.matchmaking = 'idle'
})
