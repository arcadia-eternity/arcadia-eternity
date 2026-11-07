import dotenv from 'dotenv'
import { program } from 'commander'
import path from 'path'
import fs from 'fs/promises'
import yaml from 'yaml'
import { PlayerSchema, parseWithErrors } from '@arcadia-eternity/schema'
import { BattleMessageType } from '@arcadia-eternity/const'
import type { playerId } from '@arcadia-eternity/const'
import { runInMemoryP2PE2E } from '@arcadia-eternity/p2p-transport'
import { loadNativeCliPack } from './native-pack'
import type { ServerInfo, ServerSession, PrivateRoomEvent } from '@arcadia-eternity/protocol'

// 加载环境变量
dotenv.config()

async function preflightPack(options: { strict?: boolean; validateData?: boolean }): Promise<void> {
  const strict = !!options.strict
  const validateData = !!options.validateData
  if (!strict && !validateData) return

  console.log('[🌀] 正在预加载数据包...')
  const result = await loadNativeCliPack()
  console.log(
    `[📦] 数据包 ${result.pack?.id ?? result.packRef}@${result.pack?.version ?? 'unknown'} 加载完成: effect=${result.content.effects.length}, mark=${result.content.marks.length}, skill=${result.content.skills.length}, species=${result.content.species.length}`,
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
  .description('创建或加入单进程服务器的好友房')
  .requiredOption('-d, --data <path>', '玩家数据文件路径')
  .option('-s, --server <url>', '服务器地址', process.env.BATTLE_SERVER_URL || 'ws://localhost:8102')
  .option('-r, --room <code>', '加入现有房间；省略则创建房间')
  .option('--password <password>', '房间密码')
  .option('--private', '创建需要密码的房间', false)
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
      const serverUrl = new URL(options.server)
      if (serverUrl.protocol === 'ws:') serverUrl.protocol = 'http:'
      if (serverUrl.protocol === 'wss:') serverUrl.protocol = 'https:'
      serverUrl.pathname = serverUrl.pathname.replace(/\/$/, '')
      const apiUrl = new URL(`${serverUrl.toString().replace(/\/$/, '')}/api/v1/`)
      const infoResponse = await fetch(new URL('server-info', apiUrl))
      if (!infoResponse.ok) throw new Error(`读取服务器能力失败：HTTP ${infoResponse.status}`)
      const info = (await infoResponse.json()) as ServerInfo
      if (info.protocolVersion !== 1 || !info.runtime) throw new Error('服务器协议或原生对战版本不兼容')
      const sessionResponse = await fetch(new URL('sessions', apiUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: { id: player.id, name: player.name } }),
      })
      if (!sessionResponse.ok) throw new Error(`创建服务器会话失败：HTTP ${sessionResponse.status}`)
      const session = (await sessionResponse.json()) as ServerSession
      if (session.serverId !== info.serverId || session.bootId !== info.bootId)
        throw new Error('服务器在创建会话时重启，请重试')

      const client = new BattleClient({
        serverUrl: serverUrl.toString(),
        auth: {
          getToken: () => session.token,
          getSessionId: () => session.sessionId,
        },
      })

      const remote = new RemoteBattleSystem(client)

      await initI18n()
      const ui = new ConsoleUIV2(remote, session.seatId as playerId)
      const stop = remote.BattleEvent(event => {
        if (event.type === BattleMessageType.BattleEnd) {
          setImmediate(() => {
            ui.cleanup()
            stop()
            client.disconnect()
          })
        }
      })
      let started = false
      let readySent = false
      let roomCode = options.room as string | undefined
      client.on('privateRoomEvent', (event: PrivateRoomEvent) => {
        void (async () => {
          if (event.type === 'roomClosed') {
            console.log(`房间已关闭：${event.data.reason}`)
            ui.cleanup()
            client.disconnect()
          }
          if (event.type === 'battleStarted' && event.data.battleMode === 'server' && !readySent) {
            readySent = true
            await remote.ready()
            console.log('已进入对战。')
          }
          if (
            !options.room &&
            !started &&
            event.type === 'roomUpdate' &&
            event.data.config.roomCode === roomCode &&
            event.data.players.length === 2 &&
            event.data.players.every(member => member.isReady)
          ) {
            started = true
            await client.startPrivateRoomBattle(player.team)
          }
        })().catch(error => console.error('房间事件处理失败:', error))
      })
      await client.connect()
      if (roomCode) {
        await client.joinPrivateRoom({ roomCode, password: options.password, expectedRuntime: info.runtime })
        console.log(`已加入房间 ${roomCode}，等待房主开始。`)
      } else {
        if (options.private && !options.password) throw new Error('私密房间需要 --password')
        roomCode = await client.createPrivateRoom({
          expectedRuntime: info.runtime,
          config: { battleMode: 'server', isPrivate: options.private, password: options.password },
        })
        console.log(`房间号：${roomCode}。请让另一位玩家用 --room ${roomCode} 加入。`)
      }
      await client.togglePrivateRoomReady(player.team)
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

await program.parseAsync(process.argv)
