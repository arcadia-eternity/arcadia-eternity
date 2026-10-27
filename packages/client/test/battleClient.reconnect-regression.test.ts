import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TimerState, type PlayerTimerState, type TimerConfig } from '@arcadia-eternity/const'
import { BattleClient } from '../src/client'

const mockedSocketIo = vi.hoisted(() => {
  type Handler = (...args: any[]) => void

  class FakeSocket {
    connected = false
    auth: Record<string, unknown> | ((callback: (data: Record<string, unknown>) => void) => void) = {}
    handshakes: Array<{ auth: Record<string, unknown>; query: Record<string, unknown> }> = []
    connectionErrors: Error[] = []
    emitted: string[] = []
    io: { opts: { query: Record<string, unknown> } } = { opts: { query: {} } }

    private listeners = new Map<string, Set<Handler>>()
    private onceListeners = new Map<string, Set<Handler>>()
    private responders = new Map<string, Handler>()

    on(event: string, handler: Handler): this {
      if (!this.listeners.has(event)) {
        this.listeners.set(event, new Set())
      }
      this.listeners.get(event)!.add(handler)
      return this
    }

    off(event: string, handler?: Handler): this {
      if (!handler) {
        this.listeners.delete(event)
        this.onceListeners.delete(event)
        return this
      }

      this.listeners.get(event)?.delete(handler)
      this.onceListeners.get(event)?.delete(handler)
      return this
    }

    once(event: string, handler: Handler): this {
      if (!this.onceListeners.has(event)) {
        this.onceListeners.set(event, new Set())
      }
      this.onceListeners.get(event)!.add(handler)
      return this
    }

    emit(event: string, ...args: any[]): this {
      this.emitted.push(event)
      const responder = this.responders.get(event)
      if (responder) {
        responder(...args)
      }
      return this
    }

    connect(): this {
      let auth: Record<string, unknown> = {}
      if (typeof this.auth === 'function')
        this.auth(data => {
          auth = data
        })
      else auth = this.auth
      this.handshakes.push({ auth, query: { ...this.io.opts.query } })
      const error = this.connectionErrors.shift()
      if (error) {
        this.connected = false
        this.trigger('connect_error', error)
        return this
      }
      this.connected = true
      this.trigger('connect')
      return this
    }

    disconnect(): this {
      this.connected = false
      this.trigger('disconnect')
      return this
    }

    setResponder(event: string, responder: Handler): void {
      this.responders.set(event, responder)
    }

    trigger(event: string, ...args: any[]): void {
      const persistentHandlers = this.listeners.get(event)
      if (persistentHandlers) {
        for (const handler of persistentHandlers) {
          handler(...args)
        }
      }

      const onceHandlers = this.onceListeners.get(event)
      if (onceHandlers) {
        this.onceListeners.delete(event)
        for (const handler of onceHandlers) {
          handler(...args)
        }
      }
    }
  }

  return {
    FakeSocket,
    sockets: [] as FakeSocket[],
  }
})

vi.mock('socket.io-client', () => ({
  io: (_url: string, options: Record<string, any>) => {
    const socket = new mockedSocketIo.FakeSocket()
    socket.auth = options.auth ?? {}
    socket.io.opts.query = options.query ?? {}
    mockedSocketIo.sockets.push(socket)
    return socket
  },
}))

function createSessionStorageMock(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
  }
}

async function createConnectedBattleClient() {
  const client = new BattleClient({
    serverUrl: 'http://localhost:8102',
  })
  const socket = mockedSocketIo.sockets.at(-1)!

  socket.setResponder('getServerState', (ack?: (response: unknown) => void) => {
    ack?.({
      status: 'SUCCESS',
      data: {
        onlinePlayers: 0,
        matchmakingQueue: 0,
        rooms: 0,
        playersInRooms: 0,
      },
    })
  })

  await client.connect()
  socket.trigger('matchSuccess', {
    status: 'SUCCESS',
    data: {
      roomId: 'room-1',
      opponent: { id: 'opponent-1', name: 'Opponent' },
    },
  })

  return { client, socket }
}

describe('BattleClient reconnect regressions', () => {
  beforeEach(() => {
    mockedSocketIo.sockets.length = 0
    vi.stubGlobal('sessionStorage', createSessionStorageMock())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not mark battle ended when roomClosed arrives right after battle end message', async () => {
    const { client, socket } = await createConnectedBattleClient()
    const battleTerminated = vi.fn()

    ;(client as any).on('battleTerminated', battleTerminated)

    socket.trigger('battleEvent', {
      type: 'BATTLE_END',
    })
    socket.trigger('roomClosed', { roomId: 'room-1' })

    expect(client.currentState.battle).toBe('active')
    expect(client.currentState.matchmaking).toBe('matched')
    expect(client.currentState.roomId).toBe('room-1')
    expect(battleTerminated).not.toHaveBeenCalled()
  })

  it('marks battle ended when roomClosed arrives without recent battle end message', async () => {
    const { client, socket } = await createConnectedBattleClient()
    const battleTerminated = vi.fn()

    ;(client as any).on('battleTerminated', battleTerminated)
    socket.trigger('roomClosed', { roomId: 'room-1' })

    expect(client.currentState.battle).toBe('ended')
    expect(client.currentState.matchmaking).toBe('idle')
    expect(client.currentState.roomId).toBeUndefined()
    expect(battleTerminated).toHaveBeenCalledWith({ reason: 'room-closed' })
  })

  it('refreshes timer snapshots from server and emits timerSnapshot event', async () => {
    const { client, socket } = await createConnectedBattleClient()
    const timerSnapshotHandler = vi.fn()
    const timerStates: PlayerTimerState[] = [
      {
        playerId: 'player-1',
        state: TimerState.Running,
        remainingTurnTime: 22,
        remainingTotalTime: 120,
        lastUpdateTime: Date.now(),
      },
      {
        playerId: 'player-2',
        state: TimerState.Paused,
        remainingTurnTime: 11,
        remainingTotalTime: 80,
        lastUpdateTime: Date.now(),
      },
    ]
    const timerConfig: TimerConfig = {
      enabled: true,
      turnTimeLimit: 30,
      totalTimeLimit: 150,
      animationPauseEnabled: true,
      maxAnimationDuration: 20000,
    }

    socket.setResponder('getAllPlayerTimerStates', (ack?: (response: unknown) => void) => {
      ack?.({
        status: 'SUCCESS',
        data: timerStates,
      })
    })
    socket.setResponder('getTimerConfig', (ack?: (response: unknown) => void) => {
      ack?.({
        status: 'SUCCESS',
        data: timerConfig,
      })
    })

    client.onTimerEvent('timerSnapshot', timerSnapshotHandler)
    await client.refreshTimerSnapshotsFromServer()

    const snapshots = client.getAllTimerSnapshots()
    expect(snapshots).toHaveLength(2)
    expect(snapshots[0].playerId).toBe('player-1')
    expect(snapshots[0].state).toBe(TimerState.Running)
    expect(snapshots[0].config).toEqual(timerConfig)
    expect(snapshots[1].playerId).toBe('player-2')
    expect(snapshots[1].pauseReason).toBe('system')
    expect(timerSnapshotHandler).toHaveBeenCalledTimes(1)
    expect(timerSnapshotHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshots: expect.arrayContaining([
          expect.objectContaining({ playerId: 'player-1' }),
          expect.objectContaining({ playerId: 'player-2' }),
        ]),
      }),
    )
  })
})

describe('BattleClient server session authorization', () => {
  beforeEach(() => {
    mockedSocketIo.sockets.length = 0
    vi.stubGlobal('sessionStorage', createSessionStorageMock())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function createAuthenticatedClient() {
    const credentials = { token: 'token-old', sessionId: 'session-old' }
    const getPlayerId = vi.fn(() => 'local-profile-is-not-authority')
    const refreshAuth = vi.fn(async () => {
      credentials.token = 'token-new'
      credentials.sessionId = 'session-new'
    })
    const client = new BattleClient({
      serverUrl: 'http://localhost:8102',
      auth: {
        getToken: () => credentials.token || null,
        getSessionId: () => credentials.sessionId || null,
        getPlayerId,
        refreshAuth,
      },
    })
    const socket = mockedSocketIo.sockets.at(-1)!
    return { client, socket, credentials, getPlayerId, refreshAuth }
  }

  function enterBattle(socket: InstanceType<typeof mockedSocketIo.FakeSocket>) {
    socket.trigger('matchSuccess', {
      status: 'SUCCESS',
      data: { roomId: 'room-old', opponent: { id: 'seat-other', name: 'Opponent' } },
    })
  }

  it('authenticates with only a token and never sends profile, seat or tab IDs in query', async () => {
    const { client, socket, getPlayerId } = createAuthenticatedClient()
    await client.connect()
    expect(socket.handshakes).toEqual([{ auth: { token: 'token-old' }, query: {} }])
    expect(getPlayerId).not.toHaveBeenCalled()
  })

  it('preserves battle state when a valid session reconnects with a refreshed token', async () => {
    const { client, socket, credentials } = createAuthenticatedClient()
    await client.connect()
    enterBattle(socket)
    socket.disconnect()
    credentials.token = 'token-refreshed'
    socket.connect()
    expect(socket.handshakes.at(-1)?.auth).toEqual({ token: 'token-refreshed' })
    expect(client.currentState).toMatchObject({ status: 'connected', battle: 'active', roomId: 'room-old' })
  })

  it('reacquires an expired session and clears its former room instead of reclaiming it by UID', async () => {
    const { client, socket, refreshAuth } = createAuthenticatedClient()
    const terminated = vi.fn()
    ;(client as any).on('battleTerminated', terminated)
    await client.connect()
    enterBattle(socket)
    socket.trigger('timerSnapshot', { snapshots: [{ playerId: 'seat-old' }] })
    socket.disconnect()
    socket.connectionErrors.push(new Error('INVALID_SESSION'))
    await client.connect()

    expect(refreshAuth).toHaveBeenCalledTimes(1)
    expect(socket.handshakes.at(-1)).toEqual({ auth: { token: 'token-new' }, query: {} })
    expect(client.currentState).toMatchObject({ status: 'connected', battle: 'idle', matchmaking: 'idle' })
    expect(client.currentState.roomId).toBeUndefined()
    expect(client.getAllTimerSnapshots()).toEqual([])
    expect(terminated).toHaveBeenCalledWith({ reason: 'session-changed' })
    // The failed connection attempt must not leave a second connect listener behind.
    expect(socket.emitted.filter(event => event === 'getServerState')).toHaveLength(2)
  })

  it('refreshes authentication after an automatic reconnect is rejected', async () => {
    const { client, socket, refreshAuth } = createAuthenticatedClient()
    await client.connect()
    enterBattle(socket)
    socket.disconnect()
    socket.connectionErrors.push(new Error('SESSION_EXPIRED'))
    socket.connect()

    await vi.waitFor(() => expect(socket.connected).toBe(true))
    expect(refreshAuth).toHaveBeenCalledTimes(1)
    expect(socket.handshakes.at(-1)?.auth).toEqual({ token: 'token-new' })
    expect(client.currentState.roomId).toBeUndefined()
  })

  it('removes obsolete credentials when the auth provider no longer has a token', async () => {
    const { client, socket, credentials } = createAuthenticatedClient()
    await client.connect()
    enterBattle(socket)
    socket.disconnect()
    credentials.token = ''
    socket.connect()
    expect(socket.handshakes.at(-1)).toEqual({ auth: {}, query: {} })
    expect(client.currentState.roomId).toBeUndefined()
  })

  it('does not reconnect after explicit disconnect while session renewal is pending', async () => {
    const { client, socket, refreshAuth } = createAuthenticatedClient()
    let finishRefresh!: () => void
    refreshAuth.mockImplementationOnce(
      () =>
        new Promise<void>(resolve => {
          finishRefresh = resolve
        }),
    )
    await client.connect()
    socket.disconnect()
    socket.connectionErrors.push(new Error('INVALID_SESSION'))
    socket.connect()
    client.disconnect()
    finishRefresh()
    await vi.waitFor(() => expect(refreshAuth).toHaveBeenCalledTimes(1))
    await Promise.resolve()
    expect(socket.handshakes).toHaveLength(2)
    expect(client.currentState.status).toBe('disconnected')
  })
})

describe('BattleClient command ordering', () => {
  beforeEach(() => {
    mockedSocketIo.sockets.length = 0
    vi.stubGlobal('sessionStorage', createSessionStorageMock())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reuses the same command ID and expected turn after an acknowledgement timeout', async () => {
    vi.useFakeTimers()
    const { client, socket } = await createConnectedBattleClient()
    socket.trigger('battleEvent', { type: 'TURN_START', data: { turn: 4 }, stateDelta: {} })
    const requests: Array<Record<string, unknown>> = []
    socket.setResponder('submitPlayerSelection', (request, ack) => {
      requests.push(request)
      if (requests.length === 2) ack({ status: 'SUCCESS', data: { status: 'ACTION_ACCEPTED' } })
    })
    const action = { player: 'seat-a', type: 'do-nothing' } as any
    const submitted = client.sendplayerSelection(action)
    await vi.advanceTimersByTimeAsync(30000)
    await submitted
    expect(requests).toHaveLength(2)
    expect(requests[0]).toEqual(requests[1])
    expect(requests[0]).toMatchObject({ ...action, expectedTurn: 4, requestId: expect.any(String) })
  })

  it('tracks turn deltas and full reconnect state before sending a new command', async () => {
    const { client, socket } = await createConnectedBattleClient()
    const requests: Array<Record<string, unknown>> = []
    socket.setResponder('submitPlayerSelection', (request, ack) => {
      requests.push(request)
      ack({ status: 'SUCCESS', data: { status: 'ACTION_ACCEPTED' } })
    })
    socket.trigger('battleReconnect', {
      roomId: 'room-1',
      shouldRedirect: true,
      battleState: 'active',
      fullBattleState: { currentTurn: 7 },
    })
    await client.sendplayerSelection({ player: 'seat-a', type: 'do-nothing' } as any)
    socket.trigger('battleEventBatch', [{ type: 'TURN_START', data: { turn: 8 }, stateDelta: { currentTurn: [7, 8] } }])
    await client.sendplayerSelection({ player: 'seat-a', type: 'do-nothing' } as any)
    expect(requests.map(request => request.expectedTurn)).toEqual([7, 8])
    expect(requests[0].requestId).not.toBe(requests[1].requestId)
  })

  it('loads the current turn when restoring a battle without a full state', async () => {
    const { client, socket } = await createConnectedBattleClient()
    socket.setResponder('getState', ack => ack({ status: 'SUCCESS', data: { currentTurn: 3 } }))
    const submit = vi.fn((_request, ack) => ack({ status: 'SUCCESS', data: { status: 'ACTION_ACCEPTED' } }))
    socket.setResponder('submitPlayerSelection', submit)
    await client.sendplayerSelection({ player: 'seat-a', type: 'do-nothing' } as any)
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ expectedTurn: 3 }), expect.any(Function))
  })

  it('passes spectator passwords and authoritative host completion to the server', async () => {
    const { client, socket } = await createConnectedBattleClient()
    const spectator = vi.fn((_data, ack) => ack({ status: 'SUCCESS', data: { status: 'JOINED' } }))
    const finish = vi.fn((_data, ack) => ack({ status: 'SUCCESS', data: { status: 'FINISHED' } }))
    socket.setResponder('joinPrivateRoomAsSpectator', spectator)
    socket.setResponder('finishPrivateRoomBattle', finish)
    await client.joinPrivateRoomAsSpectator({ roomCode: 'secret-room', password: 'room-password' })
    await client.finishPrivateRoomBattle({ winner: 'seat-a', reason: 'all-pets-defeated' })
    expect(spectator).toHaveBeenCalledWith({ roomCode: 'secret-room', password: 'room-password' }, expect.any(Function))
    expect(finish).toHaveBeenCalledWith({ winner: 'seat-a', reason: 'all-pets-defeated' }, expect.any(Function))
  })

  it('sends the selected server environment and resource readiness while preserving legacy room calls', async () => {
    const { client, socket } = await createConnectedBattleClient()
    const create = vi.fn((_data, ack) => ack({ status: 'SUCCESS', data: { roomCode: 'UGC123' } }))
    const ready = vi.fn((_data, ack) => ack({ status: 'SUCCESS', data: { status: 'READY_TOGGLED' } }))
    const start = vi.fn((_data, ack) => ack({ status: 'SUCCESS', data: { battleRoomId: 'battle-1' } }))
    socket.setResponder('createPrivateRoom', create)
    socket.setResponder('togglePrivateRoomReady', ready)
    socket.setResponder('startPrivateRoomBattle', start)
    const environment = {
      environmentId: 'a'.repeat(64),
      protocolVersion: 1 as const,
      resourceRevision: 'b'.repeat(64),
      resourcesReady: true,
    }
    await expect(
      client.createPrivateRoom({ environmentId: environment.environmentId, config: { battleMode: 'server' } }),
    ).resolves.toBe('UGC123')
    await client.togglePrivateRoomReady([], environment)
    await client.startPrivateRoomBattle([], environment)
    expect(create).toHaveBeenCalledWith(
      { environmentId: environment.environmentId, config: { battleMode: 'server' } },
      expect.any(Function),
    )
    expect(ready).toHaveBeenCalledWith({ team: [], environment }, expect.any(Function))
    expect(start).toHaveBeenCalledWith({ hostTeam: [], environment }, expect.any(Function))

    await client.togglePrivateRoomReady()
    await client.startPrivateRoomBattle([])
    expect(ready).toHaveBeenLastCalledWith({ team: undefined }, expect.any(Function))
    expect(start).toHaveBeenLastCalledWith({ hostTeam: [] }, expect.any(Function))
  })

  it('removes only the selected subscription and dispatches internal and direct events once', async () => {
    const { client, socket } = await createConnectedBattleClient()
    const first = vi.fn(),
      second = vi.fn()
    const disposeFirst = client.on('roomClosed', first)
    client.on('roomClosed', second)
    socket.trigger('roomClosed', { roomId: 'room-1' })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    disposeFirst()
    socket.trigger('roomClosed', { roomId: 'room-1' })
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
    client.off('roomClosed', second)
    socket.trigger('roomClosed', { roomId: 'room-1' })
    expect(second).toHaveBeenCalledTimes(2)

    const directA = vi.fn(),
      directB = vi.fn()
    const disposeA = client.on('matchmakingError', directA)
    client.on('matchmakingError', directB)
    socket.trigger('matchmakingError', { status: 'ERROR', code: 'ONE' })
    disposeA()
    socket.trigger('matchmakingError', { status: 'ERROR', code: 'TWO' })
    expect(directA).toHaveBeenCalledTimes(1)
    expect(directB).toHaveBeenCalledTimes(2)

    const duplicate = vi.fn()
    const disposeOne = client.on('reconnectTest', duplicate)
    client.on('reconnectTest', duplicate)
    disposeOne()
    socket.trigger('reconnectTest', { message: 'one', timestamp: 1 })
    expect(duplicate).toHaveBeenCalledTimes(1)
    client.off('reconnectTest', duplicate)
    socket.trigger('reconnectTest', { message: 'two', timestamp: 2 })
    expect(duplicate).toHaveBeenCalledTimes(1)
  })

  it('cleans direct and one-shot callbacks on disconnect while preserving internal listeners after reconnect', async () => {
    const { client, socket } = await createConnectedBattleClient()
    const old = vi.fn(),
      once = vi.fn()
    const disposeOld = client.on('matchmakingError', old)
    client.once('matchmakingError', once)
    client.disconnect()
    socket.trigger('matchmakingError', { status: 'ERROR', code: 'OFFLINE' })
    expect(old).not.toHaveBeenCalled()
    expect(once).not.toHaveBeenCalled()

    await client.connect()
    const current = vi.fn()
    client.on('matchmakingError', current)
    disposeOld() // An old unsubscribe must not remove a new subscription.
    socket.trigger('matchmakingError', { status: 'ERROR', code: 'ONLINE' })
    expect(current).toHaveBeenCalledTimes(1)
    socket.trigger('matchSuccess', {
      status: 'SUCCESS',
      data: { roomId: 'after-reconnect', opponent: { id: 'x', name: 'X' } },
    })
    expect(client.currentState.roomId).toBe('after-reconnect')
    client.disconnect()
    await client.connect()
    socket.trigger('matchmakingError', { status: 'ERROR', code: 'AFTER-SECOND-RECONNECT' })
    expect(current).toHaveBeenCalledTimes(1)
    const newOnce = vi.fn()
    client.once('reconnectTest', newOnce)
    socket.trigger('reconnectTest', { message: 'first', timestamp: 1 })
    socket.trigger('reconnectTest', { message: 'second', timestamp: 2 })
    expect(newOnce).toHaveBeenCalledTimes(1)
  })
})
