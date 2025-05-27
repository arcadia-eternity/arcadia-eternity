import {
  type BaseBattleMessage,
  type BattleMessage,
  type BattleMessageData,
  BattleMessageType,
  BattlePhase,
  type BattleState,
  BattleStatus,
  EffectTrigger,
  type Events,
  type PlayerSelection,
  type SwitchPetSelection,
  type petId,
  type playerId,
  type skillId,
} from '@arcadia-eternity/const'
import Prando from 'prando'
import { ConfigSystem } from './config'
import { AddMarkContext, Context, RemoveMarkContext, type TriggerContextMap } from './context'
import { type EffectContainer, EffectScheduler } from './effect'
import { type MarkOwner } from './entity'
import { type MarkInstance, MarkSystem } from './mark'
import { Pet } from './pet'
import { Player } from './player'
import { SkillInstance } from './skill'
import * as jsondiffpatch from 'jsondiffpatch'
import { nanoid } from 'nanoid'
import mitt from 'mitt'
import { PhaseManager, SwitchPetPhase, TurnPhase } from './phase'

export class Battle extends Context implements MarkOwner {
  private lastStateMessage: BattleState = {} as BattleState
  public id: string = nanoid()

  public allowFaintSwitch: boolean
  public showHidden: boolean

  public readonly parent: null = null
  public readonly battle: Battle = this
  public readonly effectScheduler: EffectScheduler = new EffectScheduler()
  public readonly configSystem: ConfigSystem
  public readonly markSystem: MarkSystem = new MarkSystem(this)
  public readonly phaseManager: PhaseManager = new PhaseManager(this)
  public readonly emitter = mitt<Events>()
  private readonly rng = new Prando(Date.now() ^ (Math.random() * 0x100000000))

  public status: BattleStatus = BattleStatus.Unstarted
  public currentPhase: BattlePhase = BattlePhase.SelectionPhase
  public currentTurn = 0
  private messageCallbacks: Array<(message: BattleMessage) => void> = []
  public pendingDefeatedPlayers: Player[] = [] // 新增：需要在下回合换宠的玩家
  public lastKiller?: Player
  public marks: MarkInstance[] = [] //用于存放天气一类的效果
  public victor?: Player

  // 新增：用于处理同时更换的状态
  public pendingForcedSwitches: Player[] = [] // 待处理的强制更换
  public pendingFaintSwitch?: Player // 待处理的击破奖励更换
  public isInitialSwitchPhase: boolean = false // 标记是否为初始更换阶段（需要同时执行）

  public readonly petMap: Map<string, Pet> = new Map() // ID -> Pet 实例
  public readonly skillMap: Map<string, SkillInstance> = new Map() // ID -> Skill 实例
  private sequenceId = 0

  constructor(
    public readonly playerA: Player,
    public readonly playerB: Player,
    options?: { allowFaintSwitch?: boolean; rngSeed?: number; showHidden?: boolean },
    configSystem?: ConfigSystem,
  ) {
    super(null)
    if (options?.rngSeed) this.rng = new Prando(options.rngSeed)
    // Use provided configSystem or create a new instance for this battle
    this.configSystem = configSystem || ConfigSystem.createInstance()

    // Sync registered config keys from global singleton to battle instance
    const globalConfigSystem = ConfigSystem.getInstance()
    const globalKeys = globalConfigSystem.getRegisteredKeys()

    for (const key of globalKeys) {
      if (!this.configSystem.isRegistered(key)) {
        // Get the current value from global system
        const value = globalConfigSystem.get(key)
        if (value !== undefined) {
          this.configSystem.registerConfig(key, value)
        }
      }
    }

    this.allowFaintSwitch = options?.allowFaintSwitch ?? true
    this.showHidden = options?.showHidden ?? false

    this.playerA.registerBattle(this, this.emitter)
    this.playerB.registerBattle(this, this.emitter)
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
    const message: BaseBattleMessage<T> = {
      type,
      data,
      sequenceId: this.sequenceId++,
      stateDelta: jsondiffpatch.diff(this.lastStateMessage, this.toMessage('' as playerId, this.showHidden)),
    }
    this.lastStateMessage = this.toMessage('' as playerId, this.showHidden)
    this.messageCallbacks.forEach(cb => cb(jsondiffpatch.clone(message) as BattleMessage))
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

  // Turn rage and mark update logic moved to TurnPhase

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
    this.effectScheduler.flushEffects(context)
  }

  // Turn execution logic has been moved to TurnPhase

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

  // Phase-based battle start (main implementation)
  public async startBattle(): Promise<void> {
    if (this.status != BattleStatus.Unstarted) throw '战斗已经开始过了！'
    this.status = BattleStatus.OnBattle
    this.applyEffects(this, EffectTrigger.OnBattleStart)
    this.emitMessage(BattleMessageType.BattleStart, {
      playerA: this.playerA.toMessage(),
      playerB: this.playerB.toMessage(),
    })

    // Main battle loop using phases
    while (true) {
      // Phase 1: Handle switches (forced and faint switches)
      this.currentPhase = BattlePhase.SwitchPhase
      const switchResult = await this.handleSwitchPhase()
      if (switchResult.battleEnded) break

      // Phase 2: Collect player actions
      this.currentPhase = BattlePhase.SelectionPhase
      await this.handleSelectionPhase()

      // Phase 3: Execute turn
      this.currentPhase = BattlePhase.ExecutionPhase
      const turnResult = await this.handleExecutionPhase()
      if (turnResult.battleEnded) break

      this.clearSelections()
    }
  }

  // Legacy generator method removed - use startBattlePhased() instead

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
    const result = player.setSelection(selection)
    if (result) {
      this.checkWaitingResolvers()
    }
    return result
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
    showHidden = showHidden || this.showHidden
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

  // Phase handler methods for the new phase-based battle system

  private async handleSwitchPhase(): Promise<{ battleEnded: boolean }> {
    // 持续处理更换，直到没有更多需要更换的精灵
    while (true) {
      // 收集需要强制更换的玩家
      this.pendingForcedSwitches = [this.playerA, this.playerB].filter(player => !player.activePet.isAlive)

      // 检查是否有击破奖励更换
      // 重要：如果双方都需要强制更换，则不应该有击破奖励更换
      if (this.allowFaintSwitch && this.lastKiller && this.pendingForcedSwitches.length < 2) {
        this.pendingFaintSwitch = this.lastKiller
      } else {
        this.pendingFaintSwitch = undefined
      }

      // 如果没有任何需要更换的情况，退出循环
      if (this.pendingForcedSwitches.length === 0 && !this.pendingFaintSwitch) {
        break
      }

      // 检查战斗是否结束
      if (this.isBattleEnded()) {
        return { battleEnded: true }
      }

      // 判断是否为初始更换阶段（需要同时执行）
      this.isInitialSwitchPhase = this.pendingForcedSwitches.length > 0 || this.pendingFaintSwitch !== undefined

      // 处理初始更换阶段（强制更换和击破奖励更换同时进行）
      if (this.isInitialSwitchPhase) {
        const initialSwitchResult = await this.handleInitialSwitchPhase()
        if (initialSwitchResult.battleEnded) {
          return { battleEnded: true }
        }
      }

      // 重置状态，准备下一轮检查
      this.isInitialSwitchPhase = false
      this.pendingForcedSwitches = []
      this.pendingFaintSwitch = undefined
      this.lastKiller = undefined
    }

    return { battleEnded: false }
  }

  private async handleInitialSwitchPhase(): Promise<{ battleEnded: boolean }> {
    // 收集所有需要做选择的玩家
    const playersNeedingSelection: Player[] = []

    // 添加强制更换的玩家
    playersNeedingSelection.push(...this.pendingForcedSwitches)

    // 添加击破奖励更换的玩家
    if (this.pendingFaintSwitch) {
      playersNeedingSelection.push(this.pendingFaintSwitch)
    }

    // 发送消息通知需要更换
    if (this.pendingForcedSwitches.length > 0) {
      this.emitMessage(BattleMessageType.ForcedSwitch, {
        player: this.pendingForcedSwitches.map(player => player.id),
      })
    }

    if (this.pendingFaintSwitch) {
      this.emitMessage(BattleMessageType.FaintSwitch, {
        player: this.pendingFaintSwitch.id,
      })
    }

    // 等待所有玩家做出选择
    await this.waitForSwitchSelections(playersNeedingSelection)

    // 同时执行所有更换
    for (const player of playersNeedingSelection) {
      if (player.selection?.type === 'switch-pet') {
        const selectionPet = this.getPetByID((player.selection as SwitchPetSelection).pet)
        const switchPhase = new SwitchPetPhase(this, player, selectionPet, this)
        await switchPhase.initialize()
        await switchPhase.execute()
      }
      player.selection = null
    }

    return { battleEnded: false }
  }

  private async handleSelectionPhase(): Promise<void> {
    this.clearSelections()
    this.emitMessage(BattleMessageType.TurnAction, {
      player: [this.playerA.id, this.playerB.id],
    })

    // Wait for both players to make selections
    await this.waitForBothPlayersReady()
  }

  private async handleExecutionPhase(): Promise<{ battleEnded: boolean }> {
    const turnPhase = new TurnPhase(this)
    await turnPhase.initialize()
    await turnPhase.execute()

    return { battleEnded: this.isBattleEnded() }
  }

  // Event-driven waiting methods (no timers)
  private waitingResolvers: {
    switchSelections?: { players: Player[]; resolve: () => void }
    bothPlayersReady?: { resolve: () => void }
  } = {}

  private async waitForSwitchSelections(players: Player[]): Promise<void> {
    // Check if already ready
    // 对于强制更换，必须选择switch-pet
    // 对于击破奖励更换，可以选择switch-pet或do-nothing
    const allReady = players.every(player => {
      if (!player.selection) return false

      // 如果是强制更换的玩家，必须选择switch-pet
      if (this.pendingForcedSwitches.includes(player)) {
        return player.selection.type === 'switch-pet'
      }

      // 如果是击破奖励更换的玩家，可以选择switch-pet或do-nothing
      if (this.pendingFaintSwitch === player) {
        return player.selection.type === 'switch-pet' || player.selection.type === 'do-nothing'
      }

      return false
    })

    if (allReady) {
      return
    }

    return new Promise<void>(resolve => {
      this.waitingResolvers.switchSelections = { players, resolve }
    })
  }

  private async waitForBothPlayersReady(): Promise<void> {
    // Check if already ready
    if (this.bothPlayersReady()) {
      return
    }

    return new Promise<void>(resolve => {
      this.waitingResolvers.bothPlayersReady = { resolve }
    })
  }

  // Called when a player makes a selection to check if any waiting promises should resolve
  private checkWaitingResolvers(): void {
    // Check switch selections
    if (this.waitingResolvers.switchSelections) {
      const { players, resolve } = this.waitingResolvers.switchSelections

      // 使用与waitForSwitchSelections相同的逻辑检查是否所有玩家都准备好了
      const allReady = players.every(player => {
        if (!player.selection) return false

        // 如果是强制更换的玩家，必须选择switch-pet
        if (this.pendingForcedSwitches.includes(player)) {
          return player.selection.type === 'switch-pet'
        }

        // 如果是击破奖励更换的玩家，可以选择switch-pet或do-nothing
        if (this.pendingFaintSwitch === player) {
          return player.selection.type === 'switch-pet' || player.selection.type === 'do-nothing'
        }

        return false
      })

      if (allReady) {
        this.waitingResolvers.switchSelections = undefined
        resolve()
      }
    }

    // Check both players ready
    if (this.waitingResolvers.bothPlayersReady) {
      const { resolve } = this.waitingResolvers.bothPlayersReady
      if (this.bothPlayersReady()) {
        this.waitingResolvers.bothPlayersReady = undefined
        resolve()
      }
    }
  }

  public async cleanup() {
    this.clearListeners()
    await this.phaseManager.cleanup()
  }
}
