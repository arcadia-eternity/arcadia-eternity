import { Skill } from './skill'
import { Pet } from './pet'
import { RAGE_PER_TURN, AttackTargetOpinion } from './const'
import {
  AddMarkContext,
  Context,
  RageContext,
  RemoveMarkContext,
  SwitchPetContext,
  TurnContext,
  UseSkillContext,
} from './context'
import { BattleMessage, BattleMessageType, BattleMessageData } from './message'
import { Player } from './player'
import prand from 'pure-rand'
import { Mark } from './mark'
import { EffectContainer, EffectScheduler, EffectTrigger } from './effect'

export enum BattlePhase {
  SwitchPhase = 'SWITCH_PHASE',
  SelectionPhase = 'SELECTION_PHASE',
  ExecutionPhase = 'EXECUTION_PHASE',
  Ended = 'ENDED',
}

// 对战系统
export class BattleSystem extends Context {
  public readonly parent: null = null
  public readonly battle: BattleSystem = this

  public status: BattleStatus = BattleStatus.Unstarted
  public currentPhase: BattlePhase = BattlePhase.SelectionPhase
  public currentTurn = 0
  private messageCallbacks: Array<(message: BattleMessage) => void> = []
  public pendingDefeatedPlayers: Player[] = [] // 新增：需要在下回合换宠的玩家
  public allowKillerSwitch: boolean
  public lastKiller?: Player
  public marks: Mark[] = [] //用于存放天气一类的效果
  private rng: prand.RandomGenerator = prand.xoroshiro128plus(Date.now() ^ (Math.random() * 0x100000000))

  constructor(
    public readonly playerA: Player,
    public readonly playerB: Player,
    options?: { allowKillerSwitch?: boolean; rngSeed?: number },
  ) {
    super(null)
    this.allowKillerSwitch = options?.allowKillerSwitch ?? true
    if (options?.rngSeed) this.rng = prand.xoroshiro128plus(options.rngSeed)
    this.playerA.registerBattle(this)
    this.playerB.registerBattle(this)
  }

  // 注册消息回调
  public onMessage(callback: (message: BattleMessage) => void) {
    this.messageCallbacks.push(callback)
  }

  public random() {
    return prand.unsafeUniformIntDistribution(0, 1, this.rng)
  }

  // 发送消息给所有回调
  public emitMessage<T extends BattleMessageType>(type: T, data: BattleMessageData[T]) {
    const message: BattleMessage = {
      type,
      data,
      timestamp: Date.now(),
    } as BattleMessage
    this.messageCallbacks.forEach(cb => cb(message))
  }

  public addMark(ctx: AddMarkContext) {
    const existingMark = this.marks.find(mark => mark.id === ctx.mark.id)
    if (existingMark) {
      existingMark.tryStack(ctx)
    } else {
      const newMark = ctx.mark.clone()
      this.marks.push(newMark)
      newMark.attachTo(this)
    }
  }

  public removeMark(ctx: RemoveMarkContext) {
    this.marks = this.marks.filter(mark => mark.id !== ctx.mark.id)
  }

  public getOpponent(player: Player) {
    if (player === this.playerA) return this.playerB
    return this.playerA
  }

  private addTurnRage(ctx: TurnContext) {
    ;[this.playerA, this.playerB].forEach(player => {
      player.addRage(new RageContext(ctx, player, 'turn', 'add', RAGE_PER_TURN))
    })
  }

  //TODO: addContext
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private updateTurnMark(_: TurnContext) {
    ;[this.playerA, this.playerB].forEach(player => {
      player.activePet.marks.forEach(mark => mark.update())
      player.activePet.marks = player.activePet.marks.filter(mark => mark.isActive)
    })
  }

  public applyEffects(ctx: Context, trigger: EffectTrigger) {
    const effectContainers: EffectContainer[] = [
      ...this.marks,
      ...this.playerA.activePet.marks,
      ...this.playerB.activePet.marks,
    ]

    if (ctx instanceof UseSkillContext) {
      effectContainers.push(ctx.skill)
    }

    // 阶段1：收集所有待触发效果
    effectContainers.forEach(container => container.collectEffects(trigger, ctx))

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

    contextpop: while (contexts.length > 0) {
      const context = contexts.pop()
      if (!context) break
      switch (context.type) {
        case 'use-skill': {
          const _context = context as UseSkillContext
          if (_context.origin.performAttack(_context)) break contextpop
          break
        }
        case 'switch-pet': {
          const _context = context as SwitchPetContext
          _context.origin.performSwitchPet(_context)
          break
        }
      }
    }

    this.applyEffects(context, EffectTrigger.TurnEnd)
    this.addTurnRage(context) // 每回合结束获得怒气
    this.updateTurnMark(context)

    // 战斗结束后重置状态
    if (this.isBattleEnded()) {
      this.status = BattleStatus.Ended
      return true
    }

    return false
  }

  private isBattleEnded(): boolean {
    // 检查强制换宠失败
    for (const player of this.pendingDefeatedPlayers) {
      const available = player.getAvailableSwitch()
      if (available.length === 0) return true
    }
    // 检查队伍存活状态
    return this.playerA.team.every(p => !p.isAlive) || this.playerB.team.every(p => !p.isAlive)
  }

  private contextSort(a: Context, b: Context): number {
    // 类型优先级：换宠 > 印记效果 > 使用技能
    const typeOrder: Record<Context['type'], number> = {
      'switch-pet': 2,
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
        if (aSkill.pet.stat.spd !== bSkill.pet.stat.spd) {
          return aSkill.pet.stat.spd - bSkill.pet.stat.spd
        }

        // 速度相同,始终是a先手
        return 1
      }
      default:
        return 1
    }
  }

  // 开始对战
  public *startBattle(): Generator<void, void, void> {
    if (this.status != BattleStatus.Unstarted) throw '战斗已经开始过了！'
    this.status = BattleStatus.OnBattle
    this.emitMessage(BattleMessageType.BattleStart, {
      playerA: this.playerA.name,
      playerB: this.playerB.name,
      pets: {
        playerA: this.playerA.activePet.name,
        playerB: this.playerB.activePet.name,
      },
    })

    while (true) {
      // 阶段1：处理强制换宠
      this.currentPhase = BattlePhase.SwitchPhase
      while (!(this.playerA.activePet.isAlive && this.playerB.activePet.isAlive)) {
        this.pendingDefeatedPlayers = [this.playerA, this.playerB].filter(player => !player.activePet.isAlive)
        if (this.isBattleEnded()) {
          this.status = BattleStatus.Ended
          return
        }

        if (this.pendingDefeatedPlayers.length > 0) {
          while (
            ![...this.pendingDefeatedPlayers].every(player => player.selection && player.selection.type == 'switch-pet')
          ) {
            yield
          }
          ;[...this.pendingDefeatedPlayers].forEach(player => {
            player.performSwitchPet(
              new SwitchPetContext(this.battle!, player, (player.selection as SwitchPetSelection).pet),
            )
            player.selection = null
          })
        }
      }
      this.pendingDefeatedPlayers = []

      // 阶段2：击败方换宠
      if (this.allowKillerSwitch && this.lastKiller) {
        this.battle!.emitMessage(BattleMessageType.KillerSwitch, {
          player: this.lastKiller.name,
          available: this.battle!.allowKillerSwitch,
        })
        yield // 等待玩家选择换宠

        if (this.lastKiller.selection?.type === 'switch-pet') {
          const switchContext = new SwitchPetContext(
            this,
            this.lastKiller,
            (this.lastKiller.selection as SwitchPetSelection).pet,
          )

          // 执行换宠并触发相关效果
          this.lastKiller.performSwitchPet(switchContext)

          // 立即检查新宠物状态
          if (!this.lastKiller.activePet.isAlive) {
            this.pendingDefeatedPlayers.push(this.lastKiller)
            this.lastKiller = undefined
            continue // 直接跳回阶段1处理
          }
        }
        this.lastKiller = undefined
      }

      // 阶段3：收集玩家指令
      this.currentPhase = BattlePhase.SelectionPhase
      this.clearSelections()
      while (!this.bothPlayersReady()) {
        yield
      }

      // 阶段4：执行回合
      this.currentPhase = BattlePhase.ExecutionPhase
      const turnContext: TurnContext = new TurnContext(this)
      if (this.performTurn(turnContext)) break
      this.clearSelections()
    }
    this.status = BattleStatus.Ended
    this.currentPhase = BattlePhase.Ended
    return
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

  public getVictor() {
    if (this.status != BattleStatus.Ended) throw '战斗未结束'
    if (this.playerA.team.every(pet => !pet.isAlive)) {
      this.emitMessage(BattleMessageType.BattleEnd, { winner: this.playerB.name, reason: 'all_pet_fainted' })
      return this.playerB
    } else if (this.playerB.team.every(pet => !pet.isAlive)) {
      this.emitMessage(BattleMessageType.BattleEnd, { winner: this.playerA.name, reason: 'all_pet_fainted' })
      return this.playerA
    }
    throw '不存在胜利者'
  }
}

export type PlayerSelection = UseSkillSelection | SwitchPetSelection | DoNothingSelection
export type PlayerSelections = { player: Player; selections: PlayerSelection[] }

export type UseSkillSelection = { source: Player; type: 'use-skill'; skill: Skill; target: AttackTargetOpinion }
export type SwitchPetSelection = { source: Player; type: 'switch-pet'; pet: Pet }
export type DoNothingSelection = { source: Player; type: 'do-nothing' }

export enum BattleStatus {
  Unstarted = 'Unstarted',
  OnBattle = 'On',
  Ended = 'Ended',
}
