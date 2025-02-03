// battle-server.ts
import { WebSocketServer } from 'ws'
import { BattlePhase, BattleSystem, UseSkillSelection } from './simulation/battleSystem'
import { Player, PlayerSelection } from './simulation/battleSystem'

type ClientMessage =
  | {
      type: 'action'
      data: ActionPayload
    }
  | {
      type: 'ping'
    }

type ActionPayload = {
  actionType: 'use-skill' | 'switch-pet' | 'do-nothing'
  skillIndex?: number
  petIndex?: number
}

class BattleSession {
  private battle: BattleSystem
  private generator: Generator<void, Player, PlayerSelection>
  private pendingActions = new Map<Player, PlayerSelection>()

  constructor(
    private playerA: Player,
    private playerB: Player,
    private sendToClient: (player: Player, data: any) => void,
  ) {
    this.battle = new BattleSystem(playerA, playerB)
    this.generator = this.battle.startBattle()
    this.run()
  }

  private async run() {
    let result = this.generator.next()

    while (!result.done) {
      const currentPlayer = this.getCurrentPlayer()
      if (currentPlayer) {
        this.requestActionFromPlayer(currentPlayer)
      }

      // 等待双方操作完成
      await this.waitForActions()

      const selection = this.pendingActions.get(currentPlayer!)
      if (!selection) {
        throw new Error(`没有找到${currentPlayer!.name}的操作选择`)
      }
      result = this.generator.next(selection)
      this.pendingActions.clear()

      // 广播战斗状态
      this.broadcastState()
    }

    this.sendToBoth({ type: 'battle-end', winner: result.value.name })
  }

  private getCurrentPlayer(): Player | null {
    // 优先处理强制换宠
    if (this.battle.pendingDefeatedPlayer) {
      return this.battle.pendingDefeatedPlayer
    }

    // 根据阶段判断当前玩家
    switch (this.battle.currentPhase) {
      case BattlePhase.SwitchPhase:
        return this.battle.pendingDefeatedPlayer || null

      case BattlePhase.SelectionPhase:
        if (!this.playerA.selection) return this.playerA
        if (!this.playerB.selection) return this.playerB
        return null

      case BattlePhase.ExecutionPhase:
      case BattlePhase.Ended:
        return null
    }
    return null
  }

  private handleAction(player: Player, action: PlayerSelection) {
    if (this.validateAction(player, action)) {
      this.pendingActions.set(player, action)
    }
  }

  private validateAction(player: Player, action: PlayerSelection): boolean {
    const validActions = this.battle.getAvailableSelection(player)
    return validActions.some(
      validAction =>
        action.type === validAction.type &&
        (action.type !== 'use-skill' ||
          (action as UseSkillSelection).skill === (validAction as UseSkillSelection).skill),
    )
  }

  private requestActionFromPlayer(player: Player) {
    const actions = this.battle.getAvailableSelection(player)
    const actionList = actions.map(action => ({
      type: action.type,
      skills: action.type === 'use-skill' ? [action.skill.name] : [],
      pets: action.type === 'switch-pet' ? [action.pet.name] : [],
    }))

    this.sendToClient(player, {
      type: 'action-request',
      actions: actionList,
      forced: !!this.battle.pendingDefeatedPlayer,
    })
  }

  private broadcastState() {
    this.sendToBoth({
      type: 'state-update',
      state: this.getBattleState(),
    })
  }

  private getBattleState() {
    return {
      playerA: this.getPlayerState(this.playerA),
      playerB: this.getPlayerState(this.playerB),
      phase: this.battle.currentPhase,
      lastMessage: this.battle.lastMessage,
    }
  }

  private getPlayerState(player: Player) {
    return {
      activePet: {
        name: player.activePet.name,
        hp: player.activePet.currentHp,
        maxHp: player.activePet.maxHp,
        rage: player.activePet.currentRage,
        status: player.activePet.status,
      },
      bench: player.bench.map(pet => ({
        name: pet.name,
        hp: pet.currentHp,
        status: pet.status,
      })),
    }
  }

  private async waitForActions(): Promise<void> {
    return new Promise(resolve => {
      const check = () => {
        if (this.pendingActions.size >= this.requiredActionCount()) {
          resolve()
        } else {
          setTimeout(check, 100)
        }
      }
      check()
    })
  }

  private requiredActionCount(): number {
    return this.battle.pendingDefeatedPlayer ? 1 : 2
  }

  private sendToBoth(message: any) {
    this.sendToClient(this.playerA, message)
    this.sendToClient(this.playerB, message)
  }
}

export class BattleServer {
  private wss: WebSocketServer
  private sessions = new Map<string, BattleSession>()

  constructor(port: number) {
    this.wss = new WebSocketServer({ port })

    this.wss.on('connection', (ws, req) => {
      const sessionId = new URL(req.url!, `ws://${req.headers.host}`).searchParams.get('session')
      if (!sessionId) return ws.close()

      const currentPlayer: Player | null = null
      const session = this.sessions.get(sessionId)

      ws.on('message', data => {
        const message: ClientMessage = JSON.parse(data.toString())
        if (message.type === 'action') {
          const action = this.parseAction(message.data)
          if (action && currentPlayer) {
            session.handleAction(currentPlayer, action)
          }
        }
      })

      // 心跳检测
      const interval = setInterval(() => ws.ping(), 30000)
      ws.on('close', () => clearInterval(interval))
    })
  }

  private parseAction(data: ActionPayload): PlayerSelection | null {
    switch (data.actionType) {
      case 'use-skill':
        return data.skillIndex !== undefined ? { type: 'use-skill', skillIndex: data.skillIndex } : null
      case 'switch-pet':
        return data.petIndex !== undefined ? { type: 'switch-pet', petIndex: data.petIndex } : null
      case 'do-nothing':
        return { type: 'do-nothing' }
      default:
        return null
    }
  }

  public createBattleSession(player1: Player, player2: Player): string {
    const sessionId = crypto.randomUUID()
    const sendToClient = (player: Player, data: any) => {
      // 实际实现中需要维护玩家与WS连接的映射
    }
    this.sessions.set(sessionId, new BattleSession(player1, player2, sendToClient))
    return sessionId
  }
}

// 启动服务器
const server = new BattleServer(8080)
