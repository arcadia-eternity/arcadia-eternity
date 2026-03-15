import { describe, expect, it, vi } from 'vitest'
import type { RoomState } from '../src/cluster/types'
import { ClusterBattleServer } from '../src/domain/battle/services/clusterBattleServer'

type ConnectionStatus = 'connected' | 'disconnected' | undefined

function createActiveRoom(instanceId = 'instance-a'): RoomState {
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

function createServer(roomState: RoomState, sessionConnections: Record<string, ConnectionStatus>) {
  const server = Object.create(ClusterBattleServer.prototype) as any
  server.instanceId = 'instance-a'
  server.privateRoomService = undefined
  server.performanceTracker = undefined
  server.debouncedBroadcastServerState = vi.fn()
  server.removePlayer = vi.fn()
  server.getPlayerRoomFromCluster = vi.fn(async () => roomState)
  server.updateDisconnectedPlayerState = vi.fn(async () => {})
  server.startDisconnectGracePeriod = vi.fn(async () => {})
  server.handlePrivateRoomDisconnect = vi.fn(async () => {})
  server.hasOtherActiveConnections = vi.fn(async () => false)
  server.notifyInstanceBattleTermination = vi.fn(async () => {})
  server.battleService = {
    removeSpectatorFromRoom: vi.fn(async () => {}),
    removeDisconnectedPlayer: vi.fn(async () => {}),
    forceTerminateBattle: vi.fn(async () => {}),
  }
  server.stateManager = {
    getPlayerConnectionBySession: vi.fn(async (_playerId: string, sessionId: string) => {
      const status = sessionConnections[sessionId]
      if (!status) {
        return null
      }
      return {
        instanceId: 'instance-a',
        socketId: `socket:${sessionId}`,
        lastSeen: Date.now(),
        status,
        sessionId,
      }
    }),
    removePlayerConnection: vi.fn(async () => {}),
    removeFromMatchmakingQueue: vi.fn(async () => {}),
    getMatchmakingQueueSize: vi.fn(async () => 0),
  }
  return server
}

describe('ClusterBattleServer dual-disconnect healing', () => {
  it('terminates battle immediately when both battle players are disconnected', async () => {
    const roomState = createActiveRoom('instance-a')
    const server = createServer(roomState, {
      s1: 'disconnected',
      s2: 'disconnected',
    })
    const socket = {
      id: 'socket:s1',
      data: {
        playerId: 'player-1',
        sessionId: 's1',
      },
    }

    await server.handlePlayerDisconnect(socket)

    expect(server.startDisconnectGracePeriod).not.toHaveBeenCalled()
    expect(server.battleService.removeDisconnectedPlayer).toHaveBeenCalledWith('player-1:s1')
    expect(server.battleService.removeDisconnectedPlayer).toHaveBeenCalledWith('player-2:s2')
    expect(server.battleService.forceTerminateBattle).toHaveBeenCalledWith(roomState, 'player-1', 'disconnect')
  })

  it('keeps grace period flow when at least one battle player is still connected', async () => {
    const roomState = createActiveRoom('instance-a')
    const server = createServer(roomState, {
      s1: 'disconnected',
      s2: 'connected',
    })
    const socket = {
      id: 'socket:s1',
      data: {
        playerId: 'player-1',
        sessionId: 's1',
      },
    }

    await server.handlePlayerDisconnect(socket)

    expect(server.battleService.forceTerminateBattle).not.toHaveBeenCalled()
    expect(server.startDisconnectGracePeriod).toHaveBeenCalledWith('player-1', 's1', 'room-1')
  })

  it('routes immediate termination to owner instance for cross-instance rooms', async () => {
    const roomState = createActiveRoom('instance-b')
    const server = createServer(roomState, {
      s1: 'disconnected',
      s2: 'disconnected',
    })
    const socket = {
      id: 'socket:s1',
      data: {
        playerId: 'player-1',
        sessionId: 's1',
      },
    }

    await server.handlePlayerDisconnect(socket)

    expect(server.battleService.forceTerminateBattle).not.toHaveBeenCalled()
    expect(server.notifyInstanceBattleTermination).toHaveBeenCalledWith('instance-b', 'room-1', 'player-1', 'disconnect')
  })
})
