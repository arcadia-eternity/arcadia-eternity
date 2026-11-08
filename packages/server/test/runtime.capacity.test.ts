import { afterEach, beforeAll, expect, it } from 'vitest'
import { io, type Socket } from 'socket.io-client'
import { setGlobalLogger } from '@arcadia-eternity/battle/engine'
import type { PrivateRoomInfo, ServerSession } from '@arcadia-eternity/protocol'
import { createSingleProcessApp, type SingleProcessAppOptions } from '../src/runtime/app'
import input from '../../battle/test/fixtures/official-switch.input.json'

const team = input.teams[1].team.map(({ maxHp: _maxHp, ...pet }) => ({
  ...pet,
  skills: ['skill_paida', 'skill_shuipao'],
}))
const apps: ReturnType<typeof createSingleProcessApp>[] = []
const sockets: Socket[] = []
beforeAll(() => setGlobalLogger({ debug() {}, info() {}, warn() {}, error() {} }))
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect()
  await Promise.all(apps.splice(0).map(app => app.stop()))
})
type Reply<T = unknown> = { status: 'SUCCESS'; data: T } | { status: 'ERROR'; code: string }
function ack<T = unknown>(socket: Socket, event: string, data?: unknown): Promise<Reply<T>> {
  return new Promise((resolve, reject) => {
    const reply = (error: Error | null, response: Reply<T>) => (error ? reject(error) : resolve(response))
    if (data === undefined) socket.timeout(30000).emit(event, reply)
    else socket.timeout(30000).emit(event, data, reply)
  })
}
async function success<T = unknown>(socket: Socket, event: string, data?: unknown) {
  const result = await ack<T>(socket, event, data)
  expect(result.status, JSON.stringify(result)).toBe('SUCCESS')
  if (result.status !== 'SUCCESS') throw new Error(result.code)
  return result.data
}
async function fixture(options: SingleProcessAppOptions = {}, count = 4) {
  const app = createSingleProcessApp({
    port: 0,
    host: '127.0.0.1',
    corsOrigins: [],
    maxConcurrentBattles: 1,
    maxIdleWorkers: 1,
    maxQueuedBattles: 2,
    battleQueueTimeoutMs: 5000,
    ...options,
  })
  apps.push(app)
  await app.start()
  const url = `http://127.0.0.1:${app.address!.port}`
  const users = await Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const response = await fetch(`${url}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: { id: `profile-${index}`, name: `Player ${index}` } }),
      })
      expect(response.status).toBe(201)
      const session = (await response.json()) as ServerSession
      const socket = io(url, {
        auth: { token: session.token },
        transports: ['websocket'],
        reconnection: false,
        autoConnect: false,
      })
      sockets.push(socket)
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve)
        socket.once('connect_error', reject)
        socket.connect()
      })
      return socket
    }),
  )
  for (let i = 0; i < count; i += 2) {
    const room = await success<{ roomCode: string }>(users[i], 'createPrivateRoom', {
      config: { battleMode: 'server' },
    })
    await success(users[i + 1], 'joinPrivateRoom', { roomCode: room.roomCode })
    await success(users[i + 1], 'togglePrivateRoomReady', { team })
  }
  await success(users[0], 'startPrivateRoomBattle', { hostTeam: team })
  expect(app.rooms.battleWorkerStats.active).toBe(1)
  return { app, users }
}

it('queues a second room until the first releases its exclusive battle slot', async () => {
  const { app, users } = await fixture()
  const waiting = ack(users[2], 'startPrivateRoomBattle', { hostTeam: team })
  await expect.poll(() => app.rooms.battleWorkerStats.queued).toBe(1)
  expect(app.rooms.battleWorkerStats.workers).toBe(1)
  await success(users[0], 'leavePrivateRoom')
  expect((await waiting).status).toBe('SUCCESS')
  expect(app.rooms.battleWorkerStats).toMatchObject({ active: 1, queued: 0, workers: 1 })
}, 30000)

it('returns stable capacity and timeout errors while leaving rooms available to retry', async () => {
  const { app, users } = await fixture({ maxQueuedBattles: 1, battleQueueTimeoutMs: 300 }, 6)
  const waiting = ack(users[2], 'startPrivateRoomBattle', { hostTeam: team })
  await expect.poll(() => app.rooms.battleWorkerStats.queued).toBe(1)
  expect(await ack(users[4], 'startPrivateRoomBattle', { hostTeam: team })).toEqual({
    status: 'ERROR',
    code: 'BATTLE_CAPACITY_FULL',
  })
  expect(await waiting).toEqual({ status: 'ERROR', code: 'BATTLE_QUEUE_TIMEOUT' })
  const room = await success<PrivateRoomInfo>(users[2], 'getCurrentPrivateRoom')
  expect(room.status).not.toBe('started')
  expect(room.battleRoomId).toBeUndefined()
  expect(app.rooms.battleWorkerStats).toMatchObject({ active: 1, queued: 0 })
}, 30000)

it.each(['leave', 'disconnect', 'stop'] as const)(
  'cancels a queued launch promptly on %s',
  async action => {
    const { app, users } = await fixture({ battleQueueTimeoutMs: 60000 })
    const waiting = ack(users[2], 'startPrivateRoomBattle', { hostTeam: team })
    // Shutdown closes sockets; still consume the in-flight acknowledgement if transport closes first.
    if (action === 'stop') void waiting.catch(() => undefined)
    await expect.poll(() => app.rooms.battleWorkerStats.queued).toBe(1)
    const started = Date.now()
    if (action === 'leave') await success(users[3], 'leavePrivateRoom')
    else if (action === 'disconnect') users[3].disconnect()
    else {
      await app.stop()
      expect(app.environments.retainedIds()).toEqual([])
    }
    if (action !== 'stop') {
      expect(await waiting).toEqual({ status: 'ERROR', code: 'BATTLE_LAUNCH_CANCELED' })
      const room = await success<PrivateRoomInfo>(users[2], 'getCurrentPrivateRoom')
      expect(room.status).not.toBe('started')
      expect(room.battleRoomId).toBeUndefined()
    }
    await expect.poll(() => app.rooms.battleWorkerStats.queued).toBe(0)
    expect(Date.now() - started).toBeLessThan(5000)
  },
  30000,
)

it('invalidates every previously submitted start when leaving during a queued launch', async () => {
  const { app, users } = await fixture({ battleQueueTimeoutMs: 60000 })
  const startedEvents: unknown[] = []
  users[3].on('privateRoomEvent', event => {
    if (event.type === 'battleStarted') startedEvents.push(event)
  })
  const first = ack(users[2], 'startPrivateRoomBattle', { hostTeam: team })
  await expect.poll(() => app.rooms.battleWorkerStats.queued).toBe(1)
  // Ordered packets from one socket: the second start is behind the first in room.pending.
  const second = ack(users[2], 'startPrivateRoomBattle', { hostTeam: team })
  const began = Date.now()
  await success(users[2], 'leavePrivateRoom')
  expect(await first).toEqual({ status: 'ERROR', code: 'BATTLE_LAUNCH_CANCELED' })
  expect(await second).toEqual({ status: 'ERROR', code: 'BATTLE_LAUNCH_CANCELED' })
  expect(Date.now() - began).toBeLessThan(5000)
  expect(app.rooms.battleWorkerStats.queued).toBe(0)
  expect(startedEvents).toEqual([])
  expect((await success<PrivateRoomInfo>(users[3], 'getCurrentPrivateRoom')).status).not.toBe('started')
}, 30000)
