#!/usr/bin/env tsx

/**
 * Fly.io gRPC 集群通信测试脚本
 * 测试集群实例间的 gRPC 服务发现和通信
 */

import { BattleRpcClient } from '../packages/server/src/cluster/battleRpcClient'
import { FlyIoServiceDiscoveryManager } from '../packages/server/src/cluster/flyIoServiceDiscovery'
import { RedisClientManager } from '../packages/server/src/cluster/redisClient'
import { ClusterStateManager } from '../packages/server/src/cluster/clusterStateManager'
import { DistributedLockManager } from '../packages/server/src/cluster/distributedLock'
import { WeightedLoadStrategy } from '../packages/server/src/cluster/serviceDiscovery'
import pino from 'pino'

const logger = pino({
  level: 'info',
  formatters: {
    level: label => ({ level: label }),
  },
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
})

// 配置
const config = {
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    db: parseInt(process.env.REDIS_DB || '0'),
    keyPrefix: process.env.REDIS_KEY_PREFIX || 'arcadia:',
    tls: process.env.REDIS_TLS === 'true',
  },
  flyApp: process.env.FLY_APP_NAME || 'test-battle',
  flyRegion: process.env.FLY_REGION || 'hkg',
}

/**
 * 测试 Fly.io 环境中的 gRPC 服务发现
 */
async function testFlyIoServiceDiscovery() {
  logger.info('开始测试 Fly.io gRPC 服务发现...')

  let redisManager
  let stateManager
  let serviceDiscovery
  let rpcClient

  try {
    // 初始化 Redis 连接
    redisManager = new RedisClientManager(config.redis)
    await redisManager.initialize()
    logger.info('Redis 连接初始化完成')

    // 初始化分布式锁管理器
    const lockManager = new DistributedLockManager(redisManager)

    // 初始化集群状态管理器
    const clusterConfig = {
      redis: config.redis,
      instance: {
        id: 'test-client',
        host: 'localhost',
        port: 8102,
        grpcPort: 50051,
        region: config.flyRegion,
        isFlyIo: Boolean(config.flyApp),
      },
      cluster: {
        enabled: true,
        heartbeatInterval: 30000,
        healthCheckInterval: 60000,
        failoverTimeout: 120000,
      },
    }

    stateManager = new ClusterStateManager(redisManager, lockManager, clusterConfig)
    await stateManager.initialize()
    logger.info('集群状态管理器初始化完成')

    // 初始化 Fly.io 服务发现管理器
    serviceDiscovery = new FlyIoServiceDiscoveryManager(
      redisManager,
      stateManager,
      new WeightedLoadStrategy(),
      config.flyApp,
      config.flyRegion,
    )
    await serviceDiscovery.initialize()
    logger.info('Fly.io 服务发现管理器初始化完成')

    // 初始化 RPC 客户端
    rpcClient = new BattleRpcClient(serviceDiscovery)
    logger.info('RPC 客户端初始化完成')

    // 测试服务发现功能
    await testServiceDiscoveryFeatures(serviceDiscovery)

    // 测试 gRPC 通信
    await testGrpcCommunication(rpcClient, serviceDiscovery)

    logger.info('所有测试完成')
  } catch (error) {
    logger.error({ error }, '测试过程中发生错误')
    throw error
  } finally {
    // 清理资源
    if (rpcClient) {
      rpcClient.closeAllClients()
    }
    if (stateManager) {
      await stateManager.cleanup()
    }
    if (redisManager) {
      await redisManager.cleanup()
    }
  }
}

/**
 * 测试服务发现功能
 */
async function testServiceDiscoveryFeatures(serviceDiscovery: FlyIoServiceDiscoveryManager) {
  logger.info('测试服务发现功能...')

  try {
    // 获取 Fly.io 信息
    const flyInfo = serviceDiscovery.getFlyIoInfo()
    logger.info({ flyInfo }, 'Fly.io 环境信息')

    // 获取集群拓扑
    const topology = await serviceDiscovery.getClusterTopology()
    logger.info({ topology }, '集群拓扑信息')

    // 获取 gRPC 拓扑
    const grpcTopology = await serviceDiscovery.getGrpcTopology()
    logger.info({ grpcTopology }, 'gRPC 拓扑信息')

    // 获取所有 gRPC 地址
    const grpcAddresses = await serviceDiscovery.getAllGrpcAddresses()
    logger.info({ grpcAddresses }, '所有 gRPC 地址')

    // 获取最佳 gRPC 实例
    const optimalInstance = await serviceDiscovery.getOptimalGrpcInstance()
    if (optimalInstance) {
      logger.info({ optimalInstance }, '最佳 gRPC 实例')
    } else {
      logger.warn('未找到可用的 gRPC 实例')
    }

    logger.info('服务发现功能测试完成')
  } catch (error) {
    logger.error({ error }, '服务发现功能测试失败')
    throw error
  }
}

/**
 * 测试 gRPC 通信
 */
async function testGrpcCommunication(rpcClient: BattleRpcClient, serviceDiscovery: FlyIoServiceDiscoveryManager) {
  logger.info('测试 gRPC 通信...')

  try {
    // 获取最佳客户端
    const client = await rpcClient.getOptimalClient()
    if (!client) {
      logger.warn('无法获取 gRPC 客户端，跳过通信测试')
      return
    }

    logger.info('成功获取 gRPC 客户端')

    // 测试各种 gRPC 方法
    const testRoomId = 'test-room-' + Date.now()
    const testPlayerId = 'test-player-' + Date.now()

    // 注意：这些测试可能会失败，因为目标实例可能没有对应的房间
    // 但我们主要是测试 gRPC 连接是否正常

    try {
      // 测试获取战斗状态
      logger.info('测试获取战斗状态...')
      const grpcAddresses = await serviceDiscovery.getAllGrpcAddresses()

      for (const { instanceId, address } of grpcAddresses) {
        try {
          logger.info({ instanceId, address }, '测试实例连接')

          // 这里我们只测试连接，不期望成功的业务响应
          const testClient = rpcClient.getClient(instanceId, address)
          logger.info({ instanceId }, 'gRPC 客户端创建成功')
        } catch (error) {
          logger.warn({ error, instanceId, address }, '实例连接测试失败')
        }
      }
    } catch (error) {
      logger.warn({ error }, 'gRPC 方法测试失败（这是预期的，因为没有真实的战斗房间）')
    }

    // 测试获取所有可用客户端
    const allClients = await rpcClient.getAllAvailableClients()
    logger.info({ clientCount: allClients.length }, '获取到的所有可用客户端')

    logger.info('gRPC 通信测试完成')
  } catch (error) {
    logger.error({ error }, 'gRPC 通信测试失败')
    throw error
  }
}

/**
 * 显示帮助信息
 */
function showHelp() {
  console.log('Fly.io gRPC 集群通信测试脚本')
  console.log('')
  console.log('用法: node test-flyio-grpc.js')
  console.log('')
  console.log('环境变量:')
  console.log('  REDIS_HOST        Redis 主机地址 (默认: localhost)')
  console.log('  REDIS_PORT        Redis 端口 (默认: 6379)')
  console.log('  REDIS_PASSWORD    Redis 密码')
  console.log('  REDIS_DB          Redis 数据库 (默认: 0)')
  console.log('  REDIS_KEY_PREFIX  Redis 键前缀 (默认: arcadia:)')
  console.log('  REDIS_TLS         是否使用 TLS (默认: false)')
  console.log('  FLY_APP_NAME      Fly.io 应用名称 (默认: test-battle)')
  console.log('  FLY_REGION        Fly.io 区域 (默认: hkg)')
  console.log('')
  console.log('示例:')
  console.log('  REDIS_HOST=redis.example.com REDIS_PASSWORD=secret node test-flyio-grpc.js')
}

// 主函数
async function main() {
  const args = process.argv.slice(2)

  if (args.includes('-h') || args.includes('--help')) {
    showHelp()
    process.exit(0)
  }

  try {
    await testFlyIoServiceDiscovery()
    logger.info('测试成功完成')
    process.exit(0)
  } catch (error) {
    logger.error({ error }, '测试失败')
    process.exit(1)
  }
}

// 处理未捕获的异常
process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled Rejection')
  process.exit(1)
})

process.on('uncaughtException', error => {
  logger.error({ error }, 'Uncaught Exception')
  process.exit(1)
})

// 运行主函数
main()
