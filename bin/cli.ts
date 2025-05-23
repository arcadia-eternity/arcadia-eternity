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
import { BattleServer } from '@arcadia-eternity/server'
import DevServer from '../devServer'
import { Server } from 'socket.io'
import express from 'express'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { LocalBattleSystem } from '@arcadia-eternity/local-adapter'
import type { playerId } from '@arcadia-eternity/const'

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
  .option('-s, --server <url>', '服务器地址', 'ws://localhost:8102')
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
  .option('-p, --port <number>', '服务器端口', '8102')
  .action(async options => {
    try {
      console.log('[🌀] 正在加载游戏数据...')
      await loadGameData(undefined, LOADING_STRATEGIES.LENIENT)
      await loadScripts()

      const app = express()
      new DevServer(app)
      const httpServer = createServer(app)

      // 添加基础健康检查端点
      app.get('/health', (_, res) => {
        res.status(200).json({
          status: 'OK',
          uptime: process.uptime(),
          timestamp: Date.now(),
        })
      })

      // 配置Socket.IO
      const io = new Server(httpServer, {
        cors: {
          origin: '*',
          methods: ['GET', 'POST'],
        },
      })

      // 初始化战斗服务器
      new BattleServer(io)

      // 启动服务器
      httpServer.listen(parseInt(options.port), () => {
        console.log(`🖥  Express服务器已启动`)
        console.log(`📡 监听端口: ${options.port}`)
        console.log(`⚔  等待玩家连接...`)
        console.log(`🏥 健康检查端点: http://localhost:${options.port}/health`)
      })
    } catch (err) {
      console.error('[💥] 服务器启动失败:', err instanceof Error ? err.message : err)
      process.exit(1)
    }
  })

program.parseAsync(process.argv)
