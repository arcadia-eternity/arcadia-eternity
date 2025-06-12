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
  createApp,
} from '@arcadia-eternity/server'
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
async function parsePlayerFile(filePath: string): Promise<Player> {
  try {
    const content = await fs.readFile(path.resolve(filePath), 'utf-8')
    const rawData = yaml.parse(content)
    return PlayerParser.parse(rawData)
  } catch (err) {
    throw new Error(`无法解析玩家文件 ${filePath}: ${err instanceof Error ? err.message : err}`)
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
  .action(async options => {
    try {
      console.log('[🌀] 正在加载游戏数据...')
      await loadGameData(undefined, LOADING_STRATEGIES.LENIENT)
      await loadScripts()

      console.log('[🌀] 正在解析玩家数据...')
      const content = await fs.readFile(path.resolve(options.data), 'utf-8')
      const rawData = yaml.parse(content)
      const player = PlayerSchema.parse(rawData)

      const client = new BattleClient({
        serverUrl: options.server,
      })

      const remote = new RemoteBattleSystem(client)

      await initI18n()
      const consoleUI = new ConsoleUIV2(remote, player.id as playerId)
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

      console.log('[🌀] 正在解析玩家数据...')
      let player1 = await parsePlayerFile(options.player1)
      let player2 = await parsePlayerFile(options.player2)

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
      const ui = new ConsoleUIV2(battleSystem, ...selfControl)
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
  .action(async options => {
    try {
      console.log('[🌀] 正在加载游戏数据...')
      await loadGameData(undefined, LOADING_STRATEGIES.LENIENT)
      await loadScripts()

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

      // 配置CORS
      const corsOrigins = options.corsOrigin.split(',').map((origin: string) => origin.trim())

      // 使用createApp函数创建应用
      const { app, start, stop } = createApp({
        port: parseInt(options.port),
        cors: {
          origin: corsOrigins,
          credentials: true,
        },
        battleReport: battleReportConfig,
        email: emailConfig,
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
      console.log(`⚔  等待玩家连接...`)
      console.log(`🏥 健康检查端点: http://localhost:${options.port}/health`)

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

program.parseAsync(process.argv)
