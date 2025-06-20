#!/usr/bin/env node

/**
 * Arcadia Eternity 集群负载测试脚本
 * 用于测试集群在高并发情况下的性能和稳定性
 */

const { io } = require('socket.io-client')
const axios = require('axios')
const { performance } = require('perf_hooks')

// 配置
const CONFIG = {
  // 测试目标
  baseUrl: process.env.TEST_URL || 'http://localhost',
  
  // 负载参数
  concurrentUsers: parseInt(process.env.CONCURRENT_USERS || '100'),
  testDuration: parseInt(process.env.TEST_DURATION || '60'), // 秒
  rampUpTime: parseInt(process.env.RAMP_UP_TIME || '10'), // 秒
  
  // 操作权重
  operations: {
    connect: 0.3,      // 30% 连接操作
    matchmaking: 0.4,  // 40% 匹配操作
    battle: 0.2,       // 20% 战斗操作
    api: 0.1,          // 10% API调用
  },
}

// 统计数据
const stats = {
  connections: {
    total: 0,
    successful: 0,
    failed: 0,
    active: 0,
  },
  operations: {
    total: 0,
    successful: 0,
    failed: 0,
  },
  latency: {
    min: Infinity,
    max: 0,
    sum: 0,
    count: 0,
  },
  errors: [],
}

// 日志函数
const log = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} ${msg}`),
  warn: (msg) => console.log(`[WARN] ${new Date().toISOString()} ${msg}`),
  error: (msg) => console.log(`[ERROR] ${new Date().toISOString()} ${msg}`),
}

// 生成测试玩家数据
function generatePlayerData(id) {
  return {
    id: `test-player-${id}`,
    name: `TestPlayer${id}`,
    team: [
      {
        species: { id: 'species1', name: 'Test Species 1' },
        level: 50,
        skills: [
          { base: { id: 'skill1', name: 'Test Skill 1' } },
          { base: { id: 'skill2', name: 'Test Skill 2' } },
        ],
      },
    ],
  }
}

// 模拟用户行为
class VirtualUser {
  constructor(id) {
    this.id = id
    this.playerId = `test-player-${id}`
    this.socket = null
    this.isActive = false
    this.operations = 0
    this.errors = 0
  }

  async start() {
    try {
      await this.connect()
      this.isActive = true
      this.runOperations()
    } catch (error) {
      log.error(`User ${this.id} failed to start: ${error.message}`)
      stats.connections.failed++
      this.recordError(error)
    }
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const startTime = performance.now()
      
      this.socket = io(CONFIG.baseUrl, {
        query: { playerId: this.playerId },
        transports: ['websocket'],
        timeout: 10000,
      })

      this.socket.on('connect', () => {
        const latency = performance.now() - startTime
        this.recordLatency(latency)
        
        stats.connections.total++
        stats.connections.successful++
        stats.connections.active++
        
        log.info(`User ${this.id} connected (latency: ${latency.toFixed(2)}ms)`)
        resolve()
      })

      this.socket.on('connect_error', (error) => {
        stats.connections.total++
        stats.connections.failed++
        this.recordError(error)
        reject(error)
      })

      this.socket.on('disconnect', () => {
        stats.connections.active--
        log.info(`User ${this.id} disconnected`)
      })

      this.socket.on('error', (error) => {
        this.recordError(error)
      })

      // 设置超时
      setTimeout(() => {
        if (!this.socket.connected) {
          reject(new Error('Connection timeout'))
        }
      }, 10000)
    })
  }

  async runOperations() {
    while (this.isActive) {
      try {
        await this.performRandomOperation()
        await this.sleep(Math.random() * 2000 + 500) // 0.5-2.5秒间隔
      } catch (error) {
        this.recordError(error)
      }
    }
  }

  async performRandomOperation() {
    const rand = Math.random()
    const startTime = performance.now()

    try {
      if (rand < CONFIG.operations.matchmaking) {
        await this.joinMatchmaking()
      } else if (rand < CONFIG.operations.matchmaking + CONFIG.operations.battle) {
        await this.performBattleAction()
      } else if (rand < CONFIG.operations.matchmaking + CONFIG.operations.battle + CONFIG.operations.api) {
        await this.callApi()
      } else {
        await this.ping()
      }

      const latency = performance.now() - startTime
      this.recordLatency(latency)
      this.operations++
      stats.operations.total++
      stats.operations.successful++
    } catch (error) {
      stats.operations.total++
      stats.operations.failed++
      this.errors++
      throw error
    }
  }

  async joinMatchmaking() {
    return new Promise((resolve, reject) => {
      const playerData = generatePlayerData(this.id)
      
      this.socket.emit('joinMatchmaking', playerData, (response) => {
        if (response.status === 'SUCCESS') {
          resolve(response)
        } else {
          reject(new Error(`Matchmaking failed: ${response.details || 'Unknown error'}`))
        }
      })

      // 超时处理
      setTimeout(() => reject(new Error('Matchmaking timeout')), 5000)
    })
  }

  async performBattleAction() {
    return new Promise((resolve, reject) => {
      // 模拟战斗操作
      this.socket.emit('getState', (response) => {
        if (response.status === 'SUCCESS') {
          resolve(response)
        } else {
          reject(new Error(`Battle action failed: ${response.details || 'Unknown error'}`))
        }
      })

      setTimeout(() => reject(new Error('Battle action timeout')), 3000)
    })
  }

  async callApi() {
    const endpoints = ['/health', '/cluster/status', '/api-docs.json']
    const endpoint = endpoints[Math.floor(Math.random() * endpoints.length)]
    
    const response = await axios.get(`${CONFIG.baseUrl}${endpoint}`, {
      timeout: 5000,
    })
    
    if (response.status !== 200) {
      throw new Error(`API call failed: ${response.status}`)
    }
    
    return response.data
  }

  async ping() {
    return new Promise((resolve) => {
      this.socket.emit('ping')
      resolve()
    })
  }

  recordLatency(latency) {
    stats.latency.min = Math.min(stats.latency.min, latency)
    stats.latency.max = Math.max(stats.latency.max, latency)
    stats.latency.sum += latency
    stats.latency.count++
  }

  recordError(error) {
    this.errors++
    stats.errors.push({
      userId: this.id,
      error: error.message,
      timestamp: Date.now(),
    })
  }

  async stop() {
    this.isActive = false
    if (this.socket) {
      this.socket.disconnect()
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// 测试管理器
class LoadTestManager {
  constructor() {
    this.users = []
    this.isRunning = false
    this.startTime = null
  }

  async start() {
    log.info(`Starting load test with ${CONFIG.concurrentUsers} users`)
    log.info(`Test duration: ${CONFIG.testDuration}s, Ramp-up: ${CONFIG.rampUpTime}s`)
    log.info(`Target: ${CONFIG.baseUrl}`)

    this.isRunning = true
    this.startTime = Date.now()

    // 启动统计报告
    this.startStatsReporting()

    // 逐步增加用户负载
    await this.rampUpUsers()

    // 等待测试完成
    await this.sleep(CONFIG.testDuration * 1000)

    // 停止测试
    await this.stop()
  }

  async rampUpUsers() {
    const userInterval = (CONFIG.rampUpTime * 1000) / CONFIG.concurrentUsers
    
    for (let i = 0; i < CONFIG.concurrentUsers; i++) {
      if (!this.isRunning) break

      const user = new VirtualUser(i + 1)
      this.users.push(user)
      
      // 启动用户（不等待）
      user.start().catch(error => {
        log.error(`Failed to start user ${i + 1}: ${error.message}`)
      })

      // 等待间隔
      if (i < CONFIG.concurrentUsers - 1) {
        await this.sleep(userInterval)
      }
    }

    log.info(`All ${CONFIG.concurrentUsers} users started`)
  }

  startStatsReporting() {
    const reportInterval = setInterval(() => {
      if (!this.isRunning) {
        clearInterval(reportInterval)
        return
      }

      this.printStats()
    }, 10000) // 每10秒报告一次
  }

  printStats() {
    const runtime = (Date.now() - this.startTime) / 1000
    const avgLatency = stats.latency.count > 0 ? stats.latency.sum / stats.latency.count : 0
    const successRate = stats.operations.total > 0 ? (stats.operations.successful / stats.operations.total * 100) : 0
    const opsPerSecond = stats.operations.total / runtime

    console.log('\n=== Load Test Statistics ===')
    console.log(`Runtime: ${runtime.toFixed(1)}s`)
    console.log(`Active Users: ${stats.connections.active}`)
    console.log(`Connections: ${stats.connections.successful}/${stats.connections.total} (${((stats.connections.successful / stats.connections.total) * 100).toFixed(1)}%)`)
    console.log(`Operations: ${stats.operations.successful}/${stats.operations.total} (${successRate.toFixed(1)}%)`)
    console.log(`Ops/sec: ${opsPerSecond.toFixed(1)}`)
    console.log(`Latency: min=${stats.latency.min.toFixed(1)}ms, max=${stats.latency.max.toFixed(1)}ms, avg=${avgLatency.toFixed(1)}ms`)
    console.log(`Errors: ${stats.errors.length}`)
    
    if (stats.errors.length > 0) {
      const recentErrors = stats.errors.slice(-5)
      console.log('Recent errors:')
      recentErrors.forEach(error => {
        console.log(`  - User ${error.userId}: ${error.error}`)
      })
    }
    console.log('============================\n')
  }

  async stop() {
    log.info('Stopping load test...')
    this.isRunning = false

    // 停止所有用户
    const stopPromises = this.users.map(user => user.stop())
    await Promise.all(stopPromises)

    // 打印最终统计
    this.printFinalStats()
  }

  printFinalStats() {
    const runtime = (Date.now() - this.startTime) / 1000
    const avgLatency = stats.latency.count > 0 ? stats.latency.sum / stats.latency.count : 0
    const successRate = stats.operations.total > 0 ? (stats.operations.successful / stats.operations.total * 100) : 0
    const opsPerSecond = stats.operations.total / runtime

    console.log('\n=== Final Load Test Results ===')
    console.log(`Total Runtime: ${runtime.toFixed(1)}s`)
    console.log(`Target Users: ${CONFIG.concurrentUsers}`)
    console.log(`Successful Connections: ${stats.connections.successful}/${stats.connections.total}`)
    console.log(`Total Operations: ${stats.operations.total}`)
    console.log(`Successful Operations: ${stats.operations.successful} (${successRate.toFixed(1)}%)`)
    console.log(`Failed Operations: ${stats.operations.failed}`)
    console.log(`Operations per Second: ${opsPerSecond.toFixed(1)}`)
    console.log(`Latency Statistics:`)
    console.log(`  - Min: ${stats.latency.min.toFixed(1)}ms`)
    console.log(`  - Max: ${stats.latency.max.toFixed(1)}ms`)
    console.log(`  - Average: ${avgLatency.toFixed(1)}ms`)
    console.log(`Total Errors: ${stats.errors.length}`)
    
    // 错误分析
    if (stats.errors.length > 0) {
      const errorTypes = {}
      stats.errors.forEach(error => {
        errorTypes[error.error] = (errorTypes[error.error] || 0) + 1
      })
      
      console.log('Error Breakdown:')
      Object.entries(errorTypes).forEach(([error, count]) => {
        console.log(`  - ${error}: ${count}`)
      })
    }
    
    console.log('===============================\n')

    // 判断测试结果
    if (successRate >= 95 && avgLatency < 1000) {
      log.info('✅ Load test PASSED - System performed well under load')
    } else if (successRate >= 90) {
      log.warn('⚠️  Load test MARGINAL - System showed some stress but remained functional')
    } else {
      log.error('❌ Load test FAILED - System did not handle the load well')
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

// 主函数
async function main() {
  // 处理命令行参数
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
Arcadia Eternity Cluster Load Test

Usage: node load-test-cluster.js [options]

Environment Variables:
  TEST_URL           Target URL (default: http://localhost)
  CONCURRENT_USERS   Number of concurrent users (default: 100)
  TEST_DURATION      Test duration in seconds (default: 60)
  RAMP_UP_TIME       Ramp-up time in seconds (default: 10)

Examples:
  TEST_URL=http://localhost:8102 CONCURRENT_USERS=50 node load-test-cluster.js
  TEST_URL=https://your-app.fly.dev CONCURRENT_USERS=200 TEST_DURATION=120 node load-test-cluster.js
`)
    process.exit(0)
  }

  const testManager = new LoadTestManager()

  // 处理中断信号
  process.on('SIGINT', async () => {
    log.info('Received SIGINT, stopping test...')
    await testManager.stop()
    process.exit(0)
  })

  process.on('SIGTERM', async () => {
    log.info('Received SIGTERM, stopping test...')
    await testManager.stop()
    process.exit(0)
  })

  try {
    await testManager.start()
  } catch (error) {
    log.error(`Load test failed: ${error.message}`)
    process.exit(1)
  }
}

// 运行测试
if (require.main === module) {
  main()
}

module.exports = { LoadTestManager, VirtualUser }
