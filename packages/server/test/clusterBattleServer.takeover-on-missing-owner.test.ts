import { describe, expect, it, vi } from 'vitest'
import type { RoomState } from '../src/cluster/types'
import { ClusterBattleServer } from '../src/domain/battle/services/clusterBattleServer'

function createRoom(id: string, status: RoomState['status'], instanceId = 'instance-dead'): RoomState {
  return {
    id,
    status,
    sessions: ['s1', 's2'],
    sessionPlayers: {
      s1: 'player-1',
      s2: 'player-2',
    },
    instanceId,
    lastActive: Date.now(),
    battleState: undefined,
    spectators: [],
    metadata: {
      createdAt: Date.now(),
      ruleSetId: 'casual_standard_ruleset',
    },
  }
}

describe('ClusterBattleServer missing-owner takeover', () => {
  it('tries request-driven takeover for mutation when target instance is missing', async () => {
    const server = Object.create(ClusterBattleServer.prototype) as any
    server.stateManager = {
      getInstance: vi.fn(async () => null),
    }
    server.tryRequestDrivenTakeover = vi.fn(async () => ({
      kind: 'handled',
      result: { status: 'ACTION_ACCEPTED' },
    }))
    server.handleOrphanedRoom = vi.fn(async () => {})
    server.shouldCleanupOrphanedRoom = vi.fn(async () => true)

    const result = await server.forwardPlayerAction('instance-dead', 'submitPlayerSelection', 'player-1', {
      roomId: 'room-1',
      selection: { type: 'do-nothing', player: 'player-1' },
    })

    expect(result).toEqual({ status: 'ACTION_ACCEPTED' })
    expect(server.tryRequestDrivenTakeover).toHaveBeenCalledWith(
      'instance-dead',
      'submitPlayerSelection',
      'player-1',
      expect.objectContaining({ roomId: 'room-1' }),
    )
    expect(server.handleOrphanedRoom).not.toHaveBeenCalled()
  })

  it('ends room when request-driven takeover cannot recover runtime', async () => {
    const room = createRoom('room-unrecoverable', 'active', 'instance-dead')

    const server = Object.create(ClusterBattleServer.prototype) as any
    server.instanceId = 'instance-self'
    server.battleService = {
      getLocalBattle: vi.fn(() => undefined),
    }
    server.stateManager = {
      getRoomState: vi.fn(async () => room),
      setRoomState: vi.fn(async () => {}),
    }
    server.sessionStateManager = {
      batchUpdateSessionStates: vi.fn(async () => {}),
    }
    server.cleanupSessionRoomMappings = vi.fn(async () => {})
    server.cleanupBattleStateSnapshotsForRoom = vi.fn(async () => {})
    server.sendToPlayerSession = vi.fn(async () => true)

    const result = await server.tryRequestDrivenTakeover(
      'instance-dead',
      'submitPlayerSelection',
      'player-1',
      { roomId: room.id, selection: { type: 'do-nothing', player: 'player-1' } },
    )

    expect(result).toEqual({ kind: 'retry' })
    expect(server.stateManager.setRoomState).toHaveBeenCalledWith(
      expect.objectContaining({
        id: room.id,
        status: 'ended',
        instanceId: 'instance-self',
      }),
    )
    expect(server.cleanupSessionRoomMappings).toHaveBeenCalledWith(expect.objectContaining({ id: room.id }))
    expect(server.sessionStateManager.batchUpdateSessionStates).toHaveBeenCalledWith(
      [
        { playerId: 'player-1', sessionId: 's1' },
        { playerId: 'player-2', sessionId: 's2' },
      ],
      'idle',
    )
  })

  it('preserves active and waiting rooms on crashed instance cleanup', async () => {
    const activeRoom = createRoom('room-active', 'active')
    const waitingRoom = createRoom('room-waiting', 'waiting')
    const endedRoom = createRoom('room-ended', 'ended')

    const server = Object.create(ClusterBattleServer.prototype) as any
    server.stateManager = {
      getRooms: vi.fn(async () => [activeRoom, waitingRoom, endedRoom]),
    }
    server.batchAutonomousTakeover = vi.fn(async () => {})
    server.cleanupOrphanedRoomState = vi.fn(async () => {})

    await server.handleInstanceCrash('instance-dead')

    expect(server.batchAutonomousTakeover).toHaveBeenCalledWith([activeRoom, waitingRoom], 'instance-crash')
    expect(server.cleanupOrphanedRoomState).toHaveBeenCalledTimes(1)
    expect(server.cleanupOrphanedRoomState).toHaveBeenCalledWith(endedRoom)
  })

  it('preserves active and waiting rooms on left-instance cleanup', async () => {
    const activeRoom = createRoom('room-active', 'active')
    const waitingRoom = createRoom('room-waiting', 'waiting')
    const endedRoom = createRoom('room-ended', 'ended')

    const server = Object.create(ClusterBattleServer.prototype) as any
    server.instanceId = 'instance-self'
    server.stateManager = {
      getRooms: vi.fn(async () => [activeRoom, waitingRoom, endedRoom]),
    }
    server.batchAutonomousTakeover = vi.fn(async () => {})
    server.cleanupOrphanedRoomState = vi.fn(async () => {})

    await server.handleInstanceLeave({ instanceId: 'instance-dead' })

    expect(server.batchAutonomousTakeover).toHaveBeenCalledWith([activeRoom, waitingRoom], 'instance-leave')
    expect(server.cleanupOrphanedRoomState).toHaveBeenCalledTimes(1)
    expect(server.cleanupOrphanedRoomState).toHaveBeenCalledWith(endedRoom)
  })

  it('autonomously takes over active room when owner instance is unavailable', async () => {
    const room = createRoom('room-active', 'active', 'instance-dead')

    const server = Object.create(ClusterBattleServer.prototype) as any
    server.instanceId = 'instance-self'
    server.isOwnerInstanceUnavailable = vi.fn(async () => true)
    server.claimRuntimeOwnership = vi.fn(async () => ({
      roomId: room.id,
      ownerInstanceId: 'instance-self',
      status: 'active',
      lastUpdatedAt: Date.now(),
      leaseExpireAt: Date.now() + 30_000,
    }))
    server.battleService = {
      recoverLocalBattleRuntime: vi.fn(async () => true),
    }
    server.stateManager = {
      setRoomState: vi.fn(async () => {}),
    }

    const result = await server.tryAutonomousTakeover(room, 'test-trigger')

    expect(result).toBe(true)
    expect(server.battleService.recoverLocalBattleRuntime).toHaveBeenCalledWith('room-active')
    expect(server.stateManager.setRoomState).toHaveBeenCalledWith(room)
    expect(room.instanceId).toBe('instance-self')
  })
})
