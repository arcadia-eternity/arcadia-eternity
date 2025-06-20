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
  type TimerConfig,
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
import { AttributeSystem } from './attributeSystem'
import * as jsondiffpatch from 'jsondiffpatch'
import { nanoid } from 'nanoid'
import mitt from 'mitt'
import { PhaseManager, SwitchPetPhase, TurnPhase } from './phase'
import { TimerManager } from './timer'
import { TransformationSystem } from './transformation'
import { createChildLogger } from './logger'

export class Battle extends Context implements MarkOwner {
  private lastStateMessage: BattleState = {} as BattleState
  public id: string = nanoid()
  private readonly logger = createChildLogger('Battle')

  public allowFaintSwitch: boolean
  public showHidden: boolean

  public readonly parent: null = null
  public readonly battle: Battle = this
  public readonly effectScheduler: EffectScheduler = new EffectScheduler()
  public readonly configSystem: ConfigSystem
  public readonly markSystem: MarkSystem = new MarkSystem(this)
  public readonly phaseManager: PhaseManager = new PhaseManager(this)
  public readonly timerManager: TimerManager
  public readonly transformationSystem: TransformationSystem = new TransformationSystem(this)
  public readonly emitter = mitt<Events>()
  private readonly rng = new Prando(Date.now() ^ (Math.random() * 0x100000000))

  public status: BattleStatus = BattleStatus.Unstarted
  public currentPhase: BattlePhase = BattlePhase.SelectionPhase
  public currentTurn = 0
  private messageCallbacks: Array<{
    original: (message: BattleMessage) => void
    wrapped: (message: BattleMessage) => void
    options?: {
      viewerId?: playerId
      showHidden?: boolean
      showAll?: boolean
    }
    lastState?: BattleState // 每个监听器维护自己的状态
  }> = []
  public lastKiller?: Player
  public marks: MarkInstance[] = [] //用于存放天气一类的效果
  public victor?: Player

  // 用于处理同时更换的状态
  public pendingForcedSwitches: Player[] = [] // 待处理的强制更换
  public pendingFaintSwitch?: Player // 待处理的击破奖励更换
  public isInitialSwitchPhase: boolean = false // 标记是否为初始更换阶段（需要同时执行）

  public readonly petMap: Map<string, Pet> = new Map() // ID -> Pet 实例
  public readonly skillMap: Map<string, SkillInstance> = new Map() // ID -> Skill 实例
  private sequenceId = 0

  constructor(
    public readonly playerA: Player,
    public readonly playerB: Player,
    options?: {
      allowFaintSwitch?: boolean
      rngSeed?: number
      showHidden?: boolean
      timerConfig?: Partial<TimerConfig>
    },
    configSystem?: ConfigSystem,
  ) {
    super(null)
    if (options?.rngSeed) this.rng = new Prando(options.rngSeed)
    // Use provided configSystem or create a new instance for this battle
    this.configSystem = configSystem || ConfigSystem.createInstance(this.id)

    this.allowFaintSwitch = options?.allowFaintSwitch ?? true
    this.showHidden = options?.showHidden ?? false

    // 初始化计时器管理器
    this.timerManager = new TimerManager(this, options?.timerConfig)

    this.playerA.registerBattle(this, this.emitter)
    this.playerB.registerBattle(this, this.emitter)
    ;[...this.playerA.team, ...this.playerB.team].forEach(p => this.petMap.set(p.id, p))
    this.petMap.forEach(p => p.skills.forEach(s => this.skillMap.set(s.id, s)))

    // 初始化玩家计时器
    this.timerManager.initializePlayerTimers([this.playerA.id, this.playerB.id])
  }

  // 注册消息回调
  public registerListener(
    callback: (message: BattleMessage) => void,
    options?: {
      viewerId?: playerId // 显示某一个player的视角
      showHidden?: boolean // 显示所有隐藏信息
      showAll?: boolean // 显示所有信息（等同于showHidden: true且不限制viewerId）
    },
  ) {
    // 为新监听器创建回调对象
    const callbackObj = {
      original: callback,
      wrapped: null as any, // 稍后设置
      options,
      lastState: undefined as BattleState | undefined,
    }

    const wrappedCallback: (message: BattleMessage) => void = (message: BattleMessage) => {
      if (!options) {
        // 默认行为：使用battle的showHidden设置
        callback(message)
        return
      }

      // 使用监听器自己的 lastState 作为基准状态
      const baseState = callbackObj.lastState || {}

      // 根据选项创建定制的消息
      let customMessage: BattleMessage
      let newState: BattleState

      if (options.showAll) {
        // 显示所有信息：使用完整的battle状态
        newState = this.toMessage(undefined, true)
        customMessage = {
          ...message,
          stateDelta: jsondiffpatch.diff(baseState, newState),
        }
      } else if (options.viewerId) {
        // 显示特定玩家视角
        newState = this.toMessage(options.viewerId, options.showHidden ?? false)
        customMessage = {
          ...message,
          stateDelta: jsondiffpatch.diff(baseState, newState),
        }
      } else if (options.showHidden !== undefined) {
        // 仅控制隐藏信息显示
        newState = this.toMessage(undefined, options.showHidden)
        customMessage = {
          ...message,
          stateDelta: jsondiffpatch.diff(baseState, newState),
        }
      } else {
        // 默认行为
        customMessage = message
        newState = this.toMessage('' as playerId, this.showHidden)
      }

      // 更新监听器的状态
      callbackObj.lastState = newState

      callback(customMessage)
    }

    // 设置包装后的回调
    callbackObj.wrapped = wrappedCallback

    this.messageCallbacks.push(callbackObj)
  }

  public unregisterListener(callback: (message: BattleMessage) => void) {
    this.messageCallbacks = this.messageCallbacks.filter(cb => cb.original !== callback)
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
    const currentState = this.toMessage('' as playerId, this.showHidden)
    const stateDelta = jsondiffpatch.diff(this.lastStateMessage, currentState)

    const message: BaseBattleMessage<T> = {
      battleId: this.id,
      type,
      data,
      sequenceId: this.sequenceId++,
      stateDelta: stateDelta,
    }

    // 更新 lastStateMessage 为当前状态
    this.lastStateMessage = currentState

    // 调用所有包装器（每个包装器会使用自己的 lastState）
    this.messageCallbacks.forEach(cb => cb.wrapped(jsondiffpatch.clone(message) as BattleMessage))
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
    // 检查当前需要强制更换的玩家是否有可用的更换选项
    const currentForcedSwitches = [this.playerA, this.playerB].filter(player => !player.activePet.isAlive)
    for (const player of currentForcedSwitches) {
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
      // 停止所有计时器
      this.timerManager.stopAllTimers()
      this.getVictor()
    }

    return isBattleEnded
  }

  // Phase-based battle start (main implementation)
  public async startBattle(): Promise<void> {
    if (this.status != BattleStatus.Unstarted) throw '战斗已经开始过了！'
    this.status = BattleStatus.OnBattle

    // 初始化 lastStateMessage 为空状态，确保第一个消息包含完整的状态差异
    this.lastStateMessage = {} as BattleState

    // 初始化所有监听器的 lastState 为空状态
    this.messageCallbacks.forEach(cb => {
      cb.lastState = {} as BattleState
    })

    this.applyEffects(this, EffectTrigger.OnBattleStart)
    this.emitMessage(BattleMessageType.BattleStart, {})

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
    // 查找需要强制更换但还没有做出选择的玩家
    return (
      this.pendingForcedSwitches.find(player => !player.selection) ||
      (this.pendingFaintSwitch && !this.pendingFaintSwitch.selection ? this.pendingFaintSwitch : undefined)
    )
  }

  private clearSelections() {
    this.playerA.selection = null
    this.playerB.selection = null

    // 通知TimerManager选择状态已清理
    this.timerManager.handlePlayerSelectionChange(this.playerA.id, false)
    this.timerManager.handlePlayerSelectionChange(this.playerB.id, false)
  }

  public setSelection(selection: PlayerSelection): boolean {
    const player = [this.playerA, this.playerB].find(p => p.id === selection.player)
    if (!player) return false
    const result = player.setSelection(selection)
    if (result) {
      this.checkWaitingResolvers()

      // 通知TimerManager玩家选择状态变化
      this.timerManager.handlePlayerSelectionChange(selection.player, true)
    }
    return result
  }

  public getAvailableSelection(playerId: playerId): PlayerSelection[] {
    const player = [this.playerA, this.playerB].find(p => p.id === playerId)
    if (!player) return []
    return player.getAvailableSelection()
  }

  /**
   * 获取玩家计时器状态
   */
  public getPlayerTimerState(playerId: playerId) {
    return this.timerManager.getPlayerState(playerId)
  }

  /**
   * 获取所有玩家计时器状态
   */
  public getAllPlayerTimerStates() {
    return this.timerManager.getAllPlayerStates()
  }

  /**
   * 检查计时器是否启用
   */
  public isTimerEnabled(): boolean {
    return this.timerManager.isEnabled()
  }

  /**
   * 获取计时器配置
   */
  public getTimerConfig() {
    return this.timerManager.getConfig()
  }

  /**
   * 开始动画追踪
   */
  public startAnimation(source: string, expectedDuration: number, ownerId: playerId): string {
    return this.timerManager.startAnimation(source, expectedDuration, ownerId)
  }

  /**
   * 结束动画追踪
   */
  public endAnimation(animationId: string, actualDuration?: number): void {
    this.timerManager.endAnimation(animationId, actualDuration)
  }

  /**
   * 监听计时器事件
   */
  public onTimerEvent<K extends keyof Events>(eventType: K, handler: (data: Events[K]) => void): () => void {
    this.emitter.on(eventType, handler)
    return () => this.emitter.off(eventType, handler)
  }

  /**
   * 移除计时器事件监听器
   */
  public offTimerEvent<K extends keyof Events>(eventType: K, handler: (data: Events[K]) => void): void {
    this.emitter.off(eventType, handler)
  }

  private bothPlayersReady(): boolean {
    return !!this.playerA.selection && !!this.playerB.selection
  }

  public getVictor(surrender = false, reason?: 'surrender' | 'total_time_timeout') {
    if (surrender && this.victor) {
      const battleEndReason = reason || 'surrender'
      this.emitMessage(BattleMessageType.BattleEnd, { winner: this.victor.id, reason: battleEndReason })
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
    this.currentPhase = BattlePhase.Ended
    // 停止所有计时器
    this.timerManager.stopAllTimers()
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

    // 启动切换阶段计时器
    this.timerManager.startSwitchPhase(playersNeedingSelection.map(player => player.id))

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
      // 通知TimerManager选择状态已清理
      this.timerManager.handlePlayerSelectionChange(player.id, false)
    }

    return { battleEnded: false }
  }

  private async handleSelectionPhase(): Promise<void> {
    this.clearSelections()
    this.emitMessage(BattleMessageType.TurnAction, {
      player: [this.playerA.id, this.playerB.id],
    })

    // 启动新回合计时器（重置但不启动，等待前端报告动画开始）
    this.timerManager.startNewTurn([this.playerA.id, this.playerB.id])

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

    // Clean up timer manager
    this.timerManager.cleanup()

    // Clean up all AttributeSystem instances associated with this battle
    const attributeCleanedCount = AttributeSystem.cleanupBattle(this.id)
    if (attributeCleanedCount > 0) {
      this.logger.info(`Battle ${this.id} cleanup: removed ${attributeCleanedCount} AttributeSystem instances`)
    }

    // Clean up all ConfigSystem instances associated with this battle
    const configCleanedCount = ConfigSystem.cleanupBattle(this.id)
    if (configCleanedCount > 0) {
      this.logger.info(`Battle ${this.id} cleanup: removed ${configCleanedCount} ConfigSystem instances`)
    }
  }
}
