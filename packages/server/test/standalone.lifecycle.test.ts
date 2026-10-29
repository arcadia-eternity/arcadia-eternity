import { afterEach, expect, it } from 'vitest'
import { io, type Socket } from 'socket.io-client'
import type { PrivateRoomEvent, PrivateRoomInfo, ServerSession } from '@arcadia-eternity/protocol'
import { PlayerSchema, parseWithErrors } from '@arcadia-eternity/schema'
import { createSingleProcessApp, type SingleProcessAppOptions } from '../src/standalone/app'
import input from '../../battle/test/fixtures/official-switch.input.json'

const apps: ReturnType<typeof createSingleProcessApp>[] = []
const sockets: Socket[] = []
type Host = { app: ReturnType<typeof createSingleProcessApp>; url: string }
type Ack<T = unknown> = { status: 'SUCCESS'; data: T } | { status: 'ERROR'; code: string }

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect()
  await Promise.all(apps.splice(0).map(app => app.stop()))
})

async function boot(options: SingleProcessAppOptions = {}): Promise<Host> {
  const app = createSingleProcessApp({ port: 0, host: '127.0.0.1', corsOrigins: [], ...options })
  apps.push(app)
  await app.start()
  return { app, url: `http://127.0.0.1:${app.address!.port}` }
}

async function session(host: Host, id = 'shared-local-profile'): Promise<ServerSession> {
  const response = await fetch(`${host.url}/api/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: { id, name: `Player ${id}` } }),
  })
  expect(response.status).toBe(201)
  return (await response.json()) as ServerSession
}

function client(host: Host, auth: Record<string, unknown>): Socket {
  const socket = io(host.url, { auth, transports: ['websocket'], reconnection: false, autoConnect: false })
  sockets.push(socket)
  return socket
}

function event<T>(socket: Socket, name: string, accept: (value: T) => boolean = () => true, timeout = 3000) {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(name, listener)
      reject(new Error(`Timed out waiting for ${name}`))
    }, timeout)
    const listener = (value: T) => {
      if (!accept(value)) return
      clearTimeout(timer)
      socket.off(name, listener)
      resolve(value)
    }
    socket.on(name, listener)
  })
}

async function connect(host: Host, value: ServerSession): Promise<Socket> {
  const socket = client(host, { token: value.token })
  const connected = event(socket, 'connect')
  socket.connect()
  await connected
  return socket
}

async function rejectConnection(host: Host, auth: Record<string, unknown>) {
  const socket = client(host, auth)
  const rejected = event<Error & { data?: { code: string } }>(socket, 'connect_error')
  socket.connect()
  expect((await rejected).data?.code).toBe('INVALID_SESSION')
  expect(socket.connected).toBe(false)
}

function ack<T = unknown>(socket: Socket, name: string, data?: unknown): Promise<Ack<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out acknowledging ${name}`)), 3000)
    const callback = (value: Ack<T>) => {
      clearTimeout(timer)
      resolve(value)
    }
    if (data === undefined) socket.emit(name, callback)
    else socket.emit(name, data, callback)
  })
}

async function success<T = unknown>(socket: Socket, name: string, data?: unknown): Promise<T> {
  const response = await ack<T>(socket, name, data)
  expect(response.status, `${name}: ${JSON.stringify(response)}`).toBe('SUCCESS')
  if (response.status !== 'SUCCESS') throw new Error(response.code)
  return response.data
}

function current(socket: Socket) {
  return success<PrivateRoomInfo | null>(socket, 'getCurrentPrivateRoom')
}

function createRoom(socket: Socket, config: Record<string, unknown> = {}) {
  return success<{ roomCode: string }>(socket, 'createPrivateRoom', { config })
}

function team(index = 0) {
  const { maxHp: _maxHp, ...draft } = input.teams[1].team[0]
  return parseWithErrors(PlayerSchema, {
    ...input.teams[index],
    team: [{ ...draft, skills: ['skill_paida', 'skill_shuipao'] }],
  }).team
}

it('creates independent guests for the same local profile and authenticates only secret tokens', async () => {
  const host = await boot()
  const first = await session(host)
  const second = await session(host)
  expect(first.profile).toEqual(second.profile)
  expect(first.principal).not.toEqual(second.principal)
  for (const key of ['token', 'sessionId', 'seatId'] as const) expect(first[key]).not.toBe(second[key])
  const owner = await connect(host, first)
  const other = await connect(host, second)
  const room = await createRoom(owner)
  expect(await current(other)).toBeNull()
  expect(await ack(other, 'getPrivateRoomInfo', room)).toEqual({ status: 'ERROR', code: 'ROOM_NOT_FOUND' })
  const ownRoom = await current(owner)
  expect(ownRoom?.players[0].playerId).toBe(first.seatId)
  expect(ownRoom?.players[0].playerId).not.toBe(first.profile.id)
  expect(JSON.stringify(ownRoom)).not.toContain(first.token)
  for (const credential of [first.profile.id, first.sessionId, first.seatId]) {
    const response = await fetch(`${host.url}/api/v1/session`, { headers: { Authorization: `Bearer ${credential}` } })
    expect(response.status).toBe(401)
    await rejectConnection(host, { token: credential, playerId: first.seatId, sessionId: first.sessionId })
  }
  await rejectConnection(host, { playerId: first.profile.id, sessionId: first.sessionId })
  const authenticated = await fetch(`${host.url}/api/v1/session`, {
    headers: { Authorization: `Bearer ${first.token}` },
  })
  expect(authenticated.status).toBe(200)
  expect(await authenticated.json()).toEqual(first)
})

it('requires the private password for players and spectators and denies spectator player privileges', async () => {
  const host = await boot({ maxSpectators: 1 })
  const [owner, player, spectator, extra] = await Promise.all(
    ['owner', 'player', 'spectator', 'extra'].map(async id => connect(host, await session(host, id))),
  )
  const room = await createRoom(owner, { isPrivate: true, password: 'room-secret' })
  for (const name of ['joinPrivateRoom', 'joinPrivateRoomAsSpectator']) {
    expect(await ack(spectator, name, room)).toEqual({ status: 'ERROR', code: 'INVALID_PASSWORD' })
    expect(await ack(spectator, name, { ...room, password: 'incorrect' })).toEqual({
      status: 'ERROR',
      code: 'INVALID_PASSWORD',
    })
  }
  await success(player, 'joinPrivateRoom', { ...room, password: 'room-secret' })
  await success(spectator, 'joinPrivateRoomAsSpectator', { ...room, password: 'room-secret' })
  expect(await ack(extra, 'joinPrivateRoom', { ...room, password: 'room-secret' })).toEqual({
    status: 'ERROR',
    code: 'ROOM_FULL',
  })
  expect(await ack(extra, 'joinPrivateRoomAsSpectator', { ...room, password: 'room-secret' })).toEqual({
    status: 'ERROR',
    code: 'SPECTATOR_LIMIT_REACHED',
  })
  expect(await ack(spectator, 'togglePrivateRoomReady', { team: team() })).toEqual({
    status: 'ERROR',
    code: 'NOT_BATTLE_PLAYER',
  })
  expect(await ack(spectator, 'startPrivateRoomBattle', {})).toEqual({ status: 'ERROR', code: 'NOT_HOST' })
  expect(await ack(spectator, 'updatePrivateRoomConfig', { isPrivate: false })).toEqual({
    status: 'ERROR',
    code: 'NOT_HOST',
  })
  expect(await ack(spectator, 'getAvailableSelection')).toEqual({ status: 'ERROR', code: 'NOT_BATTLE_PLAYER' })
  const view = await current(spectator)
  expect(view?.spectators).toHaveLength(1)
  expect(view?.config.password).toBeUndefined()
  expect(JSON.stringify(view)).not.toContain('room-secret')
})

it('releases room capacity and all seat associations when a room expires', async () => {
  const host = await boot({ maxRooms: 1, roomTtlMs: 300, cleanupIntervalMs: 20 })
  const owner = await connect(host, await session(host, 'owner'))
  const next = await connect(host, await session(host, 'next'))
  const room = await createRoom(owner)
  expect(await ack(next, 'createPrivateRoom', { config: {} })).toEqual({ status: 'ERROR', code: 'ROOM_CAPACITY' })
  const closed = event<PrivateRoomEvent>(owner, 'privateRoomEvent', value => value.type === 'roomClosed')
  expect(await closed).toEqual({ type: 'roomClosed', data: { reason: 'ROOM_EXPIRED' } })
  expect(await current(owner)).toBeNull()
  expect(host.app.rooms.playersInRooms).toBe(0)
  expect(await ack(next, 'joinPrivateRoom', room)).toEqual({ status: 'ERROR', code: 'ROOM_NOT_FOUND' })
  expect((await createRoom(next)).roomCode).toHaveLength(6)
})

it('expires sessions, disconnects active sockets and makes session capacity reusable', async () => {
  const host = await boot({ maxSessions: 1, sessionTtlMs: 250, cleanupIntervalMs: 20, reconnectGraceMs: 30 })
  const original = await session(host)
  const owner = await connect(host, original)
  const room = await createRoom(owner)
  const response = await fetch(`${host.url}/api/v1/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: { id: 'next', name: 'Next' } }),
  })
  expect(response.status).toBe(503)
  expect(await response.json()).toEqual({ code: 'SESSION_CAPACITY' })
  await event(owner, 'disconnect')
  const invalid = await fetch(`${host.url}/api/v1/session`, { headers: { Authorization: `Bearer ${original.token}` } })
  expect(invalid.status).toBe(401)
  await rejectConnection(host, { token: original.token })
  const replacement = await connect(host, await session(host, 'next'))
  await expect.poll(() => host.app.rooms.size).toBe(0)
  expect(await ack(replacement, 'joinPrivateRoom', room)).toEqual({ status: 'ERROR', code: 'ROOM_NOT_FOUND' })
})

it('revoking a session disconnects every socket and removes its seat before acknowledging logout', async () => {
  const host = await boot()
  const ownerSession = await session(host, 'owner')
  const owner = await connect(host, ownerSession)
  const duplicate = await connect(host, ownerSession)
  const peerSession = await session(host, 'peer')
  const peer = await connect(host, peerSession)
  const room = await createRoom(owner)
  await success(peer, 'joinPrivateRoom', room)
  const disconnected = Promise.all([event(owner, 'disconnect'), event(duplicate, 'disconnect')])
  const response = await fetch(`${host.url}/api/v1/session`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ownerSession.token}` },
  })
  expect(response.status).toBe(204)
  await disconnected
  const remaining = await current(peer)
  expect(remaining?.players.map(value => value.playerId)).toEqual([peerSession.seatId])
  expect(remaining?.config.hostPlayerId).toBe(peerSession.seatId)
  expect(host.app.rooms.playersInRooms).toBe(1)
  await rejectConnection(host, { token: ownerSession.token })
  const second = await fetch(`${host.url}/api/v1/session`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${ownerSession.token}` },
  })
  expect(second.status).toBe(401)
})

it('drops rooms and credentials on shutdown even when the next boot uses the same server ID', async () => {
  const first = await boot({ serverId: 'same-server' })
  const original = await session(first)
  const owner = await connect(first, original)
  const room = await createRoom(owner)
  const closed = event<PrivateRoomEvent>(owner, 'privateRoomEvent', value => value.type === 'roomClosed')
  const disconnected = event(owner, 'disconnect')
  await first.app.stop()
  expect(await closed).toEqual({ type: 'roomClosed', data: { reason: 'SERVER_STOPPED' } })
  await disconnected
  expect(first.app.rooms.size).toBe(0)
  expect(first.app.sessions.size).toBe(0)
  const second = await boot({ serverId: 'same-server' })
  const replacement = await session(second)
  expect(replacement.serverId).toBe(original.serverId)
  expect(replacement.bootId).not.toBe(original.bootId)
  await rejectConnection(second, { token: original.token })
  const socket = await connect(second, replacement)
  expect(await current(socket)).toBeNull()
  expect(await ack(socket, 'joinPrivateRoom', room)).toEqual({ status: 'ERROR', code: 'ROOM_NOT_FOUND' })
})

it('removes a disconnected lobby seat after its reconnect grace period', async () => {
  const host = await boot({ reconnectGraceMs: 100, cleanupIntervalMs: 20 })
  const ownerSession = await session(host, 'owner')
  const owner = await connect(host, ownerSession)
  const peerSession = await session(host, 'peer')
  const peer = await connect(host, peerSession)
  const room = await createRoom(owner)
  await success(peer, 'joinPrivateRoom', room)
  const removed = event<PrivateRoomEvent>(
    owner,
    'privateRoomEvent',
    value => value.type === 'roomUpdate' && value.data.players.length === 1,
  )
  peer.disconnect()
  await removed
  expect(host.app.rooms.playersInRooms).toBe(1)
  const reconnected = await connect(host, peerSession)
  expect(await current(reconnected)).toBeNull()
  await success(reconnected, 'joinPrivateRoom', room)
  expect((await current(owner))?.players.map(value => value.playerId)).toEqual([
    ownerSession.seatId,
    peerSession.seatId,
  ])
})

it('limits P2P relay to the other player and lets only the host finish the battle and return to the lobby', async () => {
  const host = await boot()
  const [ownerSession, peerSession, spectatorSession, foreignSession] = await Promise.all(
    ['owner', 'peer', 'spectator', 'foreign'].map(id => session(host, id)),
  )
  const [owner, peer, spectator, foreign] = await Promise.all(
    [ownerSession, peerSession, spectatorSession, foreignSession].map(value => connect(host, value)),
  )
  const room = await createRoom(owner, { battleMode: 'p2p', p2pTransport: 'relay', timerConfig: { enabled: false } })
  await success(peer, 'joinPrivateRoom', room)
  await success(spectator, 'joinPrivateRoomAsSpectator', room)
  await createRoom(foreign, { battleMode: 'p2p' })
  await success(owner, 'togglePrivateRoomReady', { team: team(0) })
  await success(peer, 'togglePrivateRoomReady', { team: team(1) })
  const started = await success<{ battleRoomId: string }>(owner, 'startPrivateRoomBattle', {})
  expect(await ack(spectator, 'joinSpectateBattle', { battleRoomId: started.battleRoomId })).toEqual({
    status: 'ERROR',
    code: 'P2P_SPECTATE_UNSUPPORTED',
  })
  expect(await ack(peer, 'joinSpectateBattle', { battleRoomId: started.battleRoomId })).toEqual({
    status: 'ERROR',
    code: 'P2P_SPECTATE_UNSUPPORTED',
  })
  const signal = { transport: 'relay', kind: 'custom', data: { message: 'hello' } }
  expect(await ack(owner, 'sendPrivateRoomPeerSignal', { targetPlayerId: foreignSession.seatId, signal })).toEqual({
    status: 'ERROR',
    code: 'SIGNAL_TARGET_NOT_FOUND',
  })
  expect(await ack(owner, 'sendPrivateRoomPeerSignal', { targetPlayerId: spectatorSession.seatId, signal })).toEqual({
    status: 'ERROR',
    code: 'SIGNAL_TARGET_NOT_FOUND',
  })
  expect(
    await ack(owner, 'sendPrivateRoomPeerSignal', {
      targetPlayerId: peerSession.seatId,
      targetSessionId: foreignSession.sessionId,
      signal,
    }),
  ).toEqual({ status: 'ERROR', code: 'SIGNAL_TARGET_NOT_FOUND' })
  expect(await ack(spectator, 'sendPrivateRoomPeerSignal', { targetPlayerId: peerSession.seatId, signal })).toEqual({
    status: 'ERROR',
    code: 'NOT_BATTLE_PLAYER',
  })
  expect(await ack(foreign, 'sendPrivateRoomPeerSignal', { targetPlayerId: peerSession.seatId, signal })).toEqual({
    status: 'ERROR',
    code: 'INVALID_STATE',
  })
  const relayed = event(peer, 'privateRoomPeerSignal')
  await success(owner, 'sendPrivateRoomPeerSignal', {
    targetPlayerId: peerSession.seatId,
    from: { playerId: foreignSession.seatId },
    signal,
  })
  expect(await relayed).toMatchObject({
    roomCode: room.roomCode,
    from: { playerId: ownerSession.seatId, sessionId: ownerSession.sessionId },
    to: { playerId: peerSession.seatId, sessionId: peerSession.sessionId },
    signal,
  })
  expect(await ack(peer, 'finishPrivateRoomBattle', { winner: peerSession.seatId, reason: 'surrender' })).toEqual({
    status: 'ERROR',
    code: 'NOT_HOST',
  })
  expect(await ack(spectator, 'finishPrivateRoomBattle', { winner: peerSession.seatId, reason: 'surrender' })).toEqual({
    status: 'ERROR',
    code: 'NOT_HOST',
  })
  expect(await ack(owner, 'finishPrivateRoomBattle', { winner: foreignSession.seatId, reason: 'surrender' })).toEqual({
    status: 'ERROR',
    code: 'INVALID_REQUEST',
  })
  const finished = event<PrivateRoomEvent>(peer, 'privateRoomEvent', value => value.type === 'battleFinished')
  const battleClosed = event(owner, 'roomClosed', () => true, 7000)
  await success(owner, 'finishPrivateRoomBattle', { winner: ownerSession.seatId, reason: 'surrender' })
  expect(await finished).toMatchObject({
    type: 'battleFinished',
    data: { battleResult: { winner: ownerSession.seatId, battleRoomId: started.battleRoomId } },
  })
  expect(await battleClosed).toEqual({ roomId: started.battleRoomId })
  const lobby = await current(owner)
  expect(lobby?.status).toBe('waiting')
  expect(lobby?.players).toHaveLength(2)
  expect(lobby?.players.every(player => !player.isReady)).toBe(true)
  expect(lobby?.battleRoomId).toBeUndefined()
  expect(lobby?.lastBattleResult?.winner).toBe(ownerSession.seatId)
}, 15_000)

it('HTTP and WebSocket accept only the exact paired site origin', async () => {
  const host = await boot({ corsOrigins: ['https://paired.example'] })
  const value = await session(host)
  for (const origin of ['https://paired.example', 'https://unpaired.example', 'null']) {
    const response = await fetch(`${host.url}/api/v1/server-info`, { headers: { Origin: origin } })
    expect(response.headers.get('access-control-allow-origin')).toBe(
      origin === 'https://paired.example' ? origin : null,
    )
    const socket = io(host.url, {
      auth: { token: value.token },
      extraHeaders: { Origin: origin },
      transports: ['websocket'],
      reconnection: false,
      autoConnect: false,
    })
    sockets.push(socket)
    const result = event(socket, origin === 'https://paired.example' ? 'connect' : 'connect_error')
    socket.connect()
    await result
    expect(socket.connected).toBe(origin === 'https://paired.example')
    socket.disconnect()
  }
})

it('rejects wildcard and opaque public CORS configuration', () => {
  for (const origin of ['*', 'null', 'https://paired.example/path']) {
    expect(() => createSingleProcessApp({ corsOrigins: [origin] })).toThrow()
  }
  expect(() => createSingleProcessApp({ host: '0.0.0.0', desktopLocal: true, corsOrigins: ['null'] })).toThrow(
    'loopback',
  )
})

it('default allows only the fixed shipped desktop origin and explicit lists can opt out', async () => {
  const defaultHost = await boot({ corsOrigins: undefined })
  for (const origin of ['arcadia-client://app', 'arcadia-client://other', 'null']) {
    const response = await fetch(`${defaultHost.url}/health`, { headers: { Origin: origin } })
    expect(response.headers.get('access-control-allow-origin')).toBe(origin === 'arcadia-client://app' ? origin : null)
  }
  const restricted = await boot({ corsOrigins: [] })
  const response = await fetch(`${restricted.url}/health`, { headers: { Origin: 'arcadia-client://app' } })
  expect(response.headers.get('access-control-allow-origin')).toBeNull()
})
