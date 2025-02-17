import { Pet } from './pet'
import { MarkOwner, RAGE_PER_TURN } from './const'
import {
  AddMarkContext,
  type AllContext,
  Context,
  RageContext,
  RemoveMarkContext,
  SwitchPetContext,
  TurnContext,
  UseSkillContext,
} from './context'
import {
  type BattleMessage,
  BattleMessageType,
  type BattleMessageData,
  type BattleState,
  BattleMessageHandler,
} from './message'
import { Player } from './player'
import Prando from 'prando'
import { Mark } from './mark'
import { type EffectContainer, EffectScheduler, EffectTrigger } from './effect'
import { UseSkillSelection, SwitchPetSelection } from './selection'

export enum BattlePhase {
  SwitchPhase = 'SWITCH_PHASE',
  SelectionPhase = 'SELECTION_PHASE',
  ExecutionPhase = 'EXECUTION_PHASE',
  Ended = 'ENDED',
}

// 对战系统
export class Battle extends Context implements MarkOwner {
  public readonly parent: null = null
  public readonly battle: Battle = this

  public status: BattleStatus = BattleStatus.Unstarted
  public currentPhase: BattlePhase = BattlePhase.SelectionPhase
  public currentTurn = 0
  // private messageCallbacks: Array<(message: BattleMessage) => void> = []
  public playerAMessageCallbacks: Array<(message: BattleMessage) => void> = []
  public playerBMessageCallbacks: Array<(message: BattleMessage) => void> = []
  public pendingDefeatedPlayers: Player[] = [] // 新增：需要在下回合换宠的玩家
  public allowFaintSwitch: boolean
  public lastKiller?: Player
  public marks: Mark[] = [] //用于存放天气一类的效果
  private rng = new Prando(Date.now() ^ (Math.random() * 0x100000000))
  public victor?: Player

  constructor(
    public readonly playerA: Player,
    public readonly playerB: Player,
    options?: { allowFaintSwitch?: boolean; rngSeed?: number },
  ) {
    super(null)
    this.allowFaintSwitch = options?.allowFaintSwitch ?? true
    if (options?.rngSeed) this.rng = new Prando(options.rngSeed)
    this.playerA.registerBattle(this)
    this.playerB.registerBattle(this)
  }

  // 注册消息回调
  public registerListener(player: Player, callback: BattleMessageHandler) {
    const callbacks = player === this.playerA ? this.playerAMessageCallbacks : this.playerBMessageCallbacks

    callbacks.push(callback)
  }

  public random() {
    return this.rng.next()
  }

  public randomInt(min: number, max: number) {
    return this.rng.nextInt(min, max)
  }

  public shuffle<T>(array: T[]): T[] {
    const result = [...array]
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[result[i], result[j]] = [result[j], result[i]]
    }
    return result
  }

  // 发送消息给所有回调
  public emitMessage<T extends BattleMessageType>(
    type: T,
    data: BattleMessageData[T],
    targetPlayer?: Player, // 新增：指定目标玩家
  ) {
    const message: BattleMessage = { type, data, timestamp: Date.now() } as BattleMessage

    // 按目标玩家发送消息
    if (targetPlayer) {
      const callbacks = targetPlayer === this.playerA ? this.playerAMessageCallbacks : this.playerBMessageCallbacks
      callbacks.forEach(cb => cb(message))
    } else {
      // 全局广播
      this.playerAMessageCallbacks.forEach(cb => cb(message))
      this.playerBMessageCallbacks.forEach(cb => cb(message))
    }
  }

  public addMark(context: AddMarkContext) {
    if (!context.available) return

    const newMark = context.mark.clone(context)
    if (context.stack) newMark._stack = context.stack

    const existingMark = this.marks.find(mark => mark.id === context.mark.id)
    if (existingMark) {
      existingMark.tryStack(context)
    } else {
      context.battle.applyEffects(context, EffectTrigger.OnAddMark)
      context.battle.applyEffects(context, EffectTrigger.OnMarkCreate, newMark)
      newMark.attachTo(this)
      this.marks.push(newMark)
    }
  }

  public removeMark(context: RemoveMarkContext) {
    this.marks.forEach(mark => {
      const filltered = mark.id !== context.mark.id
      if (filltered) mark.destory(context)
      return false
    })
  }

  public getOpponent(player: Player) {
    if (player === this.playerA) return this.playerB
    return this.playerA
  }

  private addTurnRage(context: TurnContext) {
    ;[this.playerA, this.playerB].forEach(player => {
      player.addRage(new RageContext(context, player, 'turn', 'add', RAGE_PER_TURN))
    })
  }

  private updateTurnMark(context: TurnContext) {
    ;[this.playerA, this.playerB].forEach(player => {
      player.activePet.marks.forEach(mark => mark.update(context))
      player.activePet.marks = player.activePet.marks.filter(mark => mark.isActive)
    })
  }

  public cleanupMarks() {
    // 清理战场标记
    this.marks = this.marks.filter(mark => {
      return mark.isActive
    })

    // 清理玩家精灵标记
    const cleanPetMarks = (pet: Pet) => {
      pet.marks = pet.marks.filter(mark => {
        return mark.isActive || mark.owner !== pet
      })
    }

    cleanPetMarks(this.playerA.activePet)
    cleanPetMarks(this.playerB.activePet)
  }

  public applyEffects<T extends EffectTrigger>(context: AllContext, trigger: T, ...target: EffectContainer[]) {
    let effectContainers = [...target]
    if (target.length == 0)
      effectContainers = [...this.marks, ...this.playerA.activePet.marks, ...this.playerB.activePet.marks]

    if (context instanceof UseSkillContext) {
      effectContainers.push(context.skill)
    }

    // 阶段1：收集所有待触发效果
    effectContainers.forEach(container => container.collectEffects(trigger, context))

    // 阶段2：按全局优先级执行
    EffectScheduler.getInstance().flushEffects()
  }

  // 执行对战回合
  private performTurn(context: TurnContext): boolean {
    if (!this.playerA.selection || !this.playerB.selection) throw '有人还未选择好！'

    const contexts: Context[] = []

    for (const selection of [this.playerA.selection, this.playerB.selection]) {
      switch (selection.type) {
        case 'use-skill': {
          const _selection = selection as UseSkillSelection
          const skillContext = new UseSkillContext(
            context,
            _selection.source,
            _selection.source.activePet,
            _selection.skill.target,
            _selection.skill,
          )
          this.battle.applyEffects(skillContext, EffectTrigger.BeforeSort)
          contexts.push(skillContext)
          break
        }
        case 'switch-pet': {
          const _selection = selection as SwitchPetSelection
          const switchContext = new SwitchPetContext(context, _selection.source, _selection.pet)
          contexts.push(switchContext)
          break
        }
        case 'do-nothing':
          //确实啥都没干
          break
        case 'surrunder':
          this.victor = this.getOpponent(selection.source)
          this.status = BattleStatus.Ended
          return true
        default:
          throw '未知的context'
      }
    }
    contexts.sort(this.contextSort)

    this.currentTurn++

    this.emitMessage(BattleMessageType.RoundStart, {
      round: this.currentTurn,
    })

    this.applyEffects(context, EffectTrigger.TurnStart)

    while (contexts.length > 0) {
      const nowContext = contexts.pop()
      if (!nowContext) break
      switch (nowContext.type) {
        case 'use-skill': {
          const _context = nowContext as UseSkillContext
          _context.origin.performAttack(_context)
          break
        }
        case 'switch-pet': {
          const _context = nowContext as SwitchPetContext
          _context.origin.performSwitchPet(_context)
          break
        }
      }
      this.cleanupMarks()
      this.emitMessage(BattleMessageType.BattleState, this.toMessage())
    }

    this.applyEffects(context, EffectTrigger.TurnEnd)
    this.addTurnRage(context) // 每回合结束获得怒气
    this.updateTurnMark(context)
    this.cleanupMarks()

    this.emitMessage(BattleMessageType.BattleState, this.toMessage())

    // 战斗结束后重置状态
    if (this.isBattleEnded()) {
      this.status = BattleStatus.Ended
      return true
    }

    return false
  }

  private isBattleEnded(): boolean {
    if ((this.status = BattleStatus.Ended)) return true
    if (this.victor) return true
    // 检查强制换宠失败
    let isBattleEnded = false
    for (const player of this.pendingDefeatedPlayers) {
      const available = player.getAvailableSwitch()
      if (available.length === 0) {
        isBattleEnded = true
      }
    }
    const playerAisDefeat = this.playerA.team.every(p => !p.isAlive)
    const playerBisDefeat = this.playerB.team.every(p => !p.isAlive)
    if (playerAisDefeat || playerBisDefeat) {
      isBattleEnded = true
      this.status = BattleStatus.Ended
      this.currentPhase = BattlePhase.Ended
    }
    if (playerAisDefeat && !playerBisDefeat) this.victor = this.playerB
    if (playerBisDefeat && !playerAisDefeat) this.victor = this.playerA

    return isBattleEnded
  }

  private contextSort(a: Context, b: Context): number {
    // 类型优先级：换宠 > 印记效果 > 使用技能
    // 等下，真的有印记效果会在这个时候触发吗？
    const typeOrder: Record<Context['type'], number> = {
      'switch-pet': 1,
      'use-skill': 0,
    }

    // 获取类型顺序值
    const aType = a.type
    const bType = b.type

    // 类型不同时按优先级排序
    if (aType !== bType) {
      return typeOrder[aType] - typeOrder[bType]
    }

    // 同类型时比较优先级
    switch (aType) {
      case 'switch-pet':
        // 换宠始终优先
        return 1

      case 'use-skill': {
        const aSkill = a as UseSkillContext
        const bSkill = b as UseSkillContext

        // 先比较技能优先级
        if (aSkill.skillPriority !== bSkill.skillPriority) {
          return aSkill.skillPriority - bSkill.skillPriority
        }

        // 同优先级比较速度
        if (aSkill.pet.actualStat.spd !== bSkill.pet.actualStat.spd) {
          return aSkill.pet.actualStat.spd - bSkill.pet.actualStat.spd
        }

        // 速度相同,始终是a先手
        return 1
      }
      default:
        return 1
    }
  }

  private async collectSelections() {
    // 创建两个独立的选择Promise，每个包含校验逻辑
    const playerAPromise = this.waitForValidSelection(this.playerA)
    const playerBPromise = this.waitForValidSelection(this.playerB)

    // 并行等待双方有效提交
    await Promise.all([playerAPromise, playerBPromise])
  }

  private waitForValidSelection(player: Player): Promise<void> {
    return new Promise((resolve, reject) => {
      ;(async () => {
        try {
          while (true) {
            // 等待玩家提交动作
            await this.waitForSelection(player)
            // 验证动作有效性
            if (player.setSelection(player.selection!)) {
              resolve()
              break
            } else {
              // 发送无效操作消息，清空选择并重新等待
              this.emitMessage(
                BattleMessageType.InvalidAction,
                {
                  player: player.id,
                  action: player.selection!.type,
                  reason: 'invalid_action',
                },
                player,
              )
            }
          }
        } catch (error) {
          reject(error)
        }
      })()
    })
  }

  private waitForSelection(player: Player): Promise<void> {
    return new Promise(resolve => {
      const listener: BattleMessageHandler = (message: BattleMessage) => {
        if (message.type === BattleMessageType.TurnAction && player.selection) {
          this.unregisterListener(player, listener)
          resolve()
        }
      }
      this.registerListener(player, listener)
    })
  }

  private unregisterListener(player: Player, callback: BattleMessageHandler) {
    const callbacks = player === this.playerA ? this.playerAMessageCallbacks : this.playerBMessageCallbacks
    const index = callbacks.findIndex(cb => cb === callback)
    if (index !== -1) callbacks.splice(index, 1)
  }

  // 开始对战
  public async startBattle() {
    if (this.status !== BattleStatus.Unstarted) throw '战斗已经开始过了！'
    this.status = BattleStatus.OnBattle
    this.applyEffects(this, EffectTrigger.OnBattleStart)
    this.emitMessage(BattleMessageType.BattleStart, {
      playerA: this.playerA.toMessage(),
      playerB: this.playerB.toMessage(),
    })
    this.emitMessage(BattleMessageType.BattleState, this.toMessage())

    await this.processBattlePhases()

    if ([BattleStatus.OnBattle, BattleStatus.Unstarted].includes(this.status)) {
      this.status = BattleStatus.Ended
    }
  }

  private async processBattlePhases() {
    while (true) {
      if (this.isBattleEnded()) break

      // 阶段1：处理强制换宠
      await this.handleForcedSwitchPhase()
      if (this.isBattleEnded()) break

      // 阶段2：处理击破奖励换宠
      await this.handleFaintSwitchPhase()
      if (this.isBattleEnded()) break
      if (this.pendingDefeatedPlayers.length > 0) {
        continue // 立即跳回阶段一
      }

      // 阶段3：收集指令
      await this.collectSelectionsPhase()
      if (this.isBattleEnded()) break

      // 阶段4：执行回合
      await this.executeTurnPhase()
    }
  }

  private async handleForcedSwitchPhase() {
    this.currentPhase = BattlePhase.SwitchPhase

    // 循环处理直到没有待处理玩家
    while (this.pendingDefeatedPlayers.length > 0) {
      if (this.isBattleEnded()) return
      const playersToHandle = [...this.pendingDefeatedPlayers]
      this.pendingDefeatedPlayers = [] // 清空以避免重复处理

      // 发送强制换宠消息
      this.emitMessage(BattleMessageType.ForcedSwitch, {
        player: playersToHandle.map(p => p.id),
      })

      // 等待所有玩家提交换宠选择
      await Promise.all(
        playersToHandle.map(
          player =>
            new Promise<void>(resolve => {
              const listener = () => {
                if (player.selection?.type === 'switch-pet') {
                  this.unregisterListener(player, listener)
                  resolve()
                }
              }
              this.registerListener(player, listener)
            }),
        ),
      )

      // 执行换宠
      playersToHandle.forEach(player => {
        const selection = player.selection as SwitchPetSelection
        player.performSwitchPet(new SwitchPetContext(this, player, selection.pet))
        player.selection = null

        // 换宠后立即检查新宠物状态
        if (!player.activePet.isAlive) {
          this.pendingDefeatedPlayers.push(player) // 新宠物死亡则重新加入队列
        }
      })
    }
  }

  private async handleFaintSwitchPhase() {
    if (!this.allowFaintSwitch || !this.lastKiller) return

    await new Promise<void>(resolve => {
      this.emitMessage(BattleMessageType.FaintSwitch, {
        player: this.lastKiller!.id,
      })

      const checkSwitch = () => {
        if (this.lastKiller?.selection?.type === 'switch-pet') {
          const switchContext = new SwitchPetContext(
            this,
            this.lastKiller,
            (this.lastKiller.selection as SwitchPetSelection).pet,
          )

          // 执行换宠
          this.lastKiller.performSwitchPet(switchContext)

          if (!this.lastKiller.activePet.isAlive) {
            this.pendingDefeatedPlayers.push(this.lastKiller)
            this.lastKiller = undefined
            resolve()
            return
          }

          this.emitMessage(BattleMessageType.BattleState, this.toMessage())
          resolve()
        }
      }

      const listener = () => checkSwitch()
      this.playerAMessageCallbacks.push(listener)
      this.playerBMessageCallbacks.push(listener)
    })

    this.lastKiller = undefined
  }

  private async collectSelectionsPhase() {
    this.currentPhase = BattlePhase.SelectionPhase
    this.clearSelections()
    await this.collectSelections()
  }

  private async executeTurnPhase() {
    this.currentPhase = BattlePhase.ExecutionPhase
    const turnContext = new TurnContext(this)
    const battleEnded = this.performTurn(turnContext)
    if (battleEnded) this.status = BattleStatus.Ended
    this.clearSelections()
  }

  public isInForcedSwitchPhase(): boolean {
    return this.pendingDefeatedPlayers.length > 0
  }

  public getPendingSwitchPlayer(): Player | undefined {
    return this.pendingDefeatedPlayers.find(player => !player.selection)
  }

  private clearSelections() {
    this.playerA.selection = null
    this.playerB.selection = null
  }

  private bothPlayersReady(): boolean {
    return !!this.playerA.selection && !!this.playerB.selection
  }

  //TODO: 平局
  public getVictor() {
    if (this.status != BattleStatus.Ended && this.isBattleEnded()) throw '战斗未结束'

    if (this.playerA.team.every(pet => !pet.isAlive)) {
      this.emitMessage(BattleMessageType.BattleEnd, { winner: this.playerB.id, reason: 'all_pet_fainted' })
      return this.playerB
    } else if (this.playerB.team.every(pet => !pet.isAlive)) {
      this.emitMessage(BattleMessageType.BattleEnd, { winner: this.playerA.id, reason: 'all_pet_fainted' })
      return this.playerA
    }
    if (this.victor) {
      this.emitMessage(BattleMessageType.BattleEnd, { winner: this.victor.id, reason: 'all_pet_fainted' })
      return this.victor
    }

    throw '不存在胜利者'
  }

  toMessage(viewerId?: string): BattleState {
    return {
      status: this.status,
      currentPhase: this.currentPhase,
      currentTurn: this.currentTurn,
      marks: this.marks.map(m => m.toMessage()),
      players: [this.playerA, this.playerB].map(p => p.toMessage(viewerId)),
    }
  }
}

export enum BattleStatus {
  Unstarted = 'Unstarted',
  OnBattle = 'OnBattle',
  Ended = 'Ended',
}
