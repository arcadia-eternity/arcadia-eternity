#!/usr/bin/env node

/**
 * RPC性能测试
 * 测试gRPC转发性能
 */

import { BattleRpcServer } from './battleRpcServer'
import { BattleRpcClient } from './battleRpcClient'
import pino from 'pino'

const logger = pino({
  level: 'info',
  formatters: {
    level: label => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
})

// 模拟的ClusterBattleServer
class MockClusterBattleServer {
  private requestCount = 0

  async handleLocalPlayerSelection(roomId: string, playerId: string, data: any): Promise<{ status: string }> {
    this.requestCount++
    return { status: 'ACTION_ACCEPTED' }
  }

  async handleLocalGetState(roomId: string, playerId: string): Promise<any> {
    this.requestCount++
    return {
      phase: 'selection',
      players: [playerId],
      currentTurn: playerId,
    }
  }

  async handleLocalGetSelection(roomId: string, playerId: string): Promise<any[]> {
    this.requestCount++
    return [
      { type: 'skill', id: 'attack', name: '攻击' },
      { type: 'skill', id: 'defend', name: '防御' },
    ]
  }

  async handleLocalReady(roomId: string, playerId: string): Promise<{ status: string }> {
    this.requestCount++
    return { status: 'READY' }
  }

  async handleLocalIsTimerEnabled(roomId: string, playerId: string): Promise<boolean> {
    this.requestCount++
    return true
  }

  getRequestCount(): number {
    return this.requestCount
  }

  resetRequestCount(): void {
    this.requestCount = 0
  }
}

async function measureLatency(fn: () => Promise<any>, iterations: number): Promise<{
  totalTime: number
  avgLatency: number
  minLatency: number
  maxLatency: number
  requestsPerSecond: number
}> {
  const latencies: number[] = []
  
  const startTime = Date.now()
  
  for (let i = 0; i < iterations; i++) {
    const requestStart = Date.now()
    await fn()
    const requestEnd = Date.now()
    latencies.push(requestEnd - requestStart)
  }
  
  const endTime = Date.now()
  const totalTime = endTime - startTime
  
  return {
    totalTime,
    avgLatency: latencies.reduce((a, b) => a + b, 0) / latencies.length,
    minLatency: Math.min(...latencies),
    maxLatency: Math.max(...latencies),
    requestsPerSecond: Math.round(iterations / (totalTime / 1000))
  }
}

async function rpcPerformanceTest() {
  const NUM_REQUESTS = 1000
  const CONCURRENT_REQUESTS = 50
  const rpcPort = 50003
  const rpcAddress = `localhost:${rpcPort}`

  logger.info({ 
    numRequests: NUM_REQUESTS, 
    concurrentRequests: CONCURRENT_REQUESTS 
  }, 'Starting RPC performance test...')

  // 设置RPC测试
  const mockBattleServer = new MockClusterBattleServer()
  const rpcServer = new BattleRpcServer(mockBattleServer as any, rpcPort)
  await rpcServer.start()
  
  const rpcClient = new BattleRpcClient()

  // 等待服务器完全启动
  await new Promise(resolve => setTimeout(resolve, 500))

  try {
    // 测试1: 顺序请求延迟
    logger.info('Testing sequential request latency...')
    mockBattleServer.resetRequestCount()
    
    const sequentialResults = await measureLatency(async () => {
      return rpcClient.submitPlayerSelection(
        'instance-1',
        rpcAddress,
        'room-123',
        'player-1',
        { type: 'skill', id: 'attack' }
      )
    }, 100)

    logger.info({
      test: 'Sequential Requests',
      ...sequentialResults
    }, 'Sequential request results')

    // 测试2: 并发请求吞吐量
    logger.info('Testing concurrent request throughput...')
    mockBattleServer.resetRequestCount()
    
    const concurrentStartTime = Date.now()
    const concurrentPromises = []
    
    for (let i = 0; i < NUM_REQUESTS; i++) {
      concurrentPromises.push(
        rpcClient.submitPlayerSelection(
          'instance-1',
          rpcAddress,
          'room-123',
          'player-1',
          { type: 'skill', id: 'attack', index: i }
        )
      )
      
      // 限制并发数
      if (concurrentPromises.length >= CONCURRENT_REQUESTS) {
        await Promise.all(concurrentPromises)
        concurrentPromises.length = 0
      }
    }
    
    // 处理剩余的请求
    if (concurrentPromises.length > 0) {
      await Promise.all(concurrentPromises)
    }
    
    const concurrentEndTime = Date.now()
    const concurrentDuration = concurrentEndTime - concurrentStartTime
    
    logger.info({
      test: 'Concurrent Requests',
      totalTime: concurrentDuration,
      avgLatency: concurrentDuration / NUM_REQUESTS,
      requestsPerSecond: Math.round(NUM_REQUESTS / (concurrentDuration / 1000)),
      processedRequests: mockBattleServer.getRequestCount()
    }, 'Concurrent request results')

    // 测试3: 不同类型的RPC调用
    logger.info('Testing different RPC call types...')
    
    const callTypes = [
      {
        name: 'submitPlayerSelection',
        fn: () => rpcClient.submitPlayerSelection('instance-1', rpcAddress, 'room-123', 'player-1', { type: 'skill', id: 'attack' })
      },
      {
        name: 'getBattleState',
        fn: () => rpcClient.getBattleState('instance-1', rpcAddress, 'room-123', 'player-1')
      },
      {
        name: 'getAvailableSelection',
        fn: () => rpcClient.getAvailableSelection('instance-1', rpcAddress, 'room-123', 'player-1')
      },
      {
        name: 'playerReady',
        fn: () => rpcClient.playerReady('instance-1', rpcAddress, 'room-123', 'player-1')
      },
      {
        name: 'isTimerEnabled',
        fn: () => rpcClient.isTimerEnabled('instance-1', rpcAddress, 'room-123', 'player-1')
      }
    ]

    for (const callType of callTypes) {
      const results = await measureLatency(callType.fn, 50)
      logger.info({
        callType: callType.name,
        ...results
      }, 'Call type performance')
    }

    // 测试4: 连接复用效果
    logger.info('Testing connection reuse...')
    
    // 第一次调用（建立连接）
    const firstCallStart = Date.now()
    await rpcClient.submitPlayerSelection('instance-1', rpcAddress, 'room-123', 'player-1', { type: 'skill', id: 'attack' })
    const firstCallTime = Date.now() - firstCallStart
    
    // 后续调用（复用连接）
    const reuseResults = await measureLatency(async () => {
      return rpcClient.submitPlayerSelection('instance-1', rpcAddress, 'room-123', 'player-1', { type: 'skill', id: 'attack' })
    }, 10)

    logger.info({
      firstCallLatency: firstCallTime,
      reuseAvgLatency: reuseResults.avgLatency,
      connectionOverhead: firstCallTime - reuseResults.avgLatency
    }, 'Connection reuse analysis')

    logger.info('🎉 RPC performance test completed successfully!')

  } catch (error) {
    logger.error({ error }, 'RPC performance test failed')
  } finally {
    // 清理资源
    rpcClient.closeAllClients()
    await rpcServer.stop()
    logger.info('RPC performance test cleanup completed')
  }
}

// 运行测试
if (import.meta.url === `file://${process.argv[1]}`) {
  rpcPerformanceTest().catch(error => {
    logger.error({ error }, 'Test failed')
    process.exit(1)
  })
}

export { rpcPerformanceTest }
