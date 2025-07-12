import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ClusterBattleServer } from '../src/cluster/clusterBattleServer'
import { ClusterStateManager } from '../src/cluster/clusterStateManager'
import { RuleBasedQueueManager } from '../src/cluster/ruleBasedQueueManager'
import { MatchmakingEntry } from '../src/cluster/types'

describe('Rule-based Matchmaking', () => {
  let ruleBasedQueueManager: RuleBasedQueueManager
  let mockRedisManager: any

  beforeEach(() => {
    // Mock Redis client
    const mockRedisClient = {
      sadd: vi.fn().mockResolvedValue(1),
      srem: vi.fn().mockResolvedValue(1),
      smembers: vi.fn().mockResolvedValue([]),
      scard: vi.fn().mockResolvedValue(0),
      hset: vi.fn().mockResolvedValue(1),
      hgetall: vi.fn().mockResolvedValue({}),
      del: vi.fn().mockResolvedValue(1),
      keys: vi.fn().mockResolvedValue([]),
      pexpire: vi.fn().mockResolvedValue(1),
      pipeline: vi.fn().mockReturnValue({
        sadd: vi.fn().mockReturnThis(),
        hset: vi.fn().mockReturnThis(),
        pexpire: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([]),
      }),
    }

    mockRedisManager = {
      getClient: vi.fn().mockReturnValue(mockRedisClient),
    }

    ruleBasedQueueManager = new RuleBasedQueueManager(mockRedisManager)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Queue Separation', () => {
    it('should separate players by rule set', async () => {
      const standardEntry: MatchmakingEntry = {
        playerId: 'player1',
        joinTime: Date.now(),
        playerData: { name: 'Player 1', team: [] },
        sessionId: 'session1',
        ruleSetId: 'standard',
      }

      const competitiveEntry: MatchmakingEntry = {
        playerId: 'player2',
        joinTime: Date.now(),
        playerData: { name: 'Player 2', team: [] },
        sessionId: 'session2',
        ruleSetId: 'competitive',
      }

      // Add players to different rule-based queues
      await ruleBasedQueueManager.addToRuleBasedQueue(standardEntry)
      await ruleBasedQueueManager.addToRuleBasedQueue(competitiveEntry)

      // Verify that the correct queue keys are used
      const mockClient = mockRedisManager.getClient()
      const pipeline = mockClient.pipeline()

      expect(pipeline.sadd).toHaveBeenCalledWith(
        'matchmaking:queue:standard',
        'player1:session1'
      )
      expect(pipeline.sadd).toHaveBeenCalledWith(
        'matchmaking:queue:competitive',
        'player2:session2'
      )
    })

    it('should get active rule set IDs correctly', async () => {
      const mockClient = mockRedisManager.getClient()
      
      // Mock keys response to simulate active queues
      mockClient.keys.mockResolvedValue([
        'matchmaking:queue:standard',
        'matchmaking:queue:competitive',
        'matchmaking:queue:tournament',
      ])

      // Mock scard to simulate queue sizes
      mockClient.scard
        .mockResolvedValueOnce(2) // standard queue has 2 players
        .mockResolvedValueOnce(1) // competitive queue has 1 player
        .mockResolvedValueOnce(0) // tournament queue is empty

      const activeRuleSetIds = await ruleBasedQueueManager.getActiveRuleSetIds()

      expect(activeRuleSetIds).toEqual(['standard', 'competitive'])
      expect(activeRuleSetIds).not.toContain('tournament') // Empty queue should not be included
    })

    it('should handle default rule set correctly', async () => {
      const entryWithoutRuleSet: MatchmakingEntry = {
        playerId: 'player3',
        joinTime: Date.now(),
        playerData: { name: 'Player 3', team: [] },
        sessionId: 'session3',
        // No ruleSetId specified
      }

      await ruleBasedQueueManager.addToRuleBasedQueue(entryWithoutRuleSet)

      const mockClient = mockRedisManager.getClient()
      const pipeline = mockClient.pipeline()

      // Should default to 'standard' rule set
      expect(pipeline.sadd).toHaveBeenCalledWith(
        'matchmaking:queue:standard',
        'player3:session3'
      )
    })
  })

  describe('Queue Retrieval', () => {
    it('should retrieve queue for specific rule set', async () => {
      const mockClient = mockRedisManager.getClient()
      
      // Mock queue members
      mockClient.smembers.mockResolvedValue(['player1:session1', 'player2:session2'])
      
      // Mock player data retrieval
      const pipeline = mockClient.pipeline()
      pipeline.exec.mockResolvedValue([
        [null, { 
          playerId: 'player1',
          joinTime: '1000',
          playerData: JSON.stringify({ name: 'Player 1' }),
          sessionId: 'session1',
          ruleSetId: 'standard'
        }],
        [null, {
          playerId: 'player2', 
          joinTime: '2000',
          playerData: JSON.stringify({ name: 'Player 2' }),
          sessionId: 'session2',
          ruleSetId: 'standard'
        }]
      ])

      const queue = await ruleBasedQueueManager.getRuleBasedQueue('standard')

      expect(mockClient.smembers).toHaveBeenCalledWith('matchmaking:queue:standard')
      expect(queue).toHaveLength(2)
      expect(queue[0].playerId).toBe('player1')
      expect(queue[1].playerId).toBe('player2')
    })
  })
})
