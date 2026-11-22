import { afterEach, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { withShippedEnvironmentProject } from '@arcadia-eternity/pack-loader/node'
import { fileURLToPath } from 'node:url'
import { createSingleProcessApp, type SingleProcessApp } from '../src/runtime/app'
import { preparePeerEnvironment } from '../../web-ui/src/services/peerEnvironment'
import type { PrivateRoomInfo } from '@arcadia-eternity/protocol'
import type { Socket } from 'socket.io'
import { PlayerSchema, parseWithErrors } from '@arcadia-eternity/schema'
import input from '../../battle/test/fixtures/official-switch.input.json'
const apps: SingleProcessApp[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.stop()
})
async function boot() {
  const app = createSingleProcessApp()
  apps.push(app)
  await app.environments.ready()
  return app
}
async function connect(app: SingleProcessApp, name: string) {
  const session = await app.sessions.create({ id: name, name })
  const wire = Object.assign(new EventEmitter(), { disconnect() {} })
  await app.rooms.connect(wire as unknown as Socket, session)
  return wire
}
type Ack<T = unknown> = { status: 'SUCCESS'; data: T } | { status: 'ERROR'; code: string }
function ack<T = unknown>(socket: EventEmitter, name: string, data?: unknown): Promise<Ack<T>> {
  return new Promise(resolve => {
    if (data === undefined) socket.emit(name, resolve)
    else socket.emit(name, data, resolve)
  })
}

async function success<T = unknown>(socket: EventEmitter, name: string, data?: unknown): Promise<T> {
  const response = await ack<T>(socket, name, data)
  expect(response.status, `${name}: ${JSON.stringify(response)}`).toBe('SUCCESS')
  if (response.status !== 'SUCCESS') throw new Error(response.code)
  return response.data
}

function current(socket: EventEmitter) {
  return success<PrivateRoomInfo | null>(socket, 'getCurrentPrivateRoom')
}

function createRoom(socket: EventEmitter, config: Record<string, unknown> = {}) {
  return success<{ roomCode: string }>(socket, 'createPrivateRoom', { config })
}

function team(index = 0) {
  const { maxHp: _maxHp, ...draft } = input.teams[1].team[0]
  return parseWithErrors(PlayerSchema, {
    ...input.teams[index],
    team: [{ ...draft, skills: ['skill_paida', 'skill_shuipao'] }],
  }).team
}

it('lets the host keep a spectator seat, start two ready players and watch their server battle', async () => {
  const host = await boot()
  const [owner, a, b] = await Promise.all(['owner', 'a', 'b'].map(name => connect(host, name)))
  const room = await createRoom(owner)
  const config = (await current(owner))!.config
  const hostId = config.hostPlayerId
  expect(config.timerConfig?.enabled).toBe(false)
  await success(owner, 'switchToSpectator')
  await success(a, 'joinPrivateRoom', room)
  await success(a, 'leavePrivateRoom')
  expect((await current(owner))?.spectators[0].playerId).toBe(hostId)
  expect(await ack(owner, 'updatePrivateRoomConfig', { battleMode: 'p2p' })).toMatchObject({
    code: 'HOST_CANNOT_SPECTATE',
  })
  await success(a, 'joinPrivateRoom', room)
  await success(b, 'joinPrivateRoom', room)
  await success(a, 'togglePrivateRoomReady', { team: team(0) })
  expect(await ack(owner, 'startPrivateRoomBattle', {})).toMatchObject({ code: 'PLAYERS_NOT_READY' })
  await success(b, 'togglePrivateRoomReady', { team: team(1) })
  expect(await current(owner)).toMatchObject({ config: { hostPlayerId: hostId }, status: 'ready' })
  expect(await ack(owner, 'startPrivateRoomBattle', { hostTeam: team() })).toMatchObject({ code: 'NOT_BATTLE_PLAYER' })
  const battle = await success<{ battleRoomId: string }>(owner, 'startPrivateRoomBattle', {})
  await success(owner, 'joinSpectateBattle', { battleRoomId: battle.battleRoomId })
  await success(a, 'ready')
  await success(b, 'ready')
  expect(await success(owner, 'getState')).toMatchObject({ players: expect.any(Array) })
  expect(await ack(owner, 'getAvailableSelection')).toMatchObject({ code: 'NOT_BATTLE_PLAYER' })
}, 30000)

it('runs a published official environment in P2P when the clients accept its peer revision', async () => {
  const app = await boot()
  const id = app.environments.descriptor().id
  app.environments.setPublication(
    [{ runtimeId: id, enabled: true, public: true, matchmaking: true, executionPolicy: 'server' }],
    id,
  )
  const [environment] = app.environments.list()
  expect(environment.peerRevision).toBeTruthy()
  const acceptance = {
    environmentId: id,
    protocolVersion: 1,
    gameplayRevision: environment.gameplayRevision,
    resourceRevision: environment.resourceRevision,
    resourcesReady: true,
    peerRevision: environment.peerRevision,
  }
  const [a, b] = await Promise.all(['a', 'b'].map(name => connect(app, name)))
  const created = await success<{ roomCode: string }>(a, 'createPrivateRoom', {
    environmentId: id,
    config: { battleMode: 'p2p' },
  })
  expect(await ack(a, 'switchToSpectator')).toMatchObject({ code: 'HOST_CANNOT_SPECTATE' })
  expect(await ack(b, 'joinPrivateRoomAsSpectator', created)).toMatchObject({ code: 'P2P_SPECTATE_UNSUPPORTED' })
  expect(await current(b)).toBeNull()
  await success(b, 'joinPrivateRoom', created)
  expect(await ack(b, 'switchToSpectator')).toMatchObject({ code: 'P2P_SPECTATE_UNSUPPORTED' })
  expect(
    await ack(b, 'togglePrivateRoomReady', { team: team(1), environment: { ...acceptance, peerRevision: 'stale' } }),
  ).toMatchObject({ code: 'CLIENT_PEER_ENVIRONMENT_MISMATCH' })
  await success(b, 'togglePrivateRoomReady', { team: team(1), environment: acceptance })
  await success(a, 'startPrivateRoomBattle', { hostTeam: team(0), environment: acceptance })
  expect((await current(a))?.config.battleMode).toBe('p2p')
})

it('prepares the complete official base in the web P2P client', async () => {
  const app = await boot()
  const { id } = await withShippedEnvironmentProject(
    fileURLToPath(new URL('../../../packs/base/', import.meta.url)),
    dir =>
      app.environments.prepareNpm(dir, { policy: { profile: 'official' } }, { effectPreparation: 'prebuilt-only' }),
  )
  app.environments.setPublication(
    [{ runtimeId: id, enabled: true, public: true, matchmaking: true, executionPolicy: 'server' }],
    id,
  )
  const [desc] = app.environments.list()
  const request: typeof fetch = async url => {
    if (url === `https://arcadia.test/api/v1/environments/${id}/content`)
      return Response.json(app.environments.content(id))
    if (url === `https://arcadia.test/api/v1/environments/${id}/peer-materials`)
      return Response.json(app.environments.peerMaterials(id))
    throw new Error('Unexpected environment request')
  }
  const result = await preparePeerEnvironment('https://arcadia.test', desc, request)
  expect(result.acceptance.peerRevision).toBe(desc.peerRevision)
})
