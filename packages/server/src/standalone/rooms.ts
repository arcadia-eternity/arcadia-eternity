import { timingSafeEqual } from 'node:crypto'
import { nanoid } from 'nanoid'
import type { Server, Socket } from 'socket.io'
import {
  BattleMessageType,
  type Events,
  type PlayerSelection,
  type playerId,
  type TimerConfig,
} from '@arcadia-eternity/const'
import type { LocalBattleSystemV4 } from '@arcadia-eternity/battle/v4/host'
import { PlayerSelectionSchema, parseWithErrors } from '@arcadia-eternity/schema'
import type { PrivateRoomInfo, PrivateRoomEvent, ServerSession } from '@arcadia-eternity/protocol'
import { createStandaloneBattle, getStandaloneRuntimeIdentity, validateStandaloneTeam } from './native'
import type { SessionRegistry } from './session'

export class RoomError extends Error {
  constructor(public readonly code: string) {
    super(code)
  }
}
function fail(code: string): never {
  throw new RoomError(code)
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('INVALID_REQUEST')
  return value as Record<string, unknown>
}
function text(value: unknown, max = 128): string {
  if (typeof value !== 'string' || !value.length || value.length > max) return fail('INVALID_REQUEST')
  return value
}
const timerEvents: (keyof Events)[] = [
  'timerStart',
  'timerUpdate',
  'timerPause',
  'timerResume',
  'timerTimeout',
  'timerSnapshot',
  'timerStateChange',
  'animationStart',
  'animationEnd',
]
type Member = PrivateRoomInfo['players'][number] & { connectionStatus: 'online' | 'offline' }
type Room = {
  info: PrivateRoomInfo
  password?: string
  members: Map<string, Member>
  battle?: LocalBattleSystemV4
  ready: Set<string>
  cleanups: (() => void)[]
  viewCleanups: Map<string, () => void>
  animations: Map<string, string>
  commands: Map<string, string>
  pending: Promise<unknown>
  ending?: ReturnType<typeof setTimeout>
  disconnected: Map<string, number>
}
export interface RoomOptions {
  maxRooms?: number
  maxSpectators?: number
  roomTtlMs?: number
  maxRoomLifetimeMs?: number
  reconnectGraceMs?: number
  cleanupIntervalMs?: number
}

/** One process owns all rooms. No room or live authorization survives shutdown. */
export class RoomRegistry {
  private readonly rooms = new Map<string, Room>()
  private readonly seats = new Map<string, string>()
  private readonly sockets = new Map<string, Set<Socket>>()
  private readonly cleaner: ReturnType<typeof setInterval>
  private closed = false
  private readonly limits: Required<RoomOptions>
  constructor(
    private readonly io: Server,
    private readonly sessions: SessionRegistry,
    options: RoomOptions = {},
  ) {
    this.limits = {
      maxRooms: options.maxRooms ?? 1000,
      maxSpectators: options.maxSpectators ?? 20,
      roomTtlMs: options.roomTtlMs ?? 30 * 60_000,
      maxRoomLifetimeMs: options.maxRoomLifetimeMs ?? 12 * 60 * 60_000,
      reconnectGraceMs: options.reconnectGraceMs ?? 60_000,
      cleanupIntervalMs: options.cleanupIntervalMs ?? 10_000,
    }
    for (const value of Object.values(this.limits))
      if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid room limits')
    this.cleaner = setInterval(() => {
      void this.sweep().catch(() => undefined)
    }, this.limits.cleanupIntervalMs)
    this.cleaner.unref()
  }
  get size() {
    return this.rooms.size
  }
  get onlinePlayers() {
    return this.sockets.size
  }
  get playersInRooms() {
    return this.seats.size
  }
  private assertOpen() {
    if (this.closed) fail('SERVER_STOPPED')
  }
  private current(session: ServerSession): Room {
    const room = this.rooms.get(this.seats.get(session.seatId) ?? '')
    if (!room || !room.members.has(session.seatId)) return fail('ROOM_NOT_FOUND')
    return room
  }
  private host(room: Room, session: ServerSession) {
    if (room.info.config.hostPlayerId !== session.seatId) fail('NOT_HOST')
  }
  private waiting(room: Room) {
    if (room.info.status === 'started') fail('INVALID_STATE')
  }
  private player(room: Room, session: ServerSession) {
    if (!room.info.players.some(p => p.playerId === session.seatId)) fail('NOT_BATTLE_PLAYER')
  }
  private enqueue<T>(room: Room, operation: () => Promise<T> | T): Promise<T> {
    const pending = room.pending
      .catch(() => undefined)
      .then(() => {
        this.assertOpen()
        if (this.rooms.get(room.info.config.roomCode) !== room) fail('ROOM_NOT_FOUND')
        return operation()
      })
    room.pending = pending
    return pending
  }
  private emitSeat(seat: string, event: string, data: unknown) {
    for (const socket of this.sockets.get(seat) ?? []) socket.emit(event, data)
  }
  private emit(room: Room, event: PrivateRoomEvent) {
    for (const seat of room.members.keys()) this.emitSeat(seat, 'privateRoomEvent', event)
  }
  /** Only the P2P authority receives both teams, because it constructs the battle. */
  private view(room: Room, viewer: string): PrivateRoomInfo {
    const info = structuredClone(room.info)
    const canHostPeerBattle = info.config.battleMode === 'p2p' && info.config.hostPlayerId === viewer
    info.players = info.players.map(player => ({
      ...player,
      team: player.playerId === viewer || canHostPeerBattle ? player.team : undefined,
      connectionStatus: room.members.get(player.playerId)?.connectionStatus,
    }))
    return info
  }
  private update(room: Room, activity = true) {
    if (activity) room.info.lastActivity = Date.now()
    if (room.info.status !== 'started')
      room.info.status = room.info.players.length === 2 && room.info.players.every(p => p.isReady) ? 'ready' : 'waiting'
    for (const seat of room.members.keys())
      this.emitSeat(seat, 'privateRoomEvent', { type: 'roomUpdate', data: this.view(room, seat) })
  }
  private member(session: ServerSession): Member {
    return {
      playerId: session.seatId,
      sessionId: session.sessionId,
      playerName: session.profile.name,
      isReady: false,
      joinedAt: Date.now(),
      connectionStatus: 'online',
    }
  }
  private checkPassword(room: Room, password: unknown) {
    if (!room.password) return
    const a = Buffer.from(room.password),
      b = Buffer.from(typeof password === 'string' ? password : '')
    if (a.length !== b.length || !timingSafeEqual(a, b)) fail('INVALID_PASSWORD')
  }
  private async checkRuntime(input: Record<string, unknown>) {
    if (input.clientPackLock !== undefined || input.clientAssetLock !== undefined) fail('CUSTOM_CONTENT_UNSUPPORTED')
    if (input.expectedRuntime === undefined) return
    const expected = object(input.expectedRuntime)
    const actual = await getStandaloneRuntimeIdentity()
    if (
      expected.kind !== actual.kind ||
      expected.contentRevision !== actual.contentRevision ||
      expected.coreBuildId !== actual.coreBuildId ||
      expected.registryBuildId !== actual.registryBuildId
    )
      fail('RUNTIME_MISMATCH')
  }
  private config(raw: unknown, previous?: PrivateRoomInfo['config']) {
    const input = object(raw)
    if (input.requiredPackLock !== undefined || input.requiredAssetLock !== undefined)
      fail('CUSTOM_CONTENT_UNSUPPORTED')
    const battleMode = input.battleMode ?? previous?.battleMode ?? 'server'
    const p2pTransport = input.p2pTransport ?? previous?.p2pTransport ?? 'auto'
    if (battleMode !== 'server' && battleMode !== 'p2p') fail('INVALID_CONFIG')
    if (!['auto', 'webrtc', 'relay'].includes(p2pTransport as string)) fail('INVALID_CONFIG')
    const isPrivate = input.isPrivate ?? previous?.isPrivate ?? false
    if (typeof isPrivate !== 'boolean') fail('INVALID_CONFIG')
    for (const key of ['allowFaintSwitch', 'showHidden'])
      if (input[key] !== undefined && typeof input[key] !== 'boolean') fail('INVALID_CONFIG')
    const timerConfig = {
      enabled: true,
      turnTimeLimit: 30,
      totalTimeLimit: 1500,
      animationPauseEnabled: true,
      maxAnimationDuration: 20_000,
      ...previous?.timerConfig,
    } as TimerConfig
    if (input.timerConfig !== undefined) {
      const timer = object(input.timerConfig)
      for (const [key, value] of Object.entries(timer)) {
        if (key === 'enabled' || key === 'animationPauseEnabled') {
          if (typeof value !== 'boolean') fail('INVALID_CONFIG')
        } else if (['turnTimeLimit', 'totalTimeLimit', 'maxAnimationDuration'].includes(key)) {
          if (
            typeof value !== 'number' ||
            !Number.isFinite(value) ||
            value <= 0 ||
            value > (key === 'maxAnimationDuration' ? 20_000 : 86_400)
          )
            fail('INVALID_CONFIG')
        } else fail('INVALID_CONFIG')
      }
      Object.assign(timerConfig, timer)
    }
    return {
      roomCode: previous?.roomCode ?? '',
      hostPlayerId: previous?.hostPlayerId ?? '',
      ruleSetId: '',
      maxPlayers: 2,
      isPrivate,
      battleMode: battleMode as 'server' | 'p2p',
      p2pTransport: p2pTransport as 'auto' | 'webrtc' | 'relay',
      timerConfig,
      allowFaintSwitch: (input.allowFaintSwitch as boolean | undefined) ?? previous?.allowFaintSwitch ?? true,
      showHidden: (input.showHidden as boolean | undefined) ?? previous?.showHidden ?? false,
    }
  }
  private async create(session: ServerSession, data: unknown) {
    const input = object(data)
    await this.checkRuntime(input)
    if (!this.sessions.authenticate(session.token)) fail('INVALID_SESSION')
    if (this.seats.has(session.seatId)) fail('ALREADY_IN_ROOM')
    if (this.rooms.size >= this.limits.maxRooms) fail('ROOM_CAPACITY')
    const config = this.config(input.config)
    let code: string
    do {
      code = nanoid(6).toUpperCase()
    } while (this.rooms.has(code))
    config.roomCode = code
    config.hostPlayerId = session.seatId
    const password = config.isPrivate ? text(object(input.config).password) : undefined
    const member = this.member(session)
    const room: Room = {
      info: {
        id: nanoid(),
        config,
        players: [member],
        spectators: [],
        status: 'waiting',
        createdAt: Date.now(),
        lastActivity: Date.now(),
      },
      password,
      members: new Map([[session.seatId, member]]),
      ready: new Set(),
      cleanups: [],
      viewCleanups: new Map(),
      animations: new Map(),
      commands: new Map(),
      pending: Promise.resolve(),
      disconnected: new Map(),
    }
    this.rooms.set(code, room)
    this.seats.set(session.seatId, code)
    this.update(room)
    return { roomCode: code }
  }
  private async join(session: ServerSession, data: unknown, spectator: boolean) {
    const input = object(data)
    await this.checkRuntime(input)
    const room = this.rooms.get(text(input.roomCode, 6).toUpperCase())
    if (!room) return fail('ROOM_NOT_FOUND')
    return this.enqueue(room, () => {
      if (!this.sessions.authenticate(session.token)) fail('INVALID_SESSION')
      if (this.seats.has(session.seatId)) fail('ALREADY_IN_ROOM')
      this.checkPassword(room, input.password)
      if (spectator) {
        if (room.info.spectators.length >= this.limits.maxSpectators) fail('SPECTATOR_LIMIT_REACHED')
      } else {
        this.waiting(room)
        if (room.info.players.length >= 2) fail('ROOM_FULL')
      }
      const member = this.member(session)
      room.members.set(session.seatId, member)
      this.seats.set(session.seatId, room.info.config.roomCode)
      if (spectator) room.info.spectators.push(member)
      else room.info.players.push(member)
      this.update(room)
      if (room.battle) this.attachBattleView(room, session.seatId)
      return { status: 'JOINED' }
    })
  }
  private async disposeBattle(room: Room) {
    if (room.ending) clearTimeout(room.ending)
    room.ending = undefined
    for (const cleanup of room.cleanups.splice(0)) cleanup()
    for (const cleanup of room.viewCleanups.values()) cleanup()
    room.viewCleanups.clear()
    const battle = room.battle
    room.battle = undefined
    room.animations.clear()
    room.commands.clear()
    room.ready.clear()
    if (battle) await battle.cleanup()
  }
  private async close(room: Room, reason: string) {
    if (this.rooms.get(room.info.config.roomCode) !== room) return
    this.rooms.delete(room.info.config.roomCode)
    this.emit(room, { type: 'roomClosed', data: { reason } })
    if (room.info.battleRoomId)
      for (const seat of room.members.keys()) this.emitSeat(seat, 'roomClosed', { roomId: room.info.battleRoomId })
    for (const seat of room.members.keys()) this.seats.delete(seat)
    room.members.clear()
    await this.disposeBattle(room)
  }
  private async remove(room: Room, seat: string) {
    const isPlayer = room.info.players.some(p => p.playerId === seat)
    if (isPlayer && room.info.status === 'started') {
      await this.close(room, 'PLAYER_LEFT')
      return
    }
    room.viewCleanups.get(seat)?.()
    room.viewCleanups.delete(seat)
    room.members.delete(seat)
    room.disconnected.delete(seat)
    this.seats.delete(seat)
    room.info.players = room.info.players.filter(p => p.playerId !== seat)
    room.info.spectators = room.info.spectators.filter(p => p.playerId !== seat)
    if (!room.info.players.length) {
      await this.close(room, 'NO_PLAYERS')
      return
    }
    if (room.info.config.hostPlayerId === seat) room.info.config.hostPlayerId = room.info.players[0].playerId
    this.update(room)
  }
  private attachBattleView(room: Room, seat: string) {
    if (!room.battle) return
    room.viewCleanups.get(seat)?.()
    const isPlayer = room.info.players.some(p => p.playerId === seat)
    room.viewCleanups.set(
      seat,
      room.battle.BattleEvent(
        message => {
          if (room.members.has(seat)) this.emitSeat(seat, 'battleEvent', message)
        },
        {
          viewerId: isPlayer ? (seat as playerId) : undefined,
          showHidden: room.info.config.showHidden ?? false,
          showAll: false,
        },
      ),
    )
  }
  private finish(room: Room, winner: string | null, reason: string) {
    if (room.info.status !== 'started') return
    room.info.lastBattleResult = { winner, reason, endedAt: Date.now(), battleRoomId: room.info.battleRoomId! }
    room.info.status = 'ended'
    for (const player of room.info.players) player.isReady = false
    this.emit(room, { type: 'battleFinished', data: { battleResult: room.info.lastBattleResult } })
    this.update(room)
    const battle = room.battle
    room.ending = setTimeout(() => {
      if (room.battle !== battle) return
      void this.enqueue(room, async () => {
        if (room.battle !== battle) return
        if (room.info.battleRoomId)
          for (const seat of room.members.keys()) this.emitSeat(seat, 'roomClosed', { roomId: room.info.battleRoomId })
        await this.disposeBattle(room)
        delete room.info.battleRoomId
        delete room.info.battleHost
        this.update(room)
      }).catch(() => undefined)
    }, 5000)
    room.ending.unref()
  }
  private async start(room: Room, session: ServerSession, input: unknown) {
    this.host(room, session)
    this.waiting(room)
    if (room.info.players.length !== 2) fail('PLAYERS_NOT_READY')
    if (room.info.players.some(p => !this.sockets.get(p.playerId)?.size)) fail('PLAYER_OFFLINE')
    const requested = object(input).hostTeam
    if (requested !== undefined)
      room.info.players.find(p => p.playerId === session.seatId)!.team = await validateStandaloneTeam(requested)
    if (room.info.players.some(p => !p.team || (p.playerId !== session.seatId && !p.isReady))) fail('PLAYERS_NOT_READY')
    await this.disposeBattle(room)
    const [a, b] = room.info.players
    if (room.info.config.battleMode === 'server') {
      room.battle = await createStandaloneBattle(
        { id: a.playerId, name: a.playerName, team: a.team! },
        { id: b.playerId, name: b.playerName, team: b.team! },
        {
          allowFaintSwitch: room.info.config.allowFaintSwitch,
          showHidden: room.info.config.showHidden,
          timerConfig: room.info.config.timerConfig,
          rngSeed: nanoid(),
        },
      )
    }
    // A shutdown can happen while official content is loading.
    if (this.closed || this.rooms.get(room.info.config.roomCode) !== room) {
      await this.disposeBattle(room)
      return fail('SERVER_STOPPED')
    }
    room.info.status = 'started'
    room.info.battleRoomId = nanoid()
    room.info.battleHost = { playerId: session.seatId, sessionId: session.sessionId }
    if (room.battle) {
      for (const seat of room.members.keys()) this.attachBattleView(room, seat)
      room.cleanups.push(
        room.battle.BattleEvent(message => {
          if (message.type === BattleMessageType.BattleEnd) this.finish(room, message.data.winner, message.data.reason)
        }),
      )
      for (const type of timerEvents)
        room.cleanups.push(
          room.battle.onTimerEvent(type, data => {
            if (type === 'animationEnd' && data && 'animationId' in data)
              room.animations.delete(data.animationId as string)
            for (const seat of room.members.keys())
              this.emitSeat(
                seat,
                type === 'timerSnapshot' ? type : 'timerEvent',
                type === 'timerSnapshot' ? data : { type, data },
              )
          }),
        )
    }
    this.update(room)
    const result = {
      battleMode: room.info.config.battleMode,
      battleRoomId: room.info.battleRoomId,
      battleHost: room.info.battleHost,
    }
    this.emit(room, { type: 'battleStarted', data: result })
    return result
  }
  private battle(room: Room) {
    if (!room.battle) return fail('BATTLE_NOT_FOUND')
    return room.battle
  }
  private async state(room: Room, seat: string) {
    const player = room.info.players.some(p => p.playerId === seat)
    return this.battle(room).getState(player ? (seat as playerId) : undefined, room.info.config.showHidden ?? false)
  }
  async connect(socket: Socket, session: ServerSession) {
    const connections = this.sockets.get(session.seatId) ?? new Set<Socket>()
    if (connections.size >= 8) {
      socket.disconnect(true)
      return
    }
    connections.add(socket)
    this.sockets.set(session.seatId, connections)
    socket.on('disconnect', () => {
      void this.disconnect(socket, session).catch(() => undefined)
    })
    let count = 0,
      window = Date.now()
    const register = (event: string, operation: (data: unknown) => unknown | Promise<unknown>, noPayload = false) => {
      socket.on(event, (...args: unknown[]) => {
        const ack = args.at(-1)
        const reply = (value: unknown) => {
          if (typeof ack === 'function') ack(value)
        }
        void (async () => {
          this.assertOpen()
          if (!this.sessions.authenticate(session.token)) {
            socket.disconnect(true)
            fail('SESSION_EXPIRED')
          }
          if (Date.now() - window > 1000) {
            count = 0
            window = Date.now()
          }
          if (++count > 120) fail('RATE_LIMITED')
          const data = await operation(noPayload ? undefined : args[0])
          reply({ status: 'SUCCESS', data })
        })().catch(error =>
          reply({ status: 'ERROR', code: error instanceof RoomError ? error.code : 'INVALID_REQUEST' }),
        )
      })
    }
    const withRoom = (operation: (room: Room, data: unknown) => unknown | Promise<unknown>) => (data: unknown) => {
      const current = this.current(session)
      return this.enqueue(current, () => {
        if (!current.members.has(session.seatId) || !this.sessions.authenticate(session.token)) fail('INVALID_SESSION')
        return operation(current, data)
      })
    }
    register(
      'getServerState',
      () => ({
        onlinePlayers: this.onlinePlayers,
        matchmakingQueue: 0,
        rooms: this.size,
        playersInRooms: this.playersInRooms,
      }),
      true,
    )
    register('joinMatchmaking', () => fail('MATCHMAKING_UNAVAILABLE'))
    register('cancelMatchmaking', () => ({ status: 'CANCELED' }), true)
    register('createPrivateRoom', data => this.create(session, data))
    register('joinPrivateRoom', data => this.join(session, data, false))
    register('joinPrivateRoomAsSpectator', data => this.join(session, data, true))
    register(
      'getCurrentPrivateRoom',
      () => {
        const current = this.rooms.get(this.seats.get(session.seatId) ?? '')
        return current ? this.view(current, session.seatId) : null
      },
      true,
    )
    register('getPrivateRoomInfo', data => {
      const current = this.current(session)
      if (text(object(data).roomCode, 6).toUpperCase() !== current.info.config.roomCode) fail('ROOM_NOT_FOUND')
      return this.view(current, session.seatId)
    })
    register(
      'leavePrivateRoom',
      withRoom(async room => {
        await this.remove(room, session.seatId)
        return { status: 'LEFT' }
      }),
      true,
    )
    register(
      'togglePrivateRoomReady',
      withRoom(async (room, data) => {
        this.waiting(room)
        this.player(room, session)
        const player = room.info.players.find(p => p.playerId === session.seatId)!
        if (player.isReady) player.isReady = false
        else {
          player.team = await validateStandaloneTeam(object(data).team)
          player.isReady = true
        }
        this.update(room)
        return { status: 'READY_TOGGLED' }
      }),
    )
    register(
      'startPrivateRoomBattle',
      withRoom((room, data) => this.start(room, session, data)),
    )
    register('updatePrivateRoomRuleSet', () => fail('RULESETS_UNSUPPORTED'))
    register(
      'updatePrivateRoomConfig',
      withRoom((room, data) => {
        this.host(room, session)
        this.waiting(room)
        const input = object(data),
          config = this.config(input, room.info.config)
        const password = config.isPrivate
          ? input.password === undefined
            ? room.password
            : text(input.password)
          : undefined
        if (config.isPrivate && !password) fail('INVALID_CONFIG')
        room.info.config = config
        room.password = password
        for (const player of room.info.players) player.isReady = false
        this.update(room)
        return { status: 'UPDATED' }
      }),
    )
    register(
      'transferPrivateRoomHost',
      withRoom((room, data) => {
        this.host(room, session)
        this.waiting(room)
        const target = text(object(data).targetPlayerId)
        if (target === session.seatId) fail('CANNOT_TRANSFER_TO_SELF')
        if (!room.info.players.some(p => p.playerId === target)) fail('TARGET_NOT_PLAYER')
        room.info.config.hostPlayerId = target
        this.emit(room, {
          type: 'hostTransferred',
          data: { oldHostId: session.seatId, newHostId: target, transferredBy: session.seatId },
        })
        this.update(room)
        return { status: 'TRANSFERRED' }
      }),
    )
    register(
      'kickPlayerFromPrivateRoom',
      withRoom(async (room, data) => {
        this.host(room, session)
        this.waiting(room)
        const target = text(object(data).targetPlayerId)
        if (target === session.seatId) fail('CANNOT_KICK_SELF')
        if (!room.members.has(target)) fail('PLAYER_NOT_FOUND')
        this.emit(room, { type: 'playerKicked', data: { playerId: target, kickedBy: session.seatId } })
        await this.remove(room, target)
        return { status: 'KICKED' }
      }),
    )
    register(
      'switchToSpectator',
      withRoom(room => {
        this.waiting(room)
        this.player(room, session)
        if (room.info.config.hostPlayerId === session.seatId) fail('HOST_CANNOT_SPECTATE')
        if (room.info.spectators.length >= this.limits.maxSpectators) fail('SPECTATOR_LIMIT_REACHED')
        const member = room.members.get(session.seatId)!
        member.isReady = false
        delete member.team
        room.info.players = room.info.players.filter(p => p.playerId !== session.seatId)
        room.info.spectators.push(member)
        this.update(room)
        return { status: 'SWITCHED' }
      }),
    )
    register(
      'switchToPlayer',
      withRoom(async (room, data) => {
        this.waiting(room)
        if (!room.info.spectators.some(p => p.playerId === session.seatId)) fail('SPECTATOR_NOT_FOUND')
        if (room.info.players.length >= 2) fail('ROOM_FULL')
        const member = room.members.get(session.seatId)!
        member.team = await validateStandaloneTeam(object(data).team)
        room.info.spectators = room.info.spectators.filter(p => p.playerId !== session.seatId)
        room.info.players.push(member)
        this.update(room)
        return { status: 'SWITCHED' }
      }),
    )
    register(
      'joinSpectateBattle',
      withRoom((room, data) => {
        if (room.info.config.battleMode === 'p2p') fail('P2P_SPECTATE_UNSUPPORTED')
        if (room.info.battleRoomId !== object(data).battleRoomId || room.info.status !== 'started')
          fail('BATTLE_NOT_FOUND')
        if (!room.info.spectators.some(p => p.playerId === session.seatId)) fail('NOT_SPECTATOR')
        return { status: 'SPECTATING' }
      }),
    )
    register('leaveSpectateBattle', () => ({ status: 'LEFT_SPECTATE' }))
    register(
      'ready',
      withRoom(async room => {
        this.player(room, session)
        const battle = this.battle(room)
        room.ready.add(session.seatId)
        if (room.info.players.every(p => room.ready.has(p.playerId))) await battle.ready()
        return { status: 'READY' }
      }),
      true,
    )
    register(
      'getState',
      withRoom(room => this.state(room, session.seatId)),
      true,
    )
    register(
      'getAvailableSelection',
      withRoom(async room => {
        this.player(room, session)
        return this.battle(room).getAvailableSelection(session.seatId as playerId)
      }),
      true,
    )
    register(
      'submitPlayerSelection',
      withRoom(async (room, data) => {
        this.player(room, session)
        if (room.info.status !== 'started') fail('INVALID_STATE')
        const raw = object(data)
        const { requestId, expectedTurn, ...body } = raw
        const selection = parseWithErrors(PlayerSelectionSchema, body)
        if (selection.player !== session.seatId) fail('FORBIDDEN_PLAYER')
        const command = `${session.seatId}:${text(requestId)}`
        const fingerprint = JSON.stringify({ body, expectedTurn })
        if (room.commands.has(command)) {
          if (room.commands.get(command) !== fingerprint) fail('DUPLICATE_ACTION')
          return { status: 'ACTION_ACCEPTED' }
        }
        const battle = this.battle(room)
        if (!room.info.players.every(p => room.ready.has(p.playerId))) fail('PLAYERS_NOT_READY')
        await battle.waitForPendingDecision()
        if (!this.sessions.authenticate(session.token) || !room.members.has(session.seatId)) fail('INVALID_SESSION')
        const state = await battle.getState(session.seatId as playerId)
        if (typeof expectedTurn !== 'number' || expectedTurn !== state.currentTurn) fail('STALE_ACTION')
        if (!room.info.players.every(p => room.ready.has(p.playerId))) fail('PLAYERS_NOT_READY')
        await battle.submitAction(selection as PlayerSelection)
        room.commands.set(command, fingerprint)
        if (room.commands.size > 4096) room.commands.delete(room.commands.keys().next().value!)
        room.info.lastActivity = Date.now()
        return { status: 'ACTION_ACCEPTED' }
      }),
    )
    register(
      'isTimerEnabled',
      withRoom(room => this.battle(room).isTimerEnabled()),
      true,
    )
    register(
      'getTimerConfig',
      withRoom(room => this.battle(room).getTimerConfig()),
      true,
    )
    register(
      'getAllPlayerTimerStates',
      withRoom(room => this.battle(room).getAllPlayerTimerStates()),
      true,
    )
    register(
      'getPlayerTimerState',
      withRoom((room, data) => {
        const target = text(object(data).playerId)
        if (!room.info.players.some(p => p.playerId === target)) fail('PLAYER_NOT_FOUND')
        return this.battle(room).getPlayerTimerState(target as playerId)
      }),
    )
    register(
      'startAnimation',
      withRoom(async (room, data) => {
        this.player(room, session)
        const input = object(data)
        if (input.ownerId !== session.seatId) fail('FORBIDDEN_PLAYER')
        const duration = input.expectedDuration
        if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0 || duration > 20_000)
          fail('INVALID_REQUEST')
        if (room.animations.size >= 100) fail('ANIMATION_CAPACITY')
        const id = await this.battle(room).startAnimation(text(input.source), duration, session.seatId as playerId)
        room.animations.set(id, session.seatId)
        return id
      }),
    )
    const endAnimation = withRoom(async (room, data) => {
      const input = object(data),
        id = text(input.animationId)
      if (room.animations.get(id) !== session.seatId) fail('FORBIDDEN_ANIMATION')
      const duration = input.actualDuration
      if (
        duration !== undefined &&
        (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0 || duration > 120_000)
      )
        fail('INVALID_REQUEST')
      await this.battle(room).endAnimation(id, duration as number | undefined)
      room.animations.delete(id)
    })
    register('endAnimation', endAnimation)
    register('reportAnimationEnd', endAnimation)
    register(
      'sendPrivateRoomPeerSignal',
      withRoom((room, data) => {
        this.player(room, session)
        if (room.info.config.battleMode !== 'p2p' || room.info.status !== 'started') fail('INVALID_STATE')
        const input = object(data),
          target = room.info.players.find(p => p.playerId === input.targetPlayerId)
        if (
          !target ||
          target.playerId === session.seatId ||
          (input.targetSessionId !== undefined && input.targetSessionId !== target.sessionId)
        )
          fail('SIGNAL_TARGET_NOT_FOUND')
        const signal = object(input.signal)
        if (
          typeof signal.transport !== 'string' ||
          !['webrtc', 'relay'].includes(signal.transport) ||
          typeof signal.kind !== 'string' ||
          !['offer', 'answer', 'ice-candidate', 'ready', 'custom'].includes(signal.kind)
        )
          fail('INVALID_SIGNAL')
        if (Buffer.byteLength(JSON.stringify(signal)) > 64 * 1024) fail('INVALID_SIGNAL')
        const event = {
          roomCode: room.info.config.roomCode,
          from: { playerId: session.seatId, sessionId: session.sessionId },
          to: { playerId: target.playerId, sessionId: target.sessionId },
          signal,
          timestamp: Date.now(),
        }
        this.emitSeat(target.playerId, 'privateRoomPeerSignal', event)
        return { status: 'FORWARDED' }
      }),
    )
    register(
      'finishPrivateRoomBattle',
      withRoom((room, data) => {
        this.host(room, session)
        if (room.info.config.battleMode !== 'p2p' || room.info.status !== 'started') fail('INVALID_STATE')
        const input = object(data)
        if (input.winner !== null && !room.info.players.some(p => p.playerId === input.winner)) fail('INVALID_REQUEST')
        this.finish(room, input.winner as string | null, text(input.reason))
        return { status: 'FINISHED' }
      }),
    )
    const room = this.rooms.get(this.seats.get(session.seatId) ?? '')
    if (room)
      await this.enqueue(room, async () => {
        room.disconnected.delete(session.seatId)
        room.members.get(session.seatId)!.connectionStatus = 'online'
        this.update(room, false)
        if (room.battle && room.info.players.some(p => p.playerId === session.seatId)) {
          await room.battle.cancelReconnectGraceTimer(session.seatId as playerId)
          for (const seat of room.members.keys())
            if (seat !== session.seatId)
              this.emitSeat(seat, 'opponentReconnected', { reconnectedPlayerId: session.seatId })
        }
        if (room.battle && room.info.status === 'started')
          socket.emit('battleReconnect', {
            roomId: room.info.battleRoomId,
            shouldRedirect: true,
            battleState: 'active',
            fullBattleState: await this.state(room, session.seatId),
          })
      })
  }
  private async disconnect(socket: Socket, session: ServerSession) {
    const connections = this.sockets.get(session.seatId)
    connections?.delete(socket)
    if (connections?.size) return
    this.sockets.delete(session.seatId)
    const room = this.rooms.get(this.seats.get(session.seatId) ?? '')
    if (!room || this.closed) return
    await this.enqueue(room, async () => {
      if (this.sockets.has(session.seatId) || !room.members.has(session.seatId)) return
      room.disconnected.set(session.seatId, Date.now())
      room.members.get(session.seatId)!.connectionStatus = 'offline'
      if (room.info.status === 'started' && room.info.players.some(p => p.playerId === session.seatId)) {
        if (room.battle)
          await room.battle.startReconnectGraceTimer(session.seatId as playerId, this.limits.reconnectGraceMs / 1000)
        for (const seat of room.members.keys())
          if (seat !== session.seatId)
            this.emitSeat(seat, 'opponentDisconnected', {
              disconnectedPlayerId: session.seatId,
              graceTimeRemaining: this.limits.reconnectGraceMs / 1000,
            })
      }
      this.update(room, false)
    })
  }
  async revoke(session: ServerSession) {
    const room = this.rooms.get(this.seats.get(session.seatId) ?? '')
    if (room) await this.enqueue(room, () => this.remove(room, session.seatId))
    for (const socket of this.sockets.get(session.seatId) ?? []) socket.disconnect(true)
    this.sockets.delete(session.seatId)
  }
  private async sweep() {
    for (const [seat, connections] of this.sockets) {
      const socket = connections.values().next().value
      if (socket && !this.sessions.authenticate(socket.handshake.auth.token))
        for (const connection of connections) connection.disconnect(true)
      if (!connections.size) this.sockets.delete(seat)
    }
    const now = Date.now()
    await Promise.all(
      [...this.rooms.values()].map(room =>
        this.enqueue(room, async () => {
          if (
            now - room.info.lastActivity >= this.limits.roomTtlMs ||
            now - room.info.createdAt >= this.limits.maxRoomLifetimeMs
          ) {
            await this.close(room, 'ROOM_EXPIRED')
            return
          }
          for (const [seat, disconnectedAt] of room.disconnected) {
            if (now - disconnectedAt < this.limits.reconnectGraceMs) continue
            if (room.info.status === 'started') {
              if (room.info.config.battleMode === 'p2p') await this.close(room, 'PEER_DISCONNECTED')
            } else await this.remove(room, seat)
          }
        }).catch(() => undefined),
      ),
    )
  }
  async stop() {
    if (this.closed) return
    this.closed = true
    clearInterval(this.cleaner)
    const rooms = [...this.rooms.values()]
    await Promise.all(rooms.map(room => this.close(room, 'SERVER_STOPPED')))
    await Promise.allSettled(rooms.map(room => room.pending))
    for (const connections of this.sockets.values()) for (const socket of connections) socket.disconnect(true)
    this.sockets.clear()
    this.seats.clear()
  }
}
