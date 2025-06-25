import { TTLHelper, getTTLConfig } from '../ttlConfig'

describe('TTL Configuration', () => {
  beforeEach(() => {
    // 重置环境变量
    delete process.env.SERVICE_INSTANCE_HEARTBEAT_TTL
    delete process.env.PLAYER_SESSION_CONNECTION_TTL
    delete process.env.SESSION_DATA_TTL
    delete process.env.WAITING_ROOM_TTL
    delete process.env.ACTIVE_ROOM_TTL
    delete process.env.ENDED_ROOM_TTL
    delete process.env.MATCHMAKING_QUEUE_ENTRY_TTL
    delete process.env.AUTH_BLACKLIST_TTL
    delete process.env.DEFAULT_LOCK_TTL
    delete process.env.ACTIVE_BATTLE_TTL
    delete process.env.COMPLETED_BATTLE_TTL
    
    // 刷新配置
    TTLHelper.refreshConfig()
  })

  describe('getTTLConfig', () => {
    it('should return default TTL values', () => {
      const config = getTTLConfig()
      
      expect(config.serviceInstance.heartbeatTTL).toBeGreaterThan(0)
      expect(config.serviceInstance.instanceDataTTL).toBeGreaterThan(0)
      expect(config.playerConnection.sessionConnectionTTL).toBeGreaterThan(0)
      expect(config.session.sessionDataTTL).toBeGreaterThan(0)
      expect(config.room.waitingRoomTTL).toBeGreaterThan(0)
      expect(config.room.activeRoomTTL).toBeGreaterThan(0)
      expect(config.room.endedRoomTTL).toBeGreaterThan(0)
      expect(config.matchmaking.queueEntryTTL).toBeGreaterThan(0)
      expect(config.auth.blacklistTTL).toBeGreaterThan(0)
      expect(config.lock.defaultLockTTL).toBeGreaterThan(0)
      expect(config.battleReport.activeBattleTTL).toBeGreaterThan(0)
      expect(config.battleReport.completedBattleTTL).toBeGreaterThan(0)
    })

    it('should use environment variables when provided', () => {
      process.env.SERVICE_INSTANCE_HEARTBEAT_TTL = '600'  // 10分钟
      process.env.PLAYER_SESSION_CONNECTION_TTL = '1800'  // 30分钟
      process.env.SESSION_DATA_TTL = '1440'  // 24小时
      
      const config = getTTLConfig()
      
      expect(config.serviceInstance.heartbeatTTL).toBe(600 * 60 * 1000)  // 10分钟
      expect(config.playerConnection.sessionConnectionTTL).toBe(1800 * 60 * 1000)  // 30分钟
      expect(config.session.sessionDataTTL).toBe(1440 * 60 * 60 * 1000)  // 24小时
    })

    it('should have different values for production and development', () => {
      const originalEnv = process.env.NODE_ENV
      
      // 测试生产环境
      process.env.NODE_ENV = 'production'
      const prodConfig = getTTLConfig()
      
      // 测试开发环境
      process.env.NODE_ENV = 'development'
      const devConfig = getTTLConfig()
      
      // 生产环境的 TTL 应该更长
      expect(prodConfig.serviceInstance.heartbeatTTL).toBeGreaterThan(devConfig.serviceInstance.heartbeatTTL)
      expect(prodConfig.serviceInstance.instanceDataTTL).toBeGreaterThan(devConfig.serviceInstance.instanceDataTTL)
      
      // 恢复原始环境
      process.env.NODE_ENV = originalEnv
    })
  })

  describe('TTLHelper', () => {
    it('should get TTL for different data types', () => {
      const serviceTTL = TTLHelper.getTTLForDataType('serviceInstance')
      const connectionTTL = TTLHelper.getTTLForDataType('playerConnection')
      const sessionTTL = TTLHelper.getTTLForDataType('session')
      const roomTTL = TTLHelper.getTTLForDataType('room')
      const matchmakingTTL = TTLHelper.getTTLForDataType('matchmaking')
      const authTTL = TTLHelper.getTTLForDataType('auth')
      const lockTTL = TTLHelper.getTTLForDataType('lock')
      const battleTTL = TTLHelper.getTTLForDataType('battleReport')
      
      expect(serviceTTL).toBeGreaterThan(0)
      expect(connectionTTL).toBeGreaterThan(0)
      expect(sessionTTL).toBeGreaterThan(0)
      expect(roomTTL).toBeGreaterThan(0)
      expect(matchmakingTTL).toBeGreaterThan(0)
      expect(authTTL).toBeGreaterThan(0)
      expect(lockTTL).toBeGreaterThan(0)
      expect(battleTTL).toBeGreaterThan(0)
    })

    it('should get TTL for data subtypes', () => {
      const heartbeatTTL = TTLHelper.getTTLForDataType('serviceInstance', 'heartbeat')
      const dataTTL = TTLHelper.getTTLForDataType('serviceInstance', 'data')
      
      expect(heartbeatTTL).toBeGreaterThan(0)
      expect(dataTTL).toBeGreaterThan(0)
      expect(dataTTL).toBeGreaterThan(heartbeatTTL)  // 数据 TTL 应该比心跳 TTL 长
    })

    it('should get dynamic TTL based on status', () => {
      const waitingRoomTTL = TTLHelper.getDynamicTTL('room', 'waiting')
      const activeRoomTTL = TTLHelper.getDynamicTTL('room', 'active')
      const endedRoomTTL = TTLHelper.getDynamicTTL('room', 'ended')
      
      expect(waitingRoomTTL).toBeGreaterThan(0)
      expect(activeRoomTTL).toBeGreaterThan(0)
      expect(endedRoomTTL).toBeGreaterThan(0)
      
      // 活跃房间的 TTL 应该最长
      expect(activeRoomTTL).toBeGreaterThan(waitingRoomTTL)
      expect(activeRoomTTL).toBeGreaterThan(endedRoomTTL)
    })

    it('should calculate dynamic TTL for active rooms based on runtime', () => {
      const now = Date.now()
      const oneHourAgo = now - 60 * 60 * 1000  // 1小时前
      
      const freshRoomTTL = TTLHelper.getDynamicTTL('room', 'active', now)
      const oldRoomTTL = TTLHelper.getDynamicTTL('room', 'active', oneHourAgo)
      
      expect(freshRoomTTL).toBeGreaterThan(oldRoomTTL)  // 新房间应该有更长的 TTL
      expect(oldRoomTTL).toBeGreaterThanOrEqual(30 * 60 * 1000)  // 最少30分钟
    })

    it('should handle unknown data types gracefully', () => {
      const unknownTTL = TTLHelper.getTTLForDataType('unknown')
      expect(unknownTTL).toBeGreaterThan(0)  // 应该返回默认值
    })
  })

  describe('TTL Helper Methods', () => {
    let mockClient: any

    beforeEach(() => {
      mockClient = {
        pexpire: jest.fn().mockResolvedValue('OK'),
        pipeline: jest.fn().mockReturnValue({
          pexpire: jest.fn(),
          exec: jest.fn().mockResolvedValue([])
        })
      }
    })

    it('should set key TTL', async () => {
      await TTLHelper.setKeyTTL(mockClient, 'test:key', 60000)
      
      expect(mockClient.pexpire).toHaveBeenCalledWith('test:key', 60000)
    })

    it('should not set TTL for zero or negative values', async () => {
      await TTLHelper.setKeyTTL(mockClient, 'test:key', 0)
      await TTLHelper.setKeyTTL(mockClient, 'test:key', -1000)
      
      expect(mockClient.pexpire).not.toHaveBeenCalled()
    })

    it('should set batch TTL', async () => {
      const keyTTLPairs = [
        { key: 'key1', ttl: 60000 },
        { key: 'key2', ttl: 120000 },
        { key: 'key3', ttl: 0 }  // 应该被跳过
      ]
      
      await TTLHelper.setBatchTTL(mockClient, keyTTLPairs)
      
      expect(mockClient.pipeline).toHaveBeenCalled()
      const pipeline = mockClient.pipeline()
      expect(pipeline.pexpire).toHaveBeenCalledTimes(2)  // 只有2个有效的 TTL
      expect(pipeline.exec).toHaveBeenCalled()
    })

    it('should handle empty batch TTL', async () => {
      await TTLHelper.setBatchTTL(mockClient, [])
      
      expect(mockClient.pipeline).not.toHaveBeenCalled()
    })
  })

  describe('Configuration Validation', () => {
    it('should have reasonable TTL values', () => {
      const config = getTTLConfig()
      
      // 服务实例 TTL 应该在合理范围内（5分钟到1小时）
      expect(config.serviceInstance.heartbeatTTL).toBeGreaterThanOrEqual(5 * 60 * 1000)
      expect(config.serviceInstance.heartbeatTTL).toBeLessThanOrEqual(60 * 60 * 1000)
      
      // 会话 TTL 应该至少1小时
      expect(config.session.sessionDataTTL).toBeGreaterThanOrEqual(60 * 60 * 1000)
      
      // 锁 TTL 应该在合理范围内（5秒到5分钟）
      expect(config.lock.defaultLockTTL).toBeGreaterThanOrEqual(5 * 1000)
      expect(config.lock.defaultLockTTL).toBeLessThanOrEqual(5 * 60 * 1000)
      
      // 房间 TTL 应该有合理的层次关系
      expect(config.room.activeRoomTTL).toBeGreaterThan(config.room.waitingRoomTTL)
      expect(config.room.activeRoomTTL).toBeGreaterThan(config.room.endedRoomTTL)
    })

    it('should have consistent index TTL values', () => {
      const config = getTTLConfig()
      
      // 索引 TTL 应该比数据 TTL 稍长，用于清理
      expect(config.session.sessionIndexTTL).toBeGreaterThan(config.session.sessionDataTTL)
      expect(config.playerConnection.activePlayerIndexTTL).toBeGreaterThan(config.playerConnection.sessionConnectionTTL)
      expect(config.matchmaking.queueIndexTTL).toBeGreaterThan(config.matchmaking.queueEntryTTL)
      expect(config.room.roomIndexTTL).toBeGreaterThan(config.room.activeRoomTTL)
    })
  })
})
