import { describe, it, expect, vi } from 'vitest'
import { ClusterMatchmakingService } from '../src/domain/matching/services/clusterMatchmakingService'

describe('ClusterMatchmakingService idempotent join', () => {
  it('returns SUCCESS/QUEUED when the same session is already in matchmaking queue', async () => {
    const stateManager = {
      addToMatchmakingQueue: vi.fn(async () => {}),
      getMatchmakingQueueSize: vi.fn(async () => 0),
      redisManager: {
        getClient: () => ({
          set: vi.fn(async () => 'OK'),
          del: vi.fn(async () => 1),
          get: vi.fn(async () => null),
          smembers: vi.fn(async () => []),
        }),
        getSubscriber: () => ({
          on: vi.fn(),
          subscribe: vi.fn(async () => 1),
          unsubscribe: vi.fn(async () => 1),
        }),
      },
    }

    const service = new ClusterMatchmakingService(
      stateManager as any,
      { joinPlayerToRoom: vi.fn(async () => true) } as any,
      { withLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => await fn()) } as any,
      {
        createClusterBattleRoom: vi.fn(async () => 'room-1'),
        sendToPlayerSession: vi.fn(async () => true),
        getPlayerName: vi.fn(async () => 'Player'),
        broadcastServerStateUpdate: vi.fn(),
      } as any,
      {
        isReady: vi.fn(() => true),
        getProgress: vi.fn(() => ({ status: 'completed' })),
      } as any,
      'instance-a',
      {
        canEnterMatchmaking: vi.fn(async () => ({ allowed: false, reason: '已在匹配队列中' })),
        setSessionState: vi.fn(async () => {}),
        clearSessionState: vi.fn(async () => {}),
        batchUpdateSessionStates: vi.fn(async () => {}),
      } as any,
      undefined,
      undefined,
    )
    service.setPeriodicMatchingConfig({ enabled: false })

    const ack = vi.fn()
    await service.handleJoinMatchmaking(
      {
        id: 'socket-1',
        data: {
          playerId: 'player-1',
          sessionId: 'session-1',
        },
      } as any,
      { playerSchema: { id: 'player-1' }, ruleSetId: 'casual_standard_ruleset' },
      ack,
    )

    expect(ack).toHaveBeenCalledWith({
      status: 'SUCCESS',
      data: {
        status: 'QUEUED',
      },
    })
    expect(stateManager.addToMatchmakingQueue).not.toHaveBeenCalled()

    ;(service as any).stopPeriodicMatching?.()
  })
})

