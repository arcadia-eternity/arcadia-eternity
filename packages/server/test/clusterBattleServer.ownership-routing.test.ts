import { describe, it, expect, vi } from 'vitest'
import type { RoomState } from '../src/cluster/types'
import { ClusterBattleServer } from '../src/domain/battle/services/clusterBattleServer'
import { REDIS_KEYS } from '../src/cluster/types'

function createRoomState(instanceId: string): RoomState {
  return {
    id: 'room-1',
    status: 'active',
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

function createServerWithOwnershipRaw(ownershipRaw: string | null): any {
  const server = Object.create(ClusterBattleServer.prototype) as any
  server.instanceId = 'instance-a'
  server.forwardFailureWindows = new Map()
  server.FORWARD_FAILOVER_THRESHOLD = 3
  server.FORWARD_FAILOVER_WINDOW_MS = 60_000
  server.stateManager = {
    getInstance: vi.fn(async () => null),
    redisManager: {
      getClient: () => ({
        get: vi.fn(async (key: string) => {
          if (key === REDIS_KEYS.BATTLE_RUNTIME_OWNERSHIP('room-1')) {
            return ownershipRaw
          }
          return null
        }),
        setex: vi.fn(async () => 'OK'),
      }),
    },
  }
  server.rpcClient = {}
  server.battleService = {
    removeDisconnectedPlayer: vi.fn(async () => {}),
    handleLocalPlayerSelection: vi.fn(async () => ({ status: 'ACTION_ACCEPTED' })),
    getLocalBattle: vi.fn(() => ({})),
  }
  server.handleOrphanedRoom = vi.fn(async () => {})
  return server
}

function createTimeoutForwardServer(ownershipRaw: string): any {
  const server = createServerWithOwnershipRaw(ownershipRaw)
  server.stateManager.getInstance = vi.fn(async () => ({
    id: 'instance-b',
    rpcAddress: '127.0.0.1:5000',
    host: '127.0.0.1',
    status: 'healthy',
    load: 0,
    rooms: 0,
    players: 0,
    uptime: 0,
    version: 'test',
    lastHeartbeat: Date.now(),
  }))
  server.rpcClient = {
    submitPlayerSelection: vi.fn(async () => {
      throw new Error('RPC_TIMEOUT')
    }),
    getBattleState: vi.fn(async () => {
      throw new Error('RPC_TIMEOUT')
    }),
  }
  server.verifyInstanceReachability = vi.fn(async () => false)
  return server
}

describe('ClusterBattleServer ownership routing', () => {
  it('does not cleanup orphaned room when ownership lease is still valid', async () => {
    const ownershipRaw = JSON.stringify({
      roomId: 'room-1',
      ownerInstanceId: 'instance-b',
      status: 'active',
      leaseExpireAt: Date.now() + 60_000,
      lastUpdatedAt: Date.now(),
    })
    const server = createServerWithOwnershipRaw(ownershipRaw)

    await expect(
      server.forwardPlayerAction('instance-b', 'submitPlayerSelection', 'player-1', {
        roomId: 'room-1',
        selection: { type: 'use-skill' },
      }),
    ).rejects.toThrow('BATTLE_OWNER_TEMP_UNAVAILABLE')

    expect(server.handleOrphanedRoom).not.toHaveBeenCalled()
  })

  it('returns temporary unavailable when ownership lease is expired but takeover cannot recover', async () => {
    const ownershipRaw = JSON.stringify({
      roomId: 'room-1',
      ownerInstanceId: 'instance-b',
      status: 'active',
      leaseExpireAt: Date.now() - 1_000,
      lastUpdatedAt: Date.now() - 2_000,
    })
    const server = createServerWithOwnershipRaw(ownershipRaw)

    await expect(
      server.forwardPlayerAction('instance-b', 'submitPlayerSelection', 'player-1', {
        roomId: 'room-1',
        selection: { type: 'use-skill' },
      }),
    ).rejects.toThrow('BATTLE_OWNER_TEMP_UNAVAILABLE')

    expect(server.handleOrphanedRoom).not.toHaveBeenCalled()
  })

  it('does not cleanup orphaned room for read action when target instance is unavailable', async () => {
    const ownershipRaw = JSON.stringify({
      roomId: 'room-1',
      ownerInstanceId: 'instance-b',
      status: 'active',
      leaseExpireAt: Date.now() - 1_000,
      lastUpdatedAt: Date.now() - 2_000,
    })
    const server = createServerWithOwnershipRaw(ownershipRaw)

    await expect(
      server.forwardPlayerAction('instance-b', 'getState', 'player-1', {
        roomId: 'room-1',
      }),
    ).rejects.toThrow('BATTLE_OWNER_TEMP_UNAVAILABLE')

    expect(server.handleOrphanedRoom).not.toHaveBeenCalled()
  })

  it('old owner forwards mutation request instead of handling locally', async () => {
    const server = Object.create(ClusterBattleServer.prototype) as any
    const roomState = createRoomState('instance-a')
    const forwardResult = { status: 'ACTION_ACCEPTED' }

    server.instanceId = 'instance-a'
    server.getPlayerRoomFromCluster = vi.fn(async () => roomState)
    server.resolveRequestOwnerInstanceId = vi.fn(async () => 'instance-b')
    server.forwardPlayerAction = vi.fn(async () => forwardResult)
    server.battleService = {
      handleLocalPlayerSelection: vi.fn(async () => ({ status: 'ACTION_ACCEPTED' })),
    }

    const ack = vi.fn()
    const socket = {
      id: 'sock-1',
      data: {
        playerId: 'player-1',
        sessionId: 's1',
      },
    }

    await server.handlePlayerSelection(socket, { type: 'use-skill' }, ack)

    expect(server.forwardPlayerAction).toHaveBeenCalledWith('instance-b', 'submitPlayerSelection', 'player-1', {
      roomId: 'room-1',
      selection: { type: 'use-skill' },
    })
    expect(server.battleService.handleLocalPlayerSelection).not.toHaveBeenCalled()
    expect(ack).toHaveBeenCalledWith({
      status: 'SUCCESS',
      data: forwardResult,
    })
  })

  it('keeps returning temporary unavailable when timeout repeats but ownership lease is still valid', async () => {
    const ownershipRaw = JSON.stringify({
      roomId: 'room-1',
      ownerInstanceId: 'instance-b',
      status: 'active',
      leaseExpireAt: Date.now() + 60_000,
      lastUpdatedAt: Date.now(),
    })
    const server = createTimeoutForwardServer(ownershipRaw)

    await expect(
      server.forwardPlayerAction('instance-b', 'submitPlayerSelection', 'player-1', {
        roomId: 'room-1',
        selection: { type: 'use-skill' },
      }),
    ).rejects.toThrow('BATTLE_OWNER_TEMP_UNAVAILABLE')
    await expect(
      server.forwardPlayerAction('instance-b', 'submitPlayerSelection', 'player-1', {
        roomId: 'room-1',
        selection: { type: 'use-skill' },
      }),
    ).rejects.toThrow('BATTLE_OWNER_TEMP_UNAVAILABLE')
    await expect(
      server.forwardPlayerAction('instance-b', 'submitPlayerSelection', 'player-1', {
        roomId: 'room-1',
        selection: { type: 'use-skill' },
      }),
    ).rejects.toThrow('BATTLE_OWNER_TEMP_UNAVAILABLE')

    expect(server.handleOrphanedRoom).not.toHaveBeenCalled()
  })

  it('read retries never trigger cleanup/takeover and do not consume mutation failover threshold', async () => {
    const ownershipRaw = JSON.stringify({
      roomId: 'room-1',
      ownerInstanceId: 'instance-b',
      status: 'active',
      leaseExpireAt: Date.now() - 1_000,
      lastUpdatedAt: Date.now() - 2_000,
    })
    const server = createTimeoutForwardServer(ownershipRaw)
    server.claimRuntimeOwnership = vi.fn(async () => {
      throw new Error('claim should not be called by read retries')
    })

    await expect(
      server.forwardPlayerAction('instance-b', 'getState', 'player-1', {
        roomId: 'room-1',
      }),
    ).rejects.toThrow('BATTLE_OWNER_TEMP_UNAVAILABLE')
    await expect(
      server.forwardPlayerAction('instance-b', 'getState', 'player-1', {
        roomId: 'room-1',
      }),
    ).rejects.toThrow('BATTLE_OWNER_TEMP_UNAVAILABLE')

    // Mutation should still start at failureCount=1 (read retries must not pollute mutation failover window)
    await expect(
      server.forwardPlayerAction('instance-b', 'submitPlayerSelection', 'player-1', {
        roomId: 'room-1',
        selection: { type: 'use-skill' },
      }),
    ).rejects.toThrow('BATTLE_OWNER_TEMP_UNAVAILABLE')

    expect(server.claimRuntimeOwnership).not.toHaveBeenCalled()
    expect(server.handleOrphanedRoom).not.toHaveBeenCalled()
  })

  it('falls back to orphan cleanup when timeout threshold reached and takeover attempt fails', async () => {
    const ownershipRaw = JSON.stringify({
      roomId: 'room-1',
      ownerInstanceId: 'instance-b',
      status: 'active',
      leaseExpireAt: Date.now() - 1_000,
      lastUpdatedAt: Date.now() - 2_000,
    })
    const server = createTimeoutForwardServer(ownershipRaw)
    server.claimRuntimeOwnership = vi.fn(async () => {
      throw new Error('claim failed')
    })

    await expect(
      server.forwardPlayerAction('instance-b', 'submitPlayerSelection', 'player-1', {
        roomId: 'room-1',
        selection: { type: 'use-skill' },
      }),
    ).rejects.toThrow('BATTLE_OWNER_TEMP_UNAVAILABLE')
    await expect(
      server.forwardPlayerAction('instance-b', 'submitPlayerSelection', 'player-1', {
        roomId: 'room-1',
        selection: { type: 'use-skill' },
      }),
    ).rejects.toThrow('BATTLE_OWNER_TEMP_UNAVAILABLE')
    await expect(
      server.forwardPlayerAction('instance-b', 'submitPlayerSelection', 'player-1', {
        roomId: 'room-1',
        selection: { type: 'use-skill' },
      }),
    ).rejects.toThrow('Target instance not available: instance-b')

    expect(server.handleOrphanedRoom).toHaveBeenCalledTimes(1)
    expect(server.handleOrphanedRoom).toHaveBeenCalledWith('instance-b', 'room-1', 'player-1')
  })

  it('performs request-driven takeover after timeout threshold and handles action locally', async () => {
    const ownershipRaw = JSON.stringify({
      roomId: 'room-1',
      ownerInstanceId: 'instance-b',
      status: 'active',
      leaseExpireAt: Date.now() - 1_000,
      lastUpdatedAt: Date.now() - 2_000,
    })
    const server = createTimeoutForwardServer(ownershipRaw)
    const roomState = createRoomState('instance-b')

    server.stateManager.getRoomState = vi.fn(async () => roomState)
    server.stateManager.setRoomState = vi.fn(async () => {})
    server.claimRuntimeOwnership = vi.fn(async () => ({
      roomId: 'room-1',
      ownerInstanceId: 'instance-a',
      status: 'active',
      leaseExpireAt: Date.now() + 60_000,
      lastUpdatedAt: Date.now(),
    }))
    server.handleActionAsCurrentOwner = vi.fn(async () => ({ status: 'ACTION_ACCEPTED' }))

    await expect(
      server.forwardPlayerAction('instance-b', 'submitPlayerSelection', 'player-1', {
        roomId: 'room-1',
        selection: { type: 'use-skill' },
      }),
    ).rejects.toThrow('BATTLE_OWNER_TEMP_UNAVAILABLE')
    await expect(
      server.forwardPlayerAction('instance-b', 'submitPlayerSelection', 'player-1', {
        roomId: 'room-1',
        selection: { type: 'use-skill' },
      }),
    ).rejects.toThrow('BATTLE_OWNER_TEMP_UNAVAILABLE')

    const result = await server.forwardPlayerAction('instance-b', 'submitPlayerSelection', 'player-1', {
      roomId: 'room-1',
      selection: { type: 'use-skill' },
    })

    expect(result).toEqual({ status: 'ACTION_ACCEPTED' })
    expect(server.claimRuntimeOwnership).toHaveBeenCalledWith('room-1')
    expect(server.stateManager.setRoomState).toHaveBeenCalledTimes(1)
    expect(server.stateManager.setRoomState).toHaveBeenCalledWith(expect.objectContaining({ instanceId: 'instance-a' }))
    expect(server.handleActionAsCurrentOwner).toHaveBeenCalledWith('submitPlayerSelection', 'player-1', {
      roomId: 'room-1',
      selection: { type: 'use-skill' },
    })
    expect(server.handleOrphanedRoom).not.toHaveBeenCalled()
  })

  it('does not cleanup room when takeover precondition fails due to missing local runtime', async () => {
    const ownershipRaw = JSON.stringify({
      roomId: 'room-1',
      ownerInstanceId: 'instance-b',
      status: 'active',
      leaseExpireAt: Date.now() - 1_000,
      lastUpdatedAt: Date.now() - 2_000,
    })
    const server = createTimeoutForwardServer(ownershipRaw)
    server.battleService.getLocalBattle = vi.fn(() => undefined)
    server.claimRuntimeOwnership = vi.fn(async () => ({
      roomId: 'room-1',
      ownerInstanceId: 'instance-a',
      status: 'active',
      leaseExpireAt: Date.now() + 60_000,
      lastUpdatedAt: Date.now(),
    }))

    await expect(
      server.forwardPlayerAction('instance-b', 'submitPlayerSelection', 'player-1', {
        roomId: 'room-1',
        selection: { type: 'use-skill' },
      }),
    ).rejects.toThrow('BATTLE_OWNER_TEMP_UNAVAILABLE')
    await expect(
      server.forwardPlayerAction('instance-b', 'submitPlayerSelection', 'player-1', {
        roomId: 'room-1',
        selection: { type: 'use-skill' },
      }),
    ).rejects.toThrow('BATTLE_OWNER_TEMP_UNAVAILABLE')
    await expect(
      server.forwardPlayerAction('instance-b', 'submitPlayerSelection', 'player-1', {
        roomId: 'room-1',
        selection: { type: 'use-skill' },
      }),
    ).rejects.toThrow('BATTLE_OWNER_TEMP_UNAVAILABLE')

    expect(server.claimRuntimeOwnership).not.toHaveBeenCalled()
    expect(server.handleOrphanedRoom).not.toHaveBeenCalled()
  })

  it('recovers local runtime during request-driven takeover when recovery hook is available', async () => {
    const ownershipRaw = JSON.stringify({
      roomId: 'room-1',
      ownerInstanceId: 'instance-b',
      status: 'active',
      leaseExpireAt: Date.now() - 1_000,
      lastUpdatedAt: Date.now() - 2_000,
    })
    const server = createTimeoutForwardServer(ownershipRaw)
    const roomState = createRoomState('instance-b')

    server.battleService.getLocalBattle = vi.fn(() => undefined)
    server.battleService.recoverLocalBattleRuntime = vi.fn(async () => true)
    server.claimRuntimeOwnership = vi.fn(async () => ({
      roomId: 'room-1',
      ownerInstanceId: 'instance-a',
      status: 'active',
      leaseExpireAt: Date.now() + 60_000,
      lastUpdatedAt: Date.now(),
    }))
    server.stateManager.getRoomState = vi.fn(async () => roomState)
    server.stateManager.setRoomState = vi.fn(async () => {})
    server.handleActionAsCurrentOwner = vi.fn(async () => ({ status: 'ACTION_ACCEPTED' }))

    await expect(
      server.forwardPlayerAction('instance-b', 'submitPlayerSelection', 'player-1', {
        roomId: 'room-1',
        selection: { type: 'use-skill' },
      }),
    ).rejects.toThrow('BATTLE_OWNER_TEMP_UNAVAILABLE')
    await expect(
      server.forwardPlayerAction('instance-b', 'submitPlayerSelection', 'player-1', {
        roomId: 'room-1',
        selection: { type: 'use-skill' },
      }),
    ).rejects.toThrow('BATTLE_OWNER_TEMP_UNAVAILABLE')

    const result = await server.forwardPlayerAction('instance-b', 'submitPlayerSelection', 'player-1', {
      roomId: 'room-1',
      selection: { type: 'use-skill' },
    })

    expect(result).toEqual({ status: 'ACTION_ACCEPTED' })
    expect(server.battleService.recoverLocalBattleRuntime).toHaveBeenCalledWith('room-1')
    expect(server.handleOrphanedRoom).not.toHaveBeenCalled()
  })

  it('preempts stale ownership lease when owner is unavailable and continues request-driven takeover', async () => {
    const ownershipRaw = JSON.stringify({
      roomId: 'room-1',
      ownerInstanceId: 'instance-b',
      status: 'active',
      leaseExpireAt: Date.now() + 60_000,
      lastUpdatedAt: Date.now(),
    })
    const server = createTimeoutForwardServer(ownershipRaw)
    const roomState = createRoomState('instance-b')

    let currentOwnershipRaw = ownershipRaw
    const get = vi.fn(async (key: string) => {
      if (key === REDIS_KEYS.BATTLE_RUNTIME_OWNERSHIP('room-1')) {
        return currentOwnershipRaw
      }
      return null
    })
    const setex = vi.fn(async (_key: string, _ttl: number, value: string) => {
      currentOwnershipRaw = value
      return 'OK'
    })
    server.stateManager.redisManager.getClient = () => ({ get, setex })
    server.stateManager.getInstance = vi.fn(async () => ({
      id: 'instance-b',
      rpcAddress: '127.0.0.1:5000',
      host: '127.0.0.1',
      status: 'healthy',
      load: 0,
      rooms: 0,
      players: 0,
      uptime: 0,
      version: 'test',
      lastHeartbeat: 0,
    }))

    server.battleService.getLocalBattle = vi.fn(() => undefined)
    server.battleService.recoverLocalBattleRuntime = vi.fn(async () => true)
    server.claimRuntimeOwnership = vi.fn(async () => ({
      roomId: 'room-1',
      ownerInstanceId: 'instance-b',
      status: 'active',
      leaseExpireAt: Date.now() + 60_000,
      lastUpdatedAt: Date.now(),
    }))
    server.stateManager.getRoomState = vi.fn(async () => roomState)
    server.stateManager.setRoomState = vi.fn(async () => {})
    server.handleActionAsCurrentOwner = vi.fn(async () => ({ status: 'ACTION_ACCEPTED' }))

    await expect(
      server.forwardPlayerAction('instance-b', 'submitPlayerSelection', 'player-1', {
        roomId: 'room-1',
        selection: { type: 'use-skill' },
      }),
    ).rejects.toThrow('BATTLE_OWNER_TEMP_UNAVAILABLE')
    await expect(
      server.forwardPlayerAction('instance-b', 'submitPlayerSelection', 'player-1', {
        roomId: 'room-1',
        selection: { type: 'use-skill' },
      }),
    ).rejects.toThrow('BATTLE_OWNER_TEMP_UNAVAILABLE')

    const result = await server.forwardPlayerAction('instance-b', 'submitPlayerSelection', 'player-1', {
      roomId: 'room-1',
      selection: { type: 'use-skill' },
    })

    expect(result).toEqual({ status: 'ACTION_ACCEPTED' })
    expect(setex).toHaveBeenCalled()
    expect(server.battleService.recoverLocalBattleRuntime).toHaveBeenCalledWith('room-1')
    expect(server.stateManager.setRoomState).toHaveBeenCalledWith(expect.objectContaining({ instanceId: 'instance-a' }))
    expect(server.handleActionAsCurrentOwner).toHaveBeenCalled()
  })

  it('rejects local mutation when current ownership is draining', async () => {
    const server = Object.create(ClusterBattleServer.prototype) as any
    const roomState = createRoomState('instance-a')

    server.instanceId = 'instance-a'
    server.getPlayerRoomFromCluster = vi.fn(async () => roomState)
    server.resolveRequestOwnerInstanceId = vi.fn(async () => 'instance-a')
    server.getOwnershipRecord = vi.fn(async () => ({
      roomId: 'room-1',
      ownerInstanceId: 'instance-a',
      status: 'draining',
      leaseExpireAt: Date.now() + 60_000,
      lastUpdatedAt: Date.now(),
    }))
    server.battleService = {
      handleLocalPlayerSelection: vi.fn(async () => ({ status: 'ACTION_ACCEPTED' })),
    }

    const ack = vi.fn()
    const socket = {
      id: 'sock-2',
      data: {
        playerId: 'player-1',
        sessionId: 's1',
      },
    }

    await server.handlePlayerSelection(socket, { type: 'use-skill' }, ack)

    expect(server.battleService.handleLocalPlayerSelection).not.toHaveBeenCalled()
    expect(ack).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'ERROR',
        code: 'BATTLE_ACTION_ERROR',
      }),
    )
  })

  it('routes mutation to roomState.instanceId when ownership is draining', async () => {
    const server = Object.create(ClusterBattleServer.prototype) as any
    const roomState = createRoomState('instance-c')

    server.getOwnershipRecord = vi.fn(async () => ({
      roomId: 'room-1',
      ownerInstanceId: 'instance-a',
      status: 'draining',
      leaseExpireAt: Date.now() + 60_000,
      lastUpdatedAt: Date.now(),
    }))
    server.isOwnershipLeaseActive = ClusterBattleServer.prototype['isOwnershipLeaseActive']
    server.isMutationAction = ClusterBattleServer.prototype['isMutationAction']

    const mutationTarget = await ClusterBattleServer.prototype['resolveRequestOwnerInstanceId'].call(
      server,
      roomState,
      'submitPlayerSelection',
    )
    const readTarget = await ClusterBattleServer.prototype['resolveRequestOwnerInstanceId'].call(
      server,
      roomState,
      'getState',
    )

    expect(mutationTarget).toBe('instance-c')
    expect(readTarget).toBe('instance-a')
  })

  it('falls back to local getState when read forwarding fails', async () => {
    const server = Object.create(ClusterBattleServer.prototype) as any
    const roomState = createRoomState('instance-b')

    server.instanceId = 'instance-a'
    server.getPlayerRoomFromCluster = vi.fn(async () => roomState)
    server.resolveRequestOwnerInstanceId = vi.fn(async () => 'instance-b')
    server.forwardPlayerAction = vi.fn(async () => {
      throw new Error('RPC_TIMEOUT')
    })
    server.getLocalBattle = vi.fn(() => ({}))
    server.battleService = {
      handleLocalGetState: vi.fn(async () => ({ from: 'local-fallback' })),
    }

    const ack = vi.fn()
    const socket = {
      id: 'sock-read',
      data: {
        playerId: 'player-1',
        sessionId: 's1',
      },
    }

    await server.handleGetState(socket, ack)

    expect(server.forwardPlayerAction).toHaveBeenCalledWith('instance-b', 'getState', 'player-1', {
      roomId: 'room-1',
    })
    expect(server.battleService.handleLocalGetState).toHaveBeenCalledWith('room-1', 'player-1')
    expect(ack).toHaveBeenCalledWith({
      status: 'SUCCESS',
      data: { from: 'local-fallback' },
    })
  })

  it('falls back to Redis snapshot getState when read forwarding fails and local runtime is missing', async () => {
    const server = Object.create(ClusterBattleServer.prototype) as any
    const roomState = createRoomState('instance-b')

    server.instanceId = 'instance-a'
    server.getPlayerRoomFromCluster = vi.fn(async () => roomState)
    server.resolveRequestOwnerInstanceId = vi.fn(async () => 'instance-b')
    server.forwardPlayerAction = vi.fn(async () => {
      throw new Error('RPC_TIMEOUT')
    })
    server.getLocalBattle = vi.fn(() => undefined)
    server.readBattleStateSnapshot = vi.fn(async () => ({ from: 'redis-snapshot' }))
    server.battleService = {
      handleLocalGetState: vi.fn(async () => ({ from: 'local-fallback' })),
    }

    const ack = vi.fn()
    const socket = {
      id: 'sock-read-snapshot',
      data: {
        playerId: 'player-1',
        sessionId: 's1',
      },
    }

    await server.handleGetState(socket, ack)

    expect(server.forwardPlayerAction).toHaveBeenCalledWith('instance-b', 'getState', 'player-1', {
      roomId: 'room-1',
    })
    expect(server.readBattleStateSnapshot).toHaveBeenCalledWith('room-1', 'player-1')
    expect(server.battleService.handleLocalGetState).not.toHaveBeenCalled()
    expect(ack).toHaveBeenCalledWith({
      status: 'SUCCESS',
      data: { from: 'redis-snapshot' },
    })
  })

  it('attempts request-driven takeover for getSelection when owner read path is temporarily unavailable', async () => {
    const server = Object.create(ClusterBattleServer.prototype) as any
    const roomState = createRoomState('instance-b')

    server.instanceId = 'instance-a'
    server.getPlayerRoomFromCluster = vi.fn(async () => roomState)
    server.resolveRequestOwnerInstanceId = vi.fn(async () => 'instance-b')
    server.forwardPlayerAction = vi.fn(async () => {
      throw new Error('BATTLE_OWNER_TEMP_UNAVAILABLE')
    })
    server.tryRequestDrivenTakeover = vi.fn(async () => ({
      kind: 'handled',
      result: [{ type: 'surrender', player: 'player-1' }],
    }))

    const ack = vi.fn()
    const socket = {
      id: 'sock-get-selection-takeover',
      data: {
        playerId: 'player-1',
        sessionId: 's1',
      },
    }

    await server.handleGetSelection(socket, ack)

    expect(server.forwardPlayerAction).toHaveBeenCalledWith('instance-b', 'getAvailableSelection', 'player-1', {
      roomId: 'room-1',
    })
    expect(server.tryRequestDrivenTakeover).toHaveBeenCalledWith(
      'instance-b',
      'getAvailableSelection',
      'player-1',
      { roomId: 'room-1' },
    )
    expect(ack).toHaveBeenCalledWith({
      status: 'SUCCESS',
      data: [{ type: 'surrender', player: 'player-1' }],
    })
  })

  it('resumes reconnect from local disconnected cache and clears local key', async () => {
    const server = Object.create(ClusterBattleServer.prototype) as any
    const disconnectInfo = {
      roomId: 'room-1',
      graceTimer: setTimeout(() => {}, 60_000),
    }

    server.getPlayerRoomFromCluster = vi.fn(async () => null)
    server.battleService = {
      getDisconnectedPlayer: vi.fn(() => disconnectInfo),
      removeDisconnectedPlayer: vi.fn(async () => {}),
    }
    server.resumeBattle = vi.fn(async () => {})

    const socket = {
      data: {
        playerId: 'player-1',
        sessionId: 's1',
      },
    }

    const result = await server.handlePlayerReconnect(socket)

    expect(result).toEqual({ isReconnect: true, roomId: 'room-1' })
    expect(server.battleService.removeDisconnectedPlayer).toHaveBeenCalledWith('player-1:s1')
    expect(server.resumeBattle).toHaveBeenCalledWith(socket, 'room-1')
  })

  it('resumes reconnect from Redis disconnect info and cleans remote/local records', async () => {
    const server = Object.create(ClusterBattleServer.prototype) as any
    server.instanceId = 'instance-a'
    server.getPlayerRoomFromCluster = vi.fn(async () => null)
    server.battleService = {
      getDisconnectedPlayer: vi.fn(() => undefined),
    }
    server.getRedisDisconnectedPlayer = vi.fn(async () => ({
      playerId: 'player-1',
      sessionId: 's1',
      roomId: 'room-1',
      instanceId: 'instance-b',
      disconnectTime: Date.now() - 1_000,
      expiresAt: Date.now() + 10_000,
    }))
    server.notifyInstanceCleanupDisconnect = vi.fn(async () => {})
    server.cleanupRedisDisconnectedPlayer = vi.fn(async () => {})
    server.resumeBattle = vi.fn(async () => {})

    const socket = {
      data: {
        playerId: 'player-1',
        sessionId: 's1',
      },
    }

    const result = await server.handlePlayerReconnect(socket)

    expect(result).toEqual({ isReconnect: true, roomId: 'room-1' })
    expect(server.notifyInstanceCleanupDisconnect).toHaveBeenCalledWith('instance-b', 'player-1', 's1')
    expect(server.cleanupRedisDisconnectedPlayer).toHaveBeenCalledWith('player-1', 's1')
    expect(server.resumeBattle).toHaveBeenCalledWith(socket, 'room-1')
  })

  it('resumes reconnect from Redis disconnect info on same instance without remote cleanup notification', async () => {
    const server = Object.create(ClusterBattleServer.prototype) as any
    server.instanceId = 'instance-a'
    server.getPlayerRoomFromCluster = vi.fn(async () => null)
    server.battleService = {
      getDisconnectedPlayer: vi.fn(() => undefined),
    }
    server.getRedisDisconnectedPlayer = vi.fn(async () => ({
      playerId: 'player-1',
      sessionId: 's1',
      roomId: 'room-1',
      instanceId: 'instance-a',
      disconnectTime: Date.now() - 1_000,
      expiresAt: Date.now() + 10_000,
    }))
    server.notifyInstanceCleanupDisconnect = vi.fn(async () => {})
    server.cleanupRedisDisconnectedPlayer = vi.fn(async () => {})
    server.resumeBattle = vi.fn(async () => {})

    const socket = {
      data: {
        playerId: 'player-1',
        sessionId: 's1',
      },
    }

    const result = await server.handlePlayerReconnect(socket)

    expect(result).toEqual({ isReconnect: true, roomId: 'room-1' })
    expect(server.notifyInstanceCleanupDisconnect).not.toHaveBeenCalled()
    expect(server.cleanupRedisDisconnectedPlayer).toHaveBeenCalledWith('player-1', 's1')
    expect(server.resumeBattle).toHaveBeenCalledWith(socket, 'room-1')
  })

  it('actively reconnects to active room on same instance', async () => {
    const server = Object.create(ClusterBattleServer.prototype) as any
    server.instanceId = 'instance-a'
    server.getPlayerRoomFromCluster = vi.fn(async () => createRoomState('instance-a'))
    server.battleService = {
      getDisconnectedPlayer: vi.fn(() => undefined),
    }
    server.getRedisDisconnectedPlayer = vi.fn(async () => null)
    server.resumeBattle = vi.fn(async () => {})

    const socket = {
      data: {
        playerId: 'player-1',
        sessionId: 's1',
      },
    }

    const result = await server.handlePlayerReconnect(socket)

    expect(result).toEqual({ isReconnect: true, roomId: 'room-1' })
    expect(server.resumeBattle).toHaveBeenCalledWith(socket, 'room-1')
  })

  it('actively reconnects to active room on another instance', async () => {
    const server = Object.create(ClusterBattleServer.prototype) as any
    server.instanceId = 'instance-a'
    server.getPlayerRoomFromCluster = vi.fn(async () => createRoomState('instance-b'))
    server.battleService = {
      getDisconnectedPlayer: vi.fn(() => undefined),
    }
    server.getRedisDisconnectedPlayer = vi.fn(async () => null)
    server.resumeBattle = vi.fn(async () => {})

    const socket = {
      data: {
        playerId: 'player-1',
        sessionId: 's1',
      },
    }

    const result = await server.handlePlayerReconnect(socket)

    expect(result).toEqual({ isReconnect: true, roomId: 'room-1' })
    expect(server.resumeBattle).toHaveBeenCalledWith(socket, 'room-1')
  })

  it('does not reconnect spectators', async () => {
    const server = Object.create(ClusterBattleServer.prototype) as any
    server.getPlayerRoomFromCluster = vi.fn(async () => ({
      ...createRoomState('instance-a'),
      spectators: [{ playerId: 'player-1', sessionId: 's1' }],
    }))
    server.battleService = {
      getDisconnectedPlayer: vi.fn(() => undefined),
    }
    server.resumeBattle = vi.fn(async () => {})

    const socket = {
      data: {
        playerId: 'player-1',
        sessionId: 's1',
      },
    }

    const result = await server.handlePlayerReconnect(socket)

    expect(result).toEqual({ isReconnect: false })
    expect(server.resumeBattle).not.toHaveBeenCalled()
  })
})
