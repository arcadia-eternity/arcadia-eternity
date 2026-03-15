import dotenv from 'dotenv'
import { program } from 'commander'
import path from 'path'
import fs from 'fs/promises'
import yaml from 'yaml'
import type { TeamConfig, V2DataRepository } from '@arcadia-eternity/battle'
import { PlayerSchema, parseWithErrors, type PlayerSchemaType } from '@arcadia-eternity/schema'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import type { playerId, BattleMessage, PlayerSelection } from '@arcadia-eternity/const'
import { BattleMessageType } from '@arcadia-eternity/const'
import {
  runInMemoryP2PE2E,
} from '@arcadia-eternity/p2p-transport'

// 加载环境变量
dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function toTeamConfig(player: PlayerSchemaType): TeamConfig {
  return {
    name: player.name,
    team: player.team.map((pet: any) => ({
      name: pet.name,
      species: pet.species,
      level: pet.level,
      evs: pet.evs,
      ivs: pet.ivs,
      nature: pet.nature,
      skills: pet.skills,
      ability: pet.ability,
      emblem: pet.emblem,
      gender: pet.gender,
      weight: pet.weight,
      height: pet.height,
    })),
  }
}

// 解析玩家文件
async function parsePlayerFile(filePath: string, _options: { validateData?: boolean } = {}): Promise<PlayerSchemaType> {
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

    // 使用 schema 进行完整解析
    const player = parseWithErrors(PlayerSchema, rawData)

    console.log(`[✅] 成功解析玩家: ${player.name} (${player.team.length} 只精灵)`)
    return player
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    throw new Error(`无法解析玩家文件 ${filePath}: ${errorMessage}`)
  }
}

function createRuleSpeciesRepository(repo: V2DataRepository): {
  getSpeciesById: (id: string) => unknown
  getAllSpecies: () => unknown[]
} {
  return {
    getSpeciesById: (id: string) => {
      const species = repo.findSpecies(id)
      if (!species) return undefined
      return {
        id: species.id,
        num: species.num,
        element: species.element,
        baseStats: species.baseStats,
      }
    },
    getAllSpecies: () => Array.from(repo.allSpecies()).map(species => ({
      id: species.id,
      num: species.num,
      element: species.element,
      baseStats: species.baseStats,
    })),
  }
}

async function preflightPack(options: { strict?: boolean; validateData?: boolean }): Promise<void> {
  const strict = !!options.strict
  const validateData = !!options.validateData
  if (!strict && !validateData) return

  const { PackLoader } = await import('@arcadia-eternity/pack-loader')
  const packLoader = new PackLoader()

  console.log('[🌀] 正在预加载数据包...')
  const result = await packLoader.load('builtin:base', {
    continueOnError: !strict,
    validateReferences: true,
  })
  const summary = packLoader.summarize(result)
  console.log(
    `[📦] 数据包 ${summary.packId ?? summary.packRef}@${summary.packVersion ?? 'unknown'} 加载完成: effect=${summary.effectCount}, mark=${summary.markCount}, skill=${summary.skillCount}, species=${summary.speciesCount}`,
  )

  if (result.errors.length > 0) {
    const head = result.errors.slice(0, 5)
    for (const err of head) {
      console.error(`[❌] ${err}`)
    }
    if (result.errors.length > head.length) {
      console.error(`[❌] ... and ${result.errors.length - head.length} more errors`)
    }
    if (strict || validateData) {
      throw new Error(`数据包校验失败，共 ${result.errors.length} 个错误`)
    }
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
      const [{ BattleClient, RemoteBattleSystem }, { ConsoleUIV2, initI18n }] = await Promise.all([
        import('@arcadia-eternity/client'),
        import('@arcadia-eternity/console'),
      ])

      await preflightPack({ validateData: options.validateData, strict: false })

      console.log('[🌀] 正在解析玩家数据...')
      const content = await fs.readFile(path.resolve(options.data), 'utf-8')
      const rawData = yaml.parse(content)
      const player = parseWithErrors(PlayerSchema, rawData)

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
      const [{ createLocalBattleFromYAML }, { ConsoleUIV2, initI18n }] = await Promise.all([
        import('@arcadia-eternity/battle/node'),
        import('@arcadia-eternity/console'),
      ])

      await preflightPack({
        validateData: options.validateData,
        strict: options.strict,
      })

      console.log('[🌀] 正在解析玩家数据...')
      let player1 = await parsePlayerFile(options.player1, { validateData: options.validateData })
      let player2 = await parsePlayerFile(options.player2, { validateData: options.validateData })

      const aiControl = new Set<playerId>()

      const player1Config = toTeamConfig(player1)
      const player2Config = toTeamConfig(player2)

      const battleSystem = await createLocalBattleFromYAML('builtin:base', player1Config, player2Config, {
        allowFaintSwitch: true,
        showHidden: true,
      })
      const initialState = await battleSystem.getState(undefined, true)
      const v2Player1Id = initialState.players[0]?.id
      const v2Player2Id = initialState.players[1]?.id
      if (!v2Player1Id || !v2Player2Id) {
        throw new Error('v2 battle 初始化失败：无法解析玩家ID')
      }

      let selfControl = [v2Player1Id, v2Player2Id]
      if (options.ai) {
        const aiPlayers = options.ai.map((p: string) => p.toLowerCase().trim())
        if (aiPlayers.includes('player1')) {
          console.log('[🤖] 玩家1已设置为AI控制')
          aiControl.add(v2Player1Id as playerId)
          selfControl = selfControl.filter(p => p != v2Player1Id)
        }
        if (aiPlayers.includes('player2')) {
          console.log('[🤖] 玩家2已设置为AI控制')
          aiControl.add(v2Player2Id as playerId)
          selfControl = selfControl.filter(p => p != v2Player2Id)
        }
      }

      const aiPending = new Set<playerId>()
      let observedTurn = 0
      const maxAiTurns = Number(process.env.CLI_MAX_AI_TURNS ?? 120)
      const runAIIfNeeded = async (pid: playerId): Promise<void> => {
        if (!aiControl.has(pid) || aiPending.has(pid)) return
        aiPending.add(pid)
        try {
          const available = await battleSystem.getAvailableSelection(pid)
          if (available.length === 0) return

          const picked = (
            available.find(a => a.type === 'team-selection') ??
            available.find(a => a.type === 'use-skill') ??
            available.find(a => a.type === 'switch-pet') ??
            available.find(a => a.type === 'do-nothing') ??
            available.find(a => a.type === 'surrender') ??
            available[0]
          ) as PlayerSelection
          await battleSystem.submitAction(picked)
        } finally {
          aiPending.delete(pid)
        }
      }

      const triggerAIFromMessage = (msg: BattleMessage): void => {
        if (msg.type === BattleMessageType.TurnAction) {
          observedTurn++
          if (observedTurn > maxAiTurns && aiControl.size > 0) {
            const fallback = Array.from(aiControl)[0]
            void battleSystem.submitAction({ player: fallback, type: 'surrender' } as PlayerSelection)
            return
          }
          for (const pid of msg.data.player) {
            void runAIIfNeeded(pid)
          }
          return
        }
        if (msg.type === BattleMessageType.ForcedSwitch) {
          for (const pid of msg.data.player) {
            void runAIIfNeeded(pid)
          }
          return
        }
        if (msg.type === BattleMessageType.FaintSwitch) {
          void runAIIfNeeded(msg.data.player)
          return
        }
        if (msg.type === BattleMessageType.TeamSelectionStart) {
          for (const pid of [v2Player1Id, v2Player2Id] as playerId[]) {
            void runAIIfNeeded(pid)
          }
        }
      }

      battleSystem.BattleEvent(triggerAIFromMessage)

      await initI18n(options.debug)
      new ConsoleUIV2(battleSystem, ...selfControl)
      await battleSystem.ready()
    } catch (err) {
      console.error('[💥] 致命错误:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

program
  .command('p2p-battle-e2e')
  .description('通过 p2p transport 在 CLI 内跑一局 v2 battle e2e')
  .requiredOption('-1, --player1 <path>', '玩家1数据文件路径')
  .requiredOption('-2, --player2 <path>', '玩家2数据文件路径')
  .option('-r, --rounds <number>', '最多自动推进回合数', '2')
  .option('--strict', '使用严格模式加载数据（检测缺失引用）', false)
  .option('--validate-data', '启用数据完整性验证', false)
  .action(async options => {
    try {
      const { runInMemoryP2PBattleE2E } = await import('@arcadia-eternity/p2p-transport/node')

      await preflightPack({
        validateData: options.validateData,
        strict: options.strict,
      })

      console.log('[🌀] 正在解析玩家数据...')
      const player1 = await parsePlayerFile(options.player1, { validateData: options.validateData })
      const player2 = await parsePlayerFile(options.player2, { validateData: options.validateData })

      const result = await runInMemoryP2PBattleE2E({
        playerATeam: toTeamConfig(player1),
        playerBTeam: toTeamConfig(player2),
        rounds: Number.parseInt(String(options.rounds), 10),
      })

      console.log(`[✅] p2p battle e2e 完成`)
      console.log(`playerA=${result.playerAId}, playerB=${result.playerBId}`)
      console.log(`roundsPlayed=${result.roundsPlayed}`)
      console.log(`battleStatus=${result.finalState.status}, currentTurn=${result.finalState.currentTurn}`)
      console.log(`hostEvents=${result.hostEvents.length}, peerEvents=${result.peerEvents.length}`)
      console.log(`playerASelections=${result.playerASelections.length}, playerBSelections=${result.playerBSelections.length}`)
      process.exit(0)
    } catch (err) {
      console.error('[💥] 错误:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

program
  .command('p2p-e2e')
  .description('使用 in-memory transport 运行一组 P2P CLI 端到端握手与消息交换测试')
  .option('--rounds <number>', '消息往返轮数', '3')
  .action(async options => {
    try {
      const rounds = Number.parseInt(options.rounds, 10)
      if (!Number.isFinite(rounds) || rounds <= 0) {
        throw new Error(`非法 rounds 参数: ${options.rounds}`)
      }

      const result = await runInMemoryP2PE2E(rounds)

      console.log('[✅] P2P e2e completed')
      console.log(`[ℹ️] host phase=${result.hostPhase}, peer phase=${result.peerPhase}`)
      console.log(`[ℹ️] host signals=${result.hostSignals.length}, peer signals=${result.peerSignals.length}`)
      console.log(`[ℹ️] host received=${result.hostReceived.length}, peer received=${result.peerReceived.length}`)
      console.log('[📨] peer received sample:', JSON.stringify(result.peerReceived[0] ?? null))
      console.log('[📨] host received sample:', JSON.stringify(result.hostReceived[0] ?? null))
    } catch (err) {
      console.error('[💥] P2P e2e failed:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

program
  .command('p2p-ws-e2e')
  .description('使用 websocket relay transport 运行一组 Node/CLI 端到端消息交换测试')
  .option('--rounds <number>', '消息往返轮数', '3')
  .action(async options => {
    try {
      const rounds = Number.parseInt(options.rounds, 10)
      if (!Number.isFinite(rounds) || rounds <= 0) {
        throw new Error(`非法 rounds 参数: ${options.rounds}`)
      }

      const { runWebSocketP2PE2E } = await import('@arcadia-eternity/p2p-transport/node')
      const result = await runWebSocketP2PE2E(rounds)

      console.log('[✅] P2P websocket e2e completed')
      console.log(`[ℹ️] host phase=${result.hostPhase}, peer phase=${result.peerPhase}`)
      console.log(`[ℹ️] host received=${result.hostReceived.length}, peer received=${result.peerReceived.length}`)
      console.log('[📨] peer received sample:', JSON.stringify(result.peerReceived[0] ?? null))
      console.log('[📨] host received sample:', JSON.stringify(result.hostReceived[0] ?? null))
    } catch (err) {
      console.error('[💥] P2P websocket e2e failed:', err instanceof Error ? err.message : err)
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
      const [{ resourceLoadingManager, createEmailConfigFromCli, createClusterApp, createClusterConfigFromCli }, { ServerRuleIntegration }] =
        await Promise.all([
          import('@arcadia-eternity/server'),
          import('@arcadia-eternity/rules'),
        ])

      console.log('[🌀] 启动异步游戏资源加载...')
      // 启动异步资源加载，不等待完成
      resourceLoadingManager
        .startAsyncLoading({
          packRef: 'builtin:base',
          validateData: options.validateData,
          continueOnError: true,
        })
        .then(async () => {
          // 资源加载完成后初始化规则系统
          console.log('[⚖️] 正在初始化服务端规则系统...')
          try {
            const loadedRepository = resourceLoadingManager.getLoadedRepository()
            if (loadedRepository) {
              await ServerRuleIntegration.initializeServer(createRuleSpeciesRepository(loadedRepository))
            } else {
              await ServerRuleIntegration.initializeServer()
            }
            console.log('[✅] 服务端规则系统初始化成功')
          } catch (error) {
            console.error('[❌] 服务端规则系统初始化失败:', error)
          }
        })
        .catch(error => {
          console.error('[❌] 异步资源加载失败:', error instanceof Error ? error.message : error)
        })

      console.log('[✅] 异步资源加载已启动，服务器将在后台加载资源')

      // 配置战报服务
      let battleReportConfig:
        | {
            enableReporting: boolean
            enableApi: boolean
            database: {
              supabaseUrl: string
              supabaseAnonKey: string
              supabaseServiceKey?: string
            }
          }
        | undefined

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
      const emailCliOptions = {
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
      const clusterCliOptions = {
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
  .option('--strict', '使用严格模式验证（发现错误直接失败）', false)
  .option('--verbose', '显示详细的验证信息', false)
  .option('--continue-on-error', '发现错误时继续验证', false)
  .option('--pack-ref <ref>', '数据包引用，默认 builtin:base', 'builtin:base')
  .action(async options => {
    try {
      const { PackLoader } = await import('@arcadia-eternity/pack-loader')
      const packLoader = new PackLoader()
      console.log('[🔍] 开始数据包验证...')
      const result = await packLoader.load(options.packRef, {
        continueOnError: options.continueOnError,
        validateReferences: true,
      })
      const summary = packLoader.summarize(result)

      console.log(`[📦] pack=${summary.packId ?? summary.packRef}@${summary.packVersion ?? 'unknown'}`)
      console.log(
        `[📊] effect=${summary.effectCount}, mark=${summary.markCount}, skill=${summary.skillCount}, species=${summary.speciesCount}`,
      )

      if (result.errors.length === 0) {
        console.log('[🎉] 数据包验证通过')
        process.exit(0)
      }

      const outputErrors = options.verbose ? result.errors : result.errors.slice(0, 20)
      for (const err of outputErrors) {
        console.error(`[❌] ${err}`)
      }
      if (!options.verbose && result.errors.length > outputErrors.length) {
        console.error(`[❌] ... and ${result.errors.length - outputErrors.length} more errors`)
      }

      if (options.strict || !options.continueOnError) {
        process.exit(1)
      } else {
        console.warn('[⚠️] 存在错误，但按 continue-on-error 继续')
        process.exit(0)
      }
    } catch (err) {
      console.error('[💥] 验证过程中发生错误:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

program.parseAsync(process.argv)
