import {
  type BattleMessage,
  type BattleMessageData,
  BattleMessageType,
  BattlePhase,
  type BattleState,
  BattleStatus,
  EffectTrigger,
  type PlayerSelection,
  RAGE_PER_TURN,
  type SwitchPetSelection,
  type petId,
  type playerId,
  type skillId,
} from '@test-battle/const'
import Prando from 'prando'
import { ConfigSystem } from './config'
import {
  AddMarkContext,
  Context,
  RageContext,
  RemoveMarkContext,
  SwitchPetContext,
  type TriggerContextMap,
  TurnContext,
  UseSkillContext,
} from './context'
import { type EffectContainer, EffectScheduler } from './effect'
import { type MarkOwner } from './entity'
import { type MarkInstance, MarkSystem } from './mark'
import { Pet } from './pet'
import { Player } from './player'
import { SkillInstance } from './skill'

export class Battle extends Context implements MarkOwner {
  public readonly parent: null = null
  public readonly battle: Battle = this
  public readonly effectScheduler: EffectScheduler = new EffectScheduler()
  public readonly configSystem: ConfigSystem = ConfigSystem.getInstance()
  public readonly markSystem: MarkSystem = new MarkSystem(this)
  private readonly rng = new Prando(Date.now() ^ (Math.random() * 0x100000000))

  public status: BattleStatus = BattleStatus.Unstarted
  public currentPhase: BattlePhase = BattlePhase.SelectionPhase
  public currentTurn = 0
  private messageCallbacks: Array<(message: BattleMessage) => void> = []
  public pendingDefeatedPlayers: Player[] = [] // 新增：需要在下回合换宠的玩家
  public allowFaintSwitch: boolean
  public lastKiller?: Player
  public marks: MarkInstance[] = [] //用于存放天气一类的效果
  public victor?: Player

  public readonly petMap: Map<string, Pet> = new Map() // ID -> Pet 实例
  public readonly skillMap: Map<string, SkillInstance> = new Map() // ID -> Skill 实例

  constructor(
    public readonly playerA: Player,
    public readonly playerB: Player,
    options?: { allowFaintSwitch?: boolean; rngSeed?: number },
    configSystem?: ConfigSystem,
  ) {
    super(null)
    if (options?.rngSeed) this.rng = new Prando(options.rngSeed)
    if (configSystem) this.configSystem = configSystem
    this.allowFaintSwitch = options?.allowFaintSwitch ?? true

    this.playerA.registerBattle(this)
    this.playerB.registerBattle(this)
    ;[...this.playerA.team, ...this.playerB.team].forEach(p => this.petMap.set(p.id, p))
    this.petMap.forEach(p => p.skills.forEach(s => this.skillMap.set(s.id, s)))
  }

  // 注册消息回调
  public registerListener(callback: (message: BattleMessage) => void) {
    this.messageCallbacks.push(callback)
  }

  public unregisterListener(callback: (message: BattleMessage) => void) {
    this.messageCallbacks = this.messageCallbacks.filter(cb => cb !== callback)
  }

  clearListeners() {
    this.messageCallbacks = []
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
  public emitMessage<T extends BattleMessageType>(type: T, data: BattleMessageData[T]) {
    const message: BattleMessage = {
      type,
      data,
      timestamp: Date.now(),
    } as BattleMessage
    this.messageCallbacks.forEach(cb => cb(message))
  }

  public addMark(context: AddMarkContext) {
    this.markSystem.addMark(this, context)
  }

  public removeMark(context: RemoveMarkContext) {
    this.markSystem.removeMark(this, context)
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

  public getPlayerByID(id: playerId): Player {
    const player = [this.playerA, this.playerB].find(p => p.id === id)
    if (!player) throw new Error('Unknown player')
    return player
  }

  public getPetByID(id: petId): Pet {
    const pet = this.petMap.get(id)
    if (!pet) throw new Error('Unknown pet')
    return pet
  }

  public getSkillByID(id: skillId): SkillInstance {
    const skill = this.skillMap.get(id)
    if (!skill) throw new Error('Unknown skill')
    return skill
  }

  public applyEffects<T extends EffectTrigger>(
    context: TriggerContextMap[T],
    trigger: T,
    ...target: EffectContainer[]
  ) {
    let effectContainers = [...target]
    if (target.length == 0)
      effectContainers = [
        ...this.marks,
        ...this.playerA.team.map(p => p.marks).flat(),
        ...this.playerB.team.map(p => p.marks).flat(),
        ...this.playerA.team.map(p => p.skills).flat(),
        ...this.playerB.team.map(p => p.skills).flat(),
      ]

    // 阶段1：收集所有待触发效果
    effectContainers.forEach(container => container.collectEffects(trigger, context))

    // 阶段2：按全局优先级执行
    this.effectScheduler.flushEffects()
  }

  // 执行对战回合
  private performTurn(context: TurnContext): boolean {
    if (!this.playerA.selection || !this.playerB.selection) throw '有人还未选择好！'

    for (const selection of [this.playerA.selection, this.playerB.selection]) {
      const player = this.getPlayerByID(selection.player)
      switch (selection.type) {
        case 'use-skill': {
          const skill = this.getSkillByID(selection.skill)
          const skillContext = new UseSkillContext(context, player, player.activePet, skill.target, skill)
          this.battle.applyEffects(skillContext, EffectTrigger.BeforeSort)
          context.contexts.push(skillContext)
          break
        }
        case 'switch-pet': {
          const pet = this.getPetByID(selection.pet)
          const switchContext = new SwitchPetContext(context, player, pet)
          context.contexts.push(switchContext)
          break
        }
        case 'do-nothing':
          //确实啥都没干
          break
        case 'surrender': {
          const player = this.getPlayerByID(selection.player)
          this.victor = this.getOpponent(player)

          this.status = BattleStatus.Ended
          this.getVictor(true)
          return true
        }
        default:
          throw '未知的context'
      }
    }
    context.contexts.sort(this.contextSort)

    this.currentTurn++

    this.emitMessage(BattleMessageType.TurnStart, {
      round: this.currentTurn,
    })

    this.applyEffects(context, EffectTrigger.TurnStart)

    while (context.contexts.length > 0) {
      const nowContext = context.contexts.pop()
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
      return true
    }

    return false
  }

  private isBattleEnded(): boolean {
    if (this.status === BattleStatus.Ended) return true
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
    }
    if (playerAisDefeat && !playerBisDefeat) this.victor = this.playerB
    if (playerBisDefeat && !playerAisDefeat) this.victor = this.playerA

    if (isBattleEnded) {
      this.status = BattleStatus.Ended
      this.currentPhase = BattlePhase.Ended
      this.getVictor()
    }

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
        if (aSkill.priority !== bSkill.priority) {
          return aSkill.priority - bSkill.priority
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

  // 开始对战
  public *startBattle(): Generator<void, void, void> {
    if (this.status != BattleStatus.Unstarted) throw '战斗已经开始过了！'
    this.status = BattleStatus.OnBattle
    this.applyEffects(this, EffectTrigger.OnBattleStart)
    this.emitMessage(BattleMessageType.BattleStart, {
      playerA: this.playerA.toMessage(),
      playerB: this.playerB.toMessage(),
    })
    this.emitMessage(BattleMessageType.BattleState, this.toMessage())

    turnLoop: while (true) {
      // 阶段1：处理强制换宠
      this.currentPhase = BattlePhase.SwitchPhase
      while (!(this.playerA.activePet.isAlive && this.playerB.activePet.isAlive)) {
        this.pendingDefeatedPlayers = [this.playerA, this.playerB].filter(player => !player.activePet.isAlive)
        if (this.isBattleEnded()) {
          break turnLoop
        }

        if (this.pendingDefeatedPlayers.length > 0) {
          this.emitMessage(BattleMessageType.ForcedSwitch, {
            player: this.pendingDefeatedPlayers.map(player => player.id),
          })
          while (
            ![...this.pendingDefeatedPlayers].every(player => player.selection && player.selection.type == 'switch-pet')
          ) {
            yield
          }
          ;[...this.pendingDefeatedPlayers].forEach(player => {
            const selectionPet = this.getPetByID((player.selection as SwitchPetSelection).pet)
            player.performSwitchPet(new SwitchPetContext(this.battle!, player, selectionPet))
            player.selection = null
          })
        }
      }
      this.pendingDefeatedPlayers = []

      // 阶段2：击败方换宠
      if (this.allowFaintSwitch && this.lastKiller) {
        this.battle!.emitMessage(BattleMessageType.FaintSwitch, {
          player: this.lastKiller.id,
        })
        while (!this.lastKiller.selection) {
          yield // 等待玩家选择换宠
        }

        if (this.lastKiller.selection?.type === 'switch-pet') {
          const selectionPet = this.getPetByID((this.lastKiller.selection as SwitchPetSelection).pet)
          const switchContext = new SwitchPetContext(this, this.lastKiller, selectionPet)
          // 执行换宠并触发相关效果
          this.lastKiller.performSwitchPet(switchContext)
          this.emitMessage(BattleMessageType.BattleState, this.toMessage())

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
      this.emitMessage(BattleMessageType.TurnAction, {
        player: [this.playerA.id, this.playerB.id],
      })
      while (!this.bothPlayersReady()) {
        yield
      }

      // 阶段4：执行回合
      this.currentPhase = BattlePhase.ExecutionPhase
      const turnContext: TurnContext = new TurnContext(this)
      if (this.performTurn(turnContext)) break turnLoop
      this.clearSelections()
    }
    return
  }

  public getPendingSwitchPlayer(): Player | undefined {
    return this.pendingDefeatedPlayers.find(player => !player.selection)
  }

  private clearSelections() {
    this.playerA.selection = null
    this.playerB.selection = null
  }

  public setSelection(selection: PlayerSelection): boolean {
    const player = [this.playerA, this.playerB].find(p => p.id === selection.player)
    if (!player) return false
    return player.setSelection(selection)
  }

  public getAvailableSelection(playerId: playerId): PlayerSelection[] {
    const player = [this.playerA, this.playerB].find(p => p.id === playerId)
    if (!player) return []
    return player.getAvailableSelection()
  }

  private bothPlayersReady(): boolean {
    return !!this.playerA.selection && !!this.playerB.selection
  }

  public getVictor(surrender = false) {
    if (surrender && this.victor) {
      this.emitMessage(BattleMessageType.BattleEnd, { winner: this.victor.id, reason: 'surrender' })
      return this.victor
    }
    if (this.status != BattleStatus.Ended && this.isBattleEnded()) throw '战斗未结束'

    const playerAloose = this.playerA.team.every(pet => !pet.isAlive)
    const playerBloose = this.playerB.team.every(pet => !pet.isAlive)

    if (playerAloose && playerBloose) {
      this.emitMessage(BattleMessageType.BattleEnd, { winner: null, reason: 'all_pet_fainted' })
      return undefined
    } else if (playerAloose) {
      this.emitMessage(BattleMessageType.BattleEnd, { winner: this.playerB.id, reason: 'all_pet_fainted' })
      return this.playerB
    } else if (playerBloose) {
      this.emitMessage(BattleMessageType.BattleEnd, { winner: this.playerA.id, reason: 'all_pet_fainted' })
      return this.playerA
    }

    throw '不存在胜利者'
  }

  public abandonPlayer(playerId: playerId) {
    const abandonPlayer = [this.playerA, this.playerB].find(v => v.id === playerId)
    if (!abandonPlayer) return
    this.victor = this.getOpponent(abandonPlayer)
    this.status = BattleStatus.Ended
    this.getVictor(true)
  }

  toMessage(viewerId?: playerId, showHidden = false): BattleState {
    return {
      status: this.status,
      currentPhase: this.currentPhase,
      currentTurn: this.currentTurn,
      marks: this.marks.map(m => m.toMessage()),
      players: [this.playerA, this.playerB].map(p => p.toMessage(viewerId, showHidden)),
    }
  }

  public getState(viewerId?: playerId, showHidden = false): BattleState {
    return this.toMessage(viewerId, showHidden)
  }

  public cleanup() {
    this.clearListeners()
  }
}
