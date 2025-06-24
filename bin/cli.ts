import dotenv from 'dotenv'
import { program } from 'commander'
import path from 'path'
import fs from 'fs/promises'
import yaml from 'yaml'
import { loadGameData, LOADING_STRATEGIES } from '@arcadia-eternity/fsloader'
import { PlayerParser } from '@arcadia-eternity/parser'
import { ScriptLoader } from '@arcadia-eternity/data-repository'
import { AIPlayer, Battle } from '@arcadia-eternity/battle'
import { ConsoleUIV2, initI18n } from '@arcadia-eternity/console'
import type { Player } from '@arcadia-eternity/battle'
import { BattleClient, RemoteBattleSystem } from '@arcadia-eternity/client'
import { PlayerSchema } from '@arcadia-eternity/schema'
import {
  type BattleReportConfig,
  createEmailConfigFromCli,
  type EmailCliOptions,
  createClusterApp,
  createClusterConfigFromCli,
  type ClusterCliOptions,
} from '@arcadia-eternity/server'
import { validateAndPrintGameData } from '@arcadia-eternity/cli-validator'
import DevServer from '../devServer'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { LocalBattleSystem } from '@arcadia-eternity/local-adapter'
import type { playerId } from '@arcadia-eternity/const'

// 加载环境变量
dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// 解析玩家文件
async function parsePlayerFile(filePath: string, _options: { validateData?: boolean } = {}): Promise<Player> {
  try {
    console.log(`[🔍] 正在解析玩家文件: ${filePath}`)

    // 检查文件是否存在
    const resolvedPath = path.resolve(filePath)
    try {
      await fs.access(resolvedPath)
    } catch {
      throw new Error(`玩家文件不存在: ${resolvedPath}`)
    }

    // 读取文件内容
    const content = await fs.readFile(resolvedPath, 'utf-8')
    if (!content.trim()) {
      throw new Error(`玩家文件为空: ${resolvedPath}`)
    }

    // 解析YAML
    let rawData: unknown
    try {
      rawData = yaml.parse(content)
    } catch (yamlError) {
      throw new Error(`YAML格式错误: ${yamlError instanceof Error ? yamlError.message : yamlError}`)
    }

    // 基本数据验证
    if (!rawData || typeof rawData !== 'object') {
      throw new Error('玩家数据格式无效，应该是一个对象')
    }

    const data = rawData as Record<string, unknown>

    // 检查必要字段
    if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
      throw new Error('玩家名称缺失或无效')
    }

    if (!data.team || !Array.isArray(data.team) || data.team.length === 0) {
      throw new Error('玩家队伍数据缺失或无效')
    }

    // 验证队伍中的精灵数据
    for (let i = 0; i < data.team.length; i++) {
      const pet = data.team[i]
      if (!pet || typeof pet !== 'object') {
        throw new Error(`第 ${i + 1} 只精灵数据无效`)
      }

      const petData = pet as Record<string, unknown>
      if (!petData.name || typeof petData.name !== 'string') {
        throw new Error(`第 ${i + 1} 只精灵缺少有效名称`)
      }

      if (!petData.species || typeof petData.species !== 'string') {
        throw new Error(`第 ${i + 1} 只精灵 "${petData.name}" 缺少有效种族ID`)
      }

      // 检查种族ID格式
      if (!petData.species.startsWith('pet_')) {
        throw new Error(
          `第 ${i + 1} 只精灵 "${petData.name}" 的种族ID "${petData.species}" 格式不正确，应该以 "pet_" 开头`,
        )
      }
    }

    // 使用PlayerParser进行完整解析
    const player = PlayerParser.parse(rawData)

    console.log(`[✅] 成功解析玩家: ${player.name} (${player.team.length} 只精灵)`)
    return player
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    throw new Error(`无法解析玩家文件 ${filePath}: ${errorMessage}`)
  }
}

// 加载脚本声明
async function loadScripts(scriptPaths: string[] = ['./scripts']) {
  try {
    console.log('[🔄] 正在加载脚本声明...')
    const loader = new ScriptLoader({ scriptPaths, recursive: true })

    for (const scriptPath of scriptPaths) {
      await loader.loadScriptsFromFileSystem(scriptPath)
    }

    const stats = loader.getLoadedScriptsStats()
    console.log('[📊] 脚本加载统计:', stats)
    console.log('[✅] 脚本声明加载完成')
  } catch (error) {
    console.warn('[⚠️] 脚本加载失败，继续使用YAML数据:', error instanceof Error ? error.message : error)
  }
}

program
  .command('online')
  .description('启动在线对战')
  .requiredOption('-d, --data <path>', '玩家数据文件路径')
  .option('-s, --server <url>', '服务器地址', process.env.BATTLE_SERVER_URL || 'ws://localhost:8102')
  .option('--validate-data', '启用数据完整性验证', false)
  .action(async options => {
    try {
      console.log('[🌀] 正在加载游戏数据...')
      await loadGameData(undefined, LOADING_STRATEGIES.LENIENT)
      await loadScripts()

      // 数据完整性验证
      if (options.validateData) {
        console.log('[🔍] 正在验证游戏数据完整性...')
        const isValid = await validateAndPrintGameData({ verbose: true })
        if (!isValid) {
          console.error('[❌] 游戏数据验证失败，请修复数据问题后重试')
          process.exit(1)
        }
      }

      console.log('[🌀] 正在解析玩家数据...')
      const content = await fs.readFile(path.resolve(options.data), 'utf-8')
      const rawData = yaml.parse(content)
      const player = PlayerSchema.parse(rawData)

      const client = new BattleClient({
        serverUrl: options.server,
      })

      const remote = new RemoteBattleSystem(client)

      await initI18n()
      new ConsoleUIV2(remote, player.id as playerId)
      await client.connect()

      // 监听匹配成功事件，自动准备
      client.once('matchSuccess', async () => {
        console.log('🎯 匹配成功！正在准备战斗...')
        await remote.ready()
        console.log('✅ 已准备就绪，等待对手准备...')
      })

      console.log('等待匹配对手...')
      await client.joinMatchmaking(player)
    } catch (err) {
      console.error('[💥] 错误:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

// 主程序
program
  .command('local')
  .description('精灵对战命令行工具（支持AI对战）')
  .requiredOption('-1, --player1 <path>', '玩家1数据文件路径')
  .requiredOption('-2, --player2 <path>', '玩家2数据文件路径')
  .option('--ai <players>', '指定AI控制的玩家（支持多个，如：player1,player2）', val => val.split(','))
  .option('--debug', '启用调试模式', false)
  .option('--strict', '使用严格模式加载数据（检测缺失引用）', false)
  .option('--load-scripts', '加载脚本定义', false)
  .option('--validate-data', '启用数据完整性验证', false)
  .action(async options => {
    try {
      console.log('[🌀] 正在加载游戏数据...')

      // 根据选项选择加载策略
      let strategy = LOADING_STRATEGIES.LENIENT
      if (options.strict && options.loadScripts) {
        strategy = LOADING_STRATEGIES.FULL
      } else if (options.strict) {
        strategy = LOADING_STRATEGIES.STRICT
      } else if (options.loadScripts) {
        strategy = LOADING_STRATEGIES.DEVELOPMENT
      }

      console.log(
        `[📋] 使用加载策略: ${options.strict ? '严格' : '宽松'}模式${options.loadScripts ? ' + 脚本加载' : ''}`,
      )
      await loadGameData(undefined, strategy)

      // 如果没有通过策略加载脚本，则单独加载
      if (!options.loadScripts) {
        await loadScripts()
      }

      // 数据完整性验证
      if (options.validateData || options.strict) {
        console.log('[🔍] 正在验证游戏数据完整性...')
        const isValid = await validateAndPrintGameData({
          verbose: true,
          validateCrossReferences: options.strict,
        })
        if (!isValid) {
          console.error('[❌] 游戏数据验证失败，请修复数据问题后重试')
          process.exit(1)
        }
      }

      console.log('[🌀] 正在解析玩家数据...')
      let player1 = await parsePlayerFile(options.player1, { validateData: options.validateData })
      let player2 = await parsePlayerFile(options.player2, { validateData: options.validateData })

      let selfControl = [player1.id, player2.id]

      if (options.ai) {
        const aiPlayers = options.ai.map((p: string) => p.toLowerCase().trim())
        const createAIPlayer = (basePlayer: Player) => new AIPlayer(basePlayer.name, basePlayer.id, basePlayer.team)

        if (aiPlayers.includes('player1')) {
          player1 = createAIPlayer(player1)
          console.log('[🤖] 玩家1已设置为AI控制')
          selfControl = selfControl.filter(p => p != player1.id)
        }
        if (aiPlayers.includes('player2')) {
          player2 = createAIPlayer(player2)
          console.log('[🤖] 玩家2已设置为AI控制')
          selfControl = selfControl.filter(p => p != player2.id)
        }
      }

      const battle = new Battle(player1, player2, {
        allowFaintSwitch: true,
        showHidden: true,
      })
      const battleSystem = new LocalBattleSystem(battle)
      await initI18n(options.debug)
      new ConsoleUIV2(battleSystem, ...selfControl)
      battleSystem.ready()
    } catch (err) {
      console.error('[💥] 致命错误:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

program
  .command('server')
  .description('启动对战服务器')
  .option('-p, --port <number>', '服务器端口', process.env.PORT || '8102')
  .option('--enable-battle-reports', '启用战报功能和API', false)
  .option('--validate-data', '启用数据完整性验证', false)
  .option('--supabase-url <url>', 'Supabase项目URL（可通过 SUPABASE_URL 环境变量设置）')
  .option('--supabase-anon-key <key>', 'Supabase匿名密钥（可通过 SUPABASE_ANON_KEY 环境变量设置）')
  .option('--supabase-service-key <key>', 'Supabase服务密钥（可通过 SUPABASE_SERVICE_KEY 环境变量设置）')
  .option(
    '--cors-origin <origins>',
    'CORS允许的源（逗号分隔）',
    process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:5173',
  )

  // 邮件服务配置选项
  .option('--email-provider <provider>', '邮件服务提供商 (console|smtp|sendgrid|ses)')
  .option('--email-from <email>', '发件人邮箱地址')
  .option('--email-from-name <name>', '发件人名称')
  // SMTP 配置选项
  .option('--smtp-host <host>', 'SMTP服务器地址')
  .option('--smtp-port <port>', 'SMTP服务器端口')
  .option('--smtp-secure', 'SMTP是否使用SSL/TLS', false)
  .option('--smtp-user <user>', 'SMTP用户名')
  .option('--smtp-pass <pass>', 'SMTP密码')
  // SendGrid 配置选项
  .option('--sendgrid-api-key <key>', 'SendGrid API密钥')
  // AWS SES 配置选项
  .option('--aws-ses-region <region>', 'AWS SES区域')
  .option('--aws-access-key-id <id>', 'AWS访问密钥ID')
  .option('--aws-secret-access-key <key>', 'AWS访问密钥')

  // Redis 配置选项
  .option('--redis-host <host>', 'Redis服务器地址', process.env.REDIS_HOST || 'localhost')
  .option('--redis-port <port>', 'Redis服务器端口', process.env.REDIS_PORT || '6379')
  .option('--redis-password <password>', 'Redis密码')
  .option('--redis-db <db>', 'Redis数据库编号', process.env.REDIS_DB || '0')
  .option('--redis-key-prefix <prefix>', 'Redis键前缀', process.env.REDIS_KEY_PREFIX || 'arcadia:')
  .option('--redis-max-retries <retries>', 'Redis最大重试次数', process.env.REDIS_MAX_RETRIES || '3')
  .option('--redis-retry-delay <delay>', 'Redis重试延迟(毫秒)', process.env.REDIS_RETRY_DELAY || '100')
  .option('--redis-enable-ready-check', 'Redis启用就绪检查', process.env.REDIS_ENABLE_READY_CHECK !== 'false')
  .option('--redis-lazy-connect', 'Redis延迟连接', process.env.REDIS_LAZY_CONNECT !== 'false')

  // 集群配置选项
  .option('--cluster-enabled', '启用集群模式', process.env.CLUSTER_ENABLED !== 'false')
  .option('--cluster-instance-id <id>', '集群实例ID', process.env.CLUSTER_INSTANCE_ID)
  .option('--cluster-instance-host <host>', '集群实例主机名', process.env.CLUSTER_INSTANCE_HOST)
  .option('--cluster-instance-region <region>', '集群实例区域', process.env.CLUSTER_INSTANCE_REGION)
  .option(
    '--cluster-heartbeat-interval <interval>',
    '集群心跳间隔(毫秒)',
    process.env.CLUSTER_HEARTBEAT_INTERVAL || '30000',
  )
  .option(
    '--cluster-health-check-interval <interval>',
    '集群健康检查间隔(毫秒)',
    process.env.CLUSTER_HEALTH_CHECK_INTERVAL || '60000',
  )
  .option(
    '--cluster-failover-timeout <timeout>',
    '集群故障转移超时(毫秒)',
    process.env.CLUSTER_FAILOVER_TIMEOUT || '120000',
  )
  .action(async options => {
    try {
      console.log('[🌀] 正在加载游戏数据...')
      await loadGameData(undefined, LOADING_STRATEGIES.LENIENT)
      await loadScripts()

      // 数据完整性验证
      if (options.validateData) {
        console.log('[🔍] 正在验证游戏数据完整性...')
        const isValid = await validateAndPrintGameData({ verbose: true })
        if (!isValid) {
          console.error('[❌] 游戏数据验证失败，请修复数据问题后重试')
          process.exit(1)
        }
      }

      // 配置战报服务
      let battleReportConfig: (BattleReportConfig & { enableApi: boolean }) | undefined

      // 从环境变量或命令行参数获取配置
      const supabaseUrl = options.supabaseUrl || process.env.SUPABASE_URL
      const supabaseAnonKey = options.supabaseAnonKey || process.env.SUPABASE_ANON_KEY
      const supabaseServiceKey = options.supabaseServiceKey || process.env.SUPABASE_SERVICE_KEY

      if (options.enableBattleReports && supabaseUrl && supabaseAnonKey) {
        battleReportConfig = {
          enableReporting: true,
          enableApi: true,
          database: {
            supabaseUrl,
            supabaseAnonKey,
            supabaseServiceKey,
          },
        }
        console.log('[📊] 战报功能和API已启用')
      } else if (options.enableBattleReports) {
        console.warn('[⚠️] 战报功能需要Supabase配置，已禁用')
        console.warn('    请设置 --supabase-url 和 --supabase-anon-key 参数')
        console.warn('    或设置 SUPABASE_URL 和 SUPABASE_ANON_KEY 环境变量')
      }

      // 创建邮件配置
      const emailCliOptions: EmailCliOptions = {
        emailProvider: options.emailProvider,
        emailFrom: options.emailFrom,
        emailFromName: options.emailFromName,
        smtpHost: options.smtpHost,
        smtpPort: options.smtpPort,
        smtpSecure: options.smtpSecure,
        smtpUser: options.smtpUser,
        smtpPass: options.smtpPass,
        sendgridApiKey: options.sendgridApiKey,
        awsSesRegion: options.awsSesRegion,
        awsAccessKeyId: options.awsAccessKeyId,
        awsSecretAccessKey: options.awsSecretAccessKey,
      }
      const emailConfig = createEmailConfigFromCli(emailCliOptions)

      // 创建集群配置
      const clusterCliOptions: ClusterCliOptions = {
        redisHost: options.redisHost,
        redisPort: options.redisPort,
        redisPassword: options.redisPassword,
        redisDb: options.redisDb,
        redisKeyPrefix: options.redisKeyPrefix,
        redisMaxRetries: options.redisMaxRetries,
        redisRetryDelay: options.redisRetryDelay,
        redisEnableReadyCheck: options.redisEnableReadyCheck,
        redisLazyConnect: options.redisLazyConnect,
        clusterEnabled: options.clusterEnabled,
        clusterInstanceId: options.clusterInstanceId,
        clusterInstanceHost: options.clusterInstanceHost,
        clusterInstanceRegion: options.clusterInstanceRegion,
        clusterHeartbeatInterval: options.clusterHeartbeatInterval,
        clusterHealthCheckInterval: options.clusterHealthCheckInterval,
        clusterFailoverTimeout: options.clusterFailoverTimeout,
        port: options.port,
      }
      const clusterConfig = createClusterConfigFromCli(clusterCliOptions)

      // 配置CORS
      const corsOrigins = options.corsOrigin.split(',').map((origin: string) => origin.trim())

      // 使用集群模式应用
      const { app, start, stop } = createClusterApp({
        port: parseInt(options.port),
        cors: {
          origin: corsOrigins,
          credentials: true,
        },
        battleReport: battleReportConfig,
        email: emailConfig,
        cluster: clusterConfig,
      })

      // 开发服务器（静态文件等）
      new DevServer(app)

      // 优雅关闭处理
      const gracefulShutdown = async (signal: string) => {
        console.log(`\n[📡] 收到 ${signal} 信号，开始优雅关闭...`)
        try {
          await stop()
          console.log('[✅] 服务器已安全关闭')
          process.exit(0)
        } catch (error) {
          console.error('[❌] 关闭服务器时出错:', error)
          process.exit(1)
        }
      }

      process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
      process.on('SIGINT', () => gracefulShutdown('SIGINT'))

      // 启动服务器
      await start()

      console.log(`🖥  Express服务器已启动`)
      console.log(`📡 监听端口: ${options.port}`)
      console.log(`🌐 CORS允许源: ${corsOrigins.join(', ')}`)
      console.log(`🔧 运行模式: ${clusterConfig.cluster.enabled ? '集群模式' : '单实例模式'}`)
      console.log(`⚔  等待玩家连接...`)
      console.log(`🏥 健康检查端点: http://localhost:${options.port}/health`)

      if (clusterConfig.cluster.enabled) {
        console.log(`🔗 集群状态端点: http://localhost:${options.port}/cluster/status`)
        console.log(`📊 Prometheus指标: http://localhost:${options.port}/metrics`)
        console.log(`🗄️  Redis连接: ${clusterConfig.redis.host}:${clusterConfig.redis.port}`)
        console.log(`🏷️  Redis键前缀: ${clusterConfig.redis.keyPrefix}`)
        console.log(`🆔 集群实例ID: ${clusterConfig.instance.id}`)
        if (clusterConfig.instance.region) {
          console.log(`🌍 集群区域: ${clusterConfig.instance.region}`)
        }
      }

      if (battleReportConfig?.enableReporting) {
        console.log(`📊 战报功能: 已启用`)
        console.log(`🔗 战报API: http://localhost:${options.port}/api/v1`)
        console.log(`   - GET /api/v1/battles - 获取战报列表`)
        console.log(`   - GET /api/v1/leaderboard - 获取排行榜`)
        console.log(`   - GET /api/v1/statistics - 获取统计信息`)
      } else {
        console.log(`📊 战报功能: 已禁用`)
      }

      console.log(`📈 服务器统计: http://localhost:${options.port}/api/stats`)
      console.log(`📧 邮件服务: ${emailConfig.provider} (${emailConfig.from})`)
    } catch (err) {
      console.error('[💥] 服务器启动失败:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

program
  .command('validate')
  .description('验证游戏数据完整性')
  .option('--strict', '使用严格模式验证（包含交叉引用检查）', false)
  .option('--load-scripts', '加载脚本定义后再验证', false)
  .option('--verbose', '显示详细的验证信息', false)
  .option('--continue-on-error', '发现错误时继续验证', false)
  .option('--skip-id-format', '跳过ID格式验证', false)
  .option('--skip-duplicates', '跳过重复ID检查', false)
  .action(async options => {
    try {
      console.log('[🔍] 开始游戏数据验证...')

      // 根据选项选择加载策略
      let strategy = LOADING_STRATEGIES.LENIENT
      if (options.strict && options.loadScripts) {
        strategy = LOADING_STRATEGIES.FULL
      } else if (options.strict) {
        strategy = LOADING_STRATEGIES.STRICT
      } else if (options.loadScripts) {
        strategy = LOADING_STRATEGIES.DEVELOPMENT
      }

      console.log('[🌀] 正在加载游戏数据...')
      console.log(
        `[📋] 使用加载策略: ${options.strict ? '严格' : '宽松'}模式${options.loadScripts ? ' + 脚本加载' : ''}`,
      )
      await loadGameData(undefined, strategy)

      // 如果没有通过策略加载脚本，则单独加载
      if (!options.loadScripts) {
        await loadScripts()
      }

      // 配置验证选项
      const validationOptions = {
        validateCrossReferences: options.strict,
        validateIdFormat: !options.skipIdFormat,
        checkDuplicateIds: !options.skipDuplicates,
        continueOnError: options.continueOnError,
        verbose: options.verbose || true, // 验证命令默认显示详细信息
      }

      console.log('[🔍] 正在验证游戏数据完整性...')
      const isValid = await validateAndPrintGameData(validationOptions)

      if (isValid) {
        console.log('[🎉] 所有数据验证通过！')
        process.exit(0)
      } else {
        console.log('[💥] 数据验证失败，请修复上述问题')
        process.exit(1)
      }
    } catch (err) {
      console.error('[💥] 验证过程中发生错误:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

program.parseAsync(process.argv)
