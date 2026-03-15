import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TimerState, type PlayerTimerState, type TimerConfig } from '@arcadia-eternity/const'
import { BattleClient } from '../src/client'

const mockedSocketIo = vi.hoisted(() => {
  type Handler = (...args: any[]) => void

  class FakeSocket {
    connected = false
    auth: Record<string, unknown> = {}
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
      const responder = this.responders.get(event)
      if (responder) {
        responder(...args)
      }
      return this
    }

    connect(): this {
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
  io: () => {
    const socket = new mockedSocketIo.FakeSocket()
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
