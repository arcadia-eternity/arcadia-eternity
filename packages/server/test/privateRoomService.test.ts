import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PrivateRoomService } from '../src/domain/room/services/privateRoomService'
import { REDIS_KEYS } from '../src/cluster/types'
import { ServerRuleIntegration } from '@arcadia-eternity/rules'
import type { RoomPlayer } from '../src/domain/room/types/PrivateRoom'

class FakeRedisClient {
  private readonly strings = new Map<string, string>()
  private readonly sets = new Map<string, Set<string>>()
  public readonly published: Array<{ channel: string; message: string }> = []

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null
  }

  async setex(key: string, _ttl: number, value: string): Promise<void> {
    this.strings.set(key, value)
  }

  async sadd(key: string, value: string): Promise<void> {
    const set = this.sets.get(key) ?? new Set<string>()
    set.add(value)
    this.sets.set(key, set)
  }

  async srem(key: string, value: string): Promise<void> {
    this.sets.get(key)?.delete(value)
  }

  async smembers(key: string): Promise<string[]> {
    return [...(this.sets.get(key) ?? new Set<string>())]
  }

  async expire(_key: string, _ttl: number): Promise<void> {
    // noop for tests
  }

  async del(key: string): Promise<void> {
    this.strings.delete(key)
    this.sets.delete(key)
  }

  async keys(pattern: string): Promise<string[]> {
    if (!pattern.includes('*')) {
      return this.strings.has(pattern) ? [pattern] : []
    }
    const prefix = pattern.split('*')[0]
    return [...this.strings.keys()].filter(key => key.startsWith(prefix))
  }

  async publish(channel: string, message: string): Promise<void> {
    this.published.push({ channel, message })
  }

  subscribe(_channel: string, cb?: (err?: Error | null) => void): void {
    cb?.(null)
  }

  psubscribe(_pattern: string): void {
    // noop
  }

  on(_event: string, _handler: (...args: any[]) => void): void {
    // noop
  }
}

const createDependencies = () => {
  const redis = new FakeRedisClient()
  const stateManager = {
    redisManager: {
      getClient: () => redis,
      getPublisher: () => redis,
      getSubscriber: () => redis,
    },
  }

  const lockManager = {
    withLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => await fn()),
  }

  const sessionStateManager = {
    canEnterPrivateRoom: vi.fn(async () => ({ allowed: true })),
    setSessionState: vi.fn(async () => undefined),
    clearSessionState: vi.fn(async () => undefined),
  }

  return { redis, stateManager, lockManager, sessionStateManager }
}

const createPlayer = (overrides: Partial<RoomPlayer> = {}): RoomPlayer => ({
  playerId: overrides.playerId ?? 'player-1',
  playerName: overrides.playerName ?? 'Player 1',
  sessionId: overrides.sessionId ?? 'session-1',
  isReady: overrides.isReady ?? false,
  joinedAt: overrides.joinedAt ?? Date.now(),
  connectionStatus: overrides.connectionStatus ?? 'online',
  team: overrides.team,
})

describe('PrivateRoomService', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(ServerRuleIntegration, 'validateTeamWithRuleSet').mockResolvedValue({
      isValid: true,
      errors: [],
    } as any)
    vi.spyOn(PrivateRoomService.prototype as any, 'startRoomCleanup').mockImplementation(() => {})
    vi.spyOn(PrivateRoomService.prototype as any, 'subscribeToBattleFinishedEvents').mockImplementation(() => {})
  })

  it('defaults new rooms to p2p battleMode', async () => {
    const { stateManager, lockManager, sessionStateManager } = createDependencies()
    const service = new PrivateRoomService(stateManager as any, lockManager as any, sessionStateManager as any)

    const roomCode = await service.createRoom(createPlayer(), {})
    const room = await service.getRoom(roomCode)

    expect(room?.config.battleMode).toBe('p2p')
    expect(room?.config.requiredPackLock).toBeDefined()
  })

  it('starts server-mode private battles with correct start info', async () => {
    const { redis, stateManager, lockManager, sessionStateManager } = createDependencies()
    const service = new PrivateRoomService(stateManager as any, lockManager as any, sessionStateManager as any)
    service.setBattleCallbacks({
      createClusterBattleRoom: vi.fn(async () => 'battle-room-server'),
      joinSpectateBattle: vi.fn(async () => true),
      leaveSpectateBattle: vi.fn(async () => undefined),
    })

    const host = createPlayer({
      playerId: 'host',
      sessionId: 'host-session',
      playerName: 'Host',
      team: [{ id: 'pet-a' } as any],
    })
    const guest = createPlayer({
      playerId: 'guest',
      sessionId: 'guest-session',
      playerName: 'Guest',
      isReady: true,
      team: [{ id: 'pet-b' } as any],
    })

    const roomCode = await service.createRoom(host, { battleMode: 'server' })
    await service.joinRoom({ roomCode }, guest, 'player')

    const startInfo = await service.startBattle(roomCode, 'host', [{ id: 'pet-a' } as any])
    const room = await service.getRoom(roomCode)

    expect(startInfo).toEqual({
      battleMode: 'server',
      battleRoomId: 'battle-room-server',
      battleHost: {
        playerId: 'host',
        sessionId: 'host-session',
      },
    })
    expect(room?.status).toBe('started')
    expect(room?.battleRoomId).toBe('battle-room-server')
    expect(room?.battleHost).toEqual(startInfo.battleHost)
    expect(redis.published.some(entry => entry.channel === REDIS_KEYS.PRIVATE_ROOM_EVENTS(roomCode))).toBe(true)
  })

  it('starts p2p-mode private battles without creating server battle rooms', async () => {
    const { stateManager, lockManager, sessionStateManager } = createDependencies()
    const createClusterBattleRoom = vi.fn(async () => 'battle-room-p2p-fallback')
    const service = new PrivateRoomService(stateManager as any, lockManager as any, sessionStateManager as any)
    service.setBattleCallbacks({
      createClusterBattleRoom,
      joinSpectateBattle: vi.fn(async () => true),
      leaveSpectateBattle: vi.fn(async () => undefined),
    })

    const host = createPlayer({
      playerId: 'host',
      sessionId: 'host-session',
      playerName: 'Host',
      team: [{ id: 'pet-a' } as any],
    })
    const guest = createPlayer({
      playerId: 'guest',
      sessionId: 'guest-session',
      playerName: 'Guest',
      isReady: true,
      team: [{ id: 'pet-b' } as any],
    })

    const roomCode = await service.createRoom(host, { battleMode: 'p2p' })
    await service.joinRoom({ roomCode }, guest, 'player')

    const startInfo = await service.startBattle(roomCode, 'host', [{ id: 'pet-a' } as any])

    expect(startInfo.battleMode).toBe('p2p')
    expect(startInfo.battleHost).toEqual({
      playerId: 'host',
      sessionId: 'host-session',
    })
    expect(startInfo.battleRoomId).toBeUndefined()
    expect(createClusterBattleRoom).not.toHaveBeenCalled()
  })

  it('fails to start when battle callbacks are not configured', async () => {
    const { stateManager, lockManager, sessionStateManager } = createDependencies()
    const service = new PrivateRoomService(stateManager as any, lockManager as any, sessionStateManager as any)

    const host = createPlayer({
      playerId: 'host',
      sessionId: 'host-session',
      playerName: 'Host',
      team: [{ id: 'pet-a' } as any],
    })
    const guest = createPlayer({
      playerId: 'guest',
      sessionId: 'guest-session',
      playerName: 'Guest',
      isReady: true,
      team: [{ id: 'pet-b' } as any],
    })

    const roomCode = await service.createRoom(host, { battleMode: 'server' })
    await service.joinRoom({ roomCode }, guest, 'player')

    await expect(service.startBattle(roomCode, 'host', [{ id: 'pet-a' } as any])).rejects.toMatchObject({
      code: 'INVALID_STATE',
    })
  })

  it('keeps waiting-room participants and restores a new session after reconnect', async () => {
    const { stateManager, lockManager, sessionStateManager } = createDependencies()
    const service = new PrivateRoomService(stateManager as any, lockManager as any, sessionStateManager as any)

    const host = createPlayer({
      playerId: 'host',
      sessionId: 'host-session-1',
      playerName: 'Host',
    })

    const roomCode = await service.createRoom(host, { battleMode: 'p2p' })

    await service.handlePlayerDisconnect(roomCode, 'host', 'host-session-1')

    const disconnectedRoom = await service.getRoom(roomCode)
    expect(disconnectedRoom?.players[0]?.connectionStatus).toBe('offline')
    expect(disconnectedRoom?.players[0]?.sessionId).toBe('host-session-1')

    const restoredRoom = await service.restorePlayerSessionCurrentRoom('host', 'host-session-2')
    expect(restoredRoom?.config.roomCode).toBe(roomCode)
    expect(restoredRoom?.players[0]?.sessionId).toBe('host-session-2')
    expect(restoredRoom?.players[0]?.connectionStatus).toBe('online')
    expect(sessionStateManager.setSessionState).toHaveBeenCalledWith('host', 'host-session-2', 'private_room', {
      roomCode,
    })
  })

  it('relays peer signals only in p2p rooms', async () => {
    const { redis, stateManager, lockManager, sessionStateManager } = createDependencies()
    const service = new PrivateRoomService(stateManager as any, lockManager as any, sessionStateManager as any)

    const host = createPlayer({
      playerId: 'host',
      sessionId: 'host-session',
      playerName: 'Host',
    })
    const guest = createPlayer({
      playerId: 'guest',
      sessionId: 'guest-session',
      playerName: 'Guest',
    })

    const roomCode = await service.createRoom(host, { battleMode: 'p2p' })
    await service.joinRoom({ roomCode }, guest, 'player')

    await service.relayPeerSignal(roomCode, 'host', 'host-session', {
      targetPlayerId: 'guest',
      signal: {
        transport: 'webrtc',
        kind: 'offer',
        payload: { sdp: 'test-offer' },
      },
    })

    const signalMessage = redis.published.find(entry => entry.channel === REDIS_KEYS.PRIVATE_ROOM_SIGNAL_EVENTS(roomCode))
    expect(signalMessage).toBeDefined()
    expect(JSON.parse(signalMessage!.message)).toMatchObject({
      roomCode,
      from: {
        playerId: 'host',
        sessionId: 'host-session',
      },
      to: {
        playerId: 'guest',
        sessionId: 'guest-session',
      },
      signal: {
        transport: 'webrtc',
        kind: 'offer',
        payload: { sdp: 'test-offer' },
      },
    })
  })

  it('rejects peer signals for server-mode rooms', async () => {
    const { stateManager, lockManager, sessionStateManager } = createDependencies()
    const service = new PrivateRoomService(stateManager as any, lockManager as any, sessionStateManager as any)

    const host = createPlayer({
      playerId: 'host',
      sessionId: 'host-session',
      playerName: 'Host',
    })
    const guest = createPlayer({
      playerId: 'guest',
      sessionId: 'guest-session',
      playerName: 'Guest',
    })

    const roomCode = await service.createRoom(host, { battleMode: 'server' })
    await service.joinRoom({ roomCode }, guest, 'player')

    await expect(
      service.relayPeerSignal(roomCode, 'host', 'host-session', {
        targetPlayerId: 'guest',
        signal: {
          transport: 'webtransport',
          kind: 'custom',
          payload: { path: '/connect' },
        },
      }),
    ).rejects.toMatchObject({
      code: 'INVALID_STATE',
    })
  })

  it('rejects peer signals when target session is not in the room', async () => {
    const { stateManager, lockManager, sessionStateManager } = createDependencies()
    const service = new PrivateRoomService(stateManager as any, lockManager as any, sessionStateManager as any)

    const host = createPlayer({
      playerId: 'host',
      sessionId: 'host-session',
      playerName: 'Host',
    })
    const guest = createPlayer({
      playerId: 'guest',
      sessionId: 'guest-session',
      playerName: 'Guest',
    })

    const roomCode = await service.createRoom(host, { battleMode: 'p2p' })
    await service.joinRoom({ roomCode }, guest, 'player')

    await expect(
      service.relayPeerSignal(roomCode, 'host', 'host-session', {
        targetPlayerId: 'guest',
        targetSessionId: 'missing-session',
        signal: {
          transport: 'webrtc',
          kind: 'ice-candidate',
          payload: { candidate: 'cand-1' },
        },
      }),
    ).rejects.toMatchObject({
      code: 'SIGNAL_TARGET_NOT_FOUND',
    })
  })

  it('supports a full p2p battle start plus server-mediated handshake relay flow', async () => {
    const { redis, stateManager, lockManager, sessionStateManager } = createDependencies()
    const service = new PrivateRoomService(stateManager as any, lockManager as any, sessionStateManager as any)
    service.setBattleCallbacks({
      createClusterBattleRoom: vi.fn(async () => 'battle-room-unused'),
      joinSpectateBattle: vi.fn(async () => true),
      leaveSpectateBattle: vi.fn(async () => undefined),
    })

    const host = createPlayer({
      playerId: 'host',
      sessionId: 'host-session',
      playerName: 'Host',
      team: [{ id: 'pet-a' } as any],
    })
    const guest = createPlayer({
      playerId: 'guest',
      sessionId: 'guest-session',
      playerName: 'Guest',
      isReady: true,
      team: [{ id: 'pet-b' } as any],
    })

    const roomCode = await service.createRoom(host, { battleMode: 'p2p' })
    await service.joinRoom({ roomCode }, guest, 'player')

    const startInfo = await service.startBattle(roomCode, 'host', [{ id: 'pet-a' } as any])
    expect(startInfo).toEqual({
      battleMode: 'p2p',
      battleHost: {
        playerId: 'host',
        sessionId: 'host-session',
      },
    })

    await service.relayPeerSignal(roomCode, 'host', 'host-session', {
      targetPlayerId: 'guest',
      targetSessionId: 'guest-session',
      signal: {
        transport: 'webrtc',
        kind: 'ready',
        payload: { role: 'host', remotePeerId: 'guest' },
      },
    })

    await service.relayPeerSignal(roomCode, 'host', 'host-session', {
      targetPlayerId: 'guest',
      targetSessionId: 'guest-session',
      signal: {
        transport: 'webrtc',
        kind: 'offer',
        payload: { sdp: 'offer-sdp' },
      },
    })

    await service.relayPeerSignal(roomCode, 'guest', 'guest-session', {
      targetPlayerId: 'host',
      targetSessionId: 'host-session',
      signal: {
        transport: 'webrtc',
        kind: 'answer',
        payload: { sdp: 'answer-sdp' },
      },
    })

    await service.relayPeerSignal(roomCode, 'guest', 'guest-session', {
      targetPlayerId: 'host',
      targetSessionId: 'host-session',
      signal: {
        transport: 'webrtc',
        kind: 'ice-candidate',
        payload: { candidate: 'cand-1' },
      },
    })

    const forwarded = redis.published
      .filter(entry => entry.channel === REDIS_KEYS.PRIVATE_ROOM_SIGNAL_EVENTS(roomCode))
      .map(entry => JSON.parse(entry.message))

    expect(forwarded).toHaveLength(4)
    expect(forwarded.map(event => event.signal.kind)).toEqual(['ready', 'offer', 'answer', 'ice-candidate'])
    expect(forwarded[0]).toMatchObject({
      from: { playerId: 'host', sessionId: 'host-session' },
      to: { playerId: 'guest', sessionId: 'guest-session' },
    })
    expect(forwarded[2]).toMatchObject({
      from: { playerId: 'guest', sessionId: 'guest-session' },
      to: { playerId: 'host', sessionId: 'host-session' },
    })
  })
})
