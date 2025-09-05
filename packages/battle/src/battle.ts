import {
  type BaseBattleMessage,
  type BattleMessage,
  type BattleMessageData,
  BattleMessageType,
  BattlePhase,
  type BattleState,
  BattleStatus,
  type BattleTeamSelection,
  EffectTrigger,
  type Events,
  type petId,
  type playerId,
  type PlayerSelection,
  type skillId,
  type TimerConfig,
} from '@arcadia-eternity/const'
import * as jsondiffpatch from 'jsondiffpatch'
import mitt from 'mitt'
import { nanoid } from 'nanoid'
import Prando from 'prando'
import { AttributeSystem } from './attributeSystem'
import { ConfigSystem } from './config'
import { Context, type TriggerContextMap } from './context'
import { type EffectContainer } from './effect'
import { type MarkOwner } from './entity'
import { createChildLogger } from './logger'
import { type MarkInstance } from './mark'
import { Pet } from './pet'
import { BattleLoopPhase, BattleStartPhase, TeamSelectionPhase } from './phases'
import { PhaseManager } from './phaseManager'
import { EffectExecutionPhase } from './phases/effectExecution'
import { AIPlayer, Player } from './player'
import { SkillInstance } from './skill'
import { TimerManager } from './timer'
import { TransformationSystem } from './transformation'

export class Battle extends Context implements MarkOwner {
  private lastStateMessage: BattleState = {} as BattleState
  public id: string = nanoid()
  private readonly logger = createChildLogger('Battle')

  public allowFaintSwitch: boolean
  public showHidden: boolean
  public readonly teamSelectionConfig: {
    enabled: boolean
    mode: 'VIEW_ONLY' | 'TEAM_SELECTION' | 'FULL_TEAM'
    maxTeamSize: number
    minTeamSize: number
    allowStarterSelection: boolean
    showOpponentTeam: boolean
    teamInfoVisibility: 'HIDDEN' | 'BASIC' | 'FULL'
    timeLimit: number
  }

  public readonly parent: null = null
  public readonly battle: Battle = this
  public readonly configSystem: ConfigSystem
  public readonly phaseManager: PhaseManager = new PhaseManager(this)
  public readonly timerManager: TimerManager
  public readonly transformationSystem: TransformationSystem = new TransformationSystem(this)
  public readonly emitter = mitt<Events>()
  private readonly rng = new Prando(Date.now() ^ (Math.random() * 0x100000000))

  public status: BattleStatus = BattleStatus.Unstarted
  public currentPhase: BattlePhase = BattlePhase.SelectionPhase
  public currentTurn = 0
  private _isStarting: boolean = false // 防止重复启动的标志
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
      teamSelection?: {
        enabled: boolean
        config?: {
          mode?: 'VIEW_ONLY' | 'TEAM_SELECTION' | 'FULL_TEAM'
          maxTeamSize?: number
          minTeamSize?: number
          allowStarterSelection?: boolean
          showOpponentTeam?: boolean
          teamInfoVisibility?: 'HIDDEN' | 'BASIC' | 'FULL'
          timeLimit?: number
        }
      }
      customConfig?: Record<string, any>
    },
    configSystem?: ConfigSystem,
  ) {
    super(null)
    if (options?.rngSeed) this.rng = new Prando(options.rngSeed)
    // Use provided configSystem or create a new instance for this battle
    this.configSystem = configSystem || ConfigSystem.createInstance(this.id)

    this.allowFaintSwitch = options?.allowFaintSwitch ?? true
    this.showHidden = options?.showHidden ?? false

    // Initialize team selection configuration
    // Check both direct teamSelection option and customConfig.teamSelection
    const teamSelectionFromCustom = options?.customConfig?.teamSelection
    const teamSelectionDirect = options?.teamSelection

    this.teamSelectionConfig = {
      enabled: teamSelectionFromCustom?.enabled ?? teamSelectionDirect?.enabled ?? false,
      mode: teamSelectionFromCustom?.config?.mode ?? teamSelectionDirect?.config?.mode ?? 'TEAM_SELECTION',
      maxTeamSize: teamSelectionFromCustom?.config?.maxTeamSize ?? teamSelectionDirect?.config?.maxTeamSize ?? 6,
      minTeamSize: teamSelectionFromCustom?.config?.minTeamSize ?? teamSelectionDirect?.config?.minTeamSize ?? 1,
      allowStarterSelection:
        teamSelectionFromCustom?.config?.allowStarterSelection ??
        teamSelectionDirect?.config?.allowStarterSelection ??
        true,
      showOpponentTeam:
        teamSelectionFromCustom?.config?.showOpponentTeam ?? teamSelectionDirect?.config?.showOpponentTeam ?? false,
      teamInfoVisibility:
        teamSelectionFromCustom?.config?.teamInfoVisibility ??
        teamSelectionDirect?.config?.teamInfoVisibility ??
        'HIDDEN',
      timeLimit: teamSelectionFromCustom?.config?.timeLimit ?? teamSelectionDirect?.config?.timeLimit ?? 60,
    }

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
      const j = Math.floor(this.random() * (i + 1))
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

  public getOpponent(player: Player) {
    if (player === this.playerA) return this.playerB
    return this.playerA
  }

  // Turn rage and mark update logic moved to TurnPhase
  // cleanupMarks logic moved to MarkCleanupPhase

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

    // Use EffectExecutionPhase managed by PhaseManager
    const effectExecutionPhase = new EffectExecutionPhase(this, context, trigger, effectContainers)
    this.phaseManager.registerPhase(effectExecutionPhase)
    this.phaseManager.executePhase(effectExecutionPhase.id)
  }

  // Turn execution logic has been moved to TurnPhase

  public isBattleEnded(): boolean {
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
    const playerAisDefeat = this.playerA.effectiveTeam.every(p => !p.isAlive)
    const playerBisDefeat = this.playerB.effectiveTeam.every(p => !p.isAlive)
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

  /**
   * Check if team selection phase is needed
   */
  private needsTeamSelection(): boolean {
    return this.teamSelectionConfig.enabled
  }

  /**
   * Validate team selection for a player
   */
  public validateTeamSelection(
    playerId: playerId,
    selection: BattleTeamSelection,
  ): { isValid: boolean; errors: string[] } {
    const player = this.getPlayerByID(playerId)
    if (!player) {
      return { isValid: false, errors: ['Player not found'] }
    }

    const errors: string[] = []
    const config = this.teamSelectionConfig

    // Check that all selected pets exist in player's full team
    const fullTeamIds = new Set(player.fullTeam.map((pet: Pet) => pet.id))
    for (const petId of selection.selectedPets) {
      if (!fullTeamIds.has(petId)) {
        errors.push(`Pet ${petId} not found in player's team`)
      }
    }

    // Check for duplicates
    const uniquePets = new Set(selection.selectedPets)
    if (uniquePets.size !== selection.selectedPets.length) {
      errors.push('Duplicate pets in selection')
    }

    // Check team size constraints using battle configuration
    const teamSize = selection.selectedPets.length
    if (teamSize < config.minTeamSize) {
      errors.push(`Team size ${teamSize} is below minimum ${config.minTeamSize}`)
    }
    if (teamSize > config.maxTeamSize) {
      errors.push(`Team size ${teamSize} exceeds maximum ${config.maxTeamSize}`)
    }

    // Check that selected pets are alive
    for (const petId of selection.selectedPets) {
      const pet = player.fullTeam.find((p: Pet) => p.id === petId)
      if (pet && !pet.isAlive) {
        errors.push(`Pet ${petId} is not alive`)
      }
    }

    // Check starter pet if starter selection is allowed
    if (config.allowStarterSelection) {
      if (!selection.starterPetId) {
        errors.push('Starter pet must be selected')
      } else if (!selection.selectedPets.includes(selection.starterPetId)) {
        errors.push('Starter pet must be in selected team')
      } else {
        const starterPet = player.fullTeam.find((p: Pet) => p.id === selection.starterPetId)
        if (starterPet && !starterPet.isAlive) {
          errors.push('Starter pet must be alive')
        }
      }
    }

    return { isValid: errors.length === 0, errors }
  }

  /**
   * Apply team selection to a player
   */
  public applyTeamSelection(playerId: playerId, selection: BattleTeamSelection): boolean {
    const validation = this.validateTeamSelection(playerId, selection)
    if (!validation.isValid) {
      this.logger.warn({ playerId, selection, errors: validation.errors }, 'Invalid team selection')
      return false
    }

    const player = this.getPlayerByID(playerId)
    if (!player) {
      return false
    }

    player.applyTeamSelection(selection)
    return true
  }

  /**
   * Re-initialize battle maps after team selection
   * This is needed because the initial maps are built from player.team,
   * but after team selection, the effective teams may be different
   */
  private reinitializeBattleMaps(): void {
    // Clear existing maps
    this.petMap.clear()
    this.skillMap.clear()

    // Re-populate with effective teams (battleTeam or team)
    const allPets = [...this.playerA.effectiveTeam, ...this.playerB.effectiveTeam]
    allPets.forEach(pet => this.petMap.set(pet.id, pet))
    this.petMap.forEach(pet => pet.skills.forEach(skill => this.skillMap.set(skill.id, skill)))
  }

  // Phase-based battle start (main implementation)
  public async startBattle(): Promise<void> {
    // 防止重复启动的检查
    if (this._isStarting) {
      this.logger.warn({ battleId: this.id }, 'Battle is already starting, ignoring duplicate startBattle call')
      return
    }

    if (this.status !== BattleStatus.Unstarted) {
      this.logger.warn(
        { battleId: this.id, currentStatus: this.status },
        'Battle has already started, ignoring startBattle call',
      )
      return
    }

    // 设置启动标志
    this._isStarting = true

    try {
      // Phase 0: Team selection (if needed) - MUST be before battle initialization
      if (this.needsTeamSelection()) {
        this.currentPhase = BattlePhase.TeamSelectionPhase
        const teamSelectionPhase = new TeamSelectionPhase(this, this.teamSelectionConfig)
        this.phaseManager.registerPhase(teamSelectionPhase)
        await this.phaseManager.executePhaseAsync(teamSelectionPhase.id)

        // Re-initialize battle maps after team selection
        this.reinitializeBattleMaps()
      }

      // Phase 1: Initialize battle
      this.currentPhase = BattlePhase.StartPhase
      const startPhase = new BattleStartPhase(this)
      this.phaseManager.registerPhase(startPhase)
      await this.phaseManager.executePhaseAsync(startPhase.id)

      // Phase 2: Main battle loop
      const battleLoopPhase = new BattleLoopPhase(this)
      this.phaseManager.registerPhase(battleLoopPhase)
      await this.phaseManager.executePhaseAsync(battleLoopPhase.id)
    } finally {
      // 无论成功还是失败，都要清除启动标志
      this._isStarting = false
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

  public clearSelections() {
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
      // Resolve any waiting promises for this player
      this.resolvePlayerSelection(selection.player)

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

    const playerAloose = this.playerA.effectiveTeam.every(pet => !pet.isAlive)
    const playerBloose = this.playerB.effectiveTeam.every(pet => !pet.isAlive)

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

  /**
   * 统一的投降处理方法，可在任意阶段调用
   */
  public handleSurrender(playerId: playerId): void {
    const surrenderPlayer = [this.playerA, this.playerB].find(v => v.id === playerId)
    if (!surrenderPlayer) return

    this.victor = this.getOpponent(surrenderPlayer)
    this.status = BattleStatus.Ended
    this.currentPhase = BattlePhase.Ended
    // 停止所有计时器
    this.timerManager.stopAllTimers()
    // 取消当前的选择等待
    this.cancelCurrentSelections()
    this.getVictor(true, 'surrender')
  }

  cleanupPhaseEffects(phaseId: string): void {
    // Clear temporary effects from battle-level marks
    for (const mark of this.marks) {
      mark.clearTemporaryEffects(phaseId)
    }

    // Clear temporary effects from pets, their skills, and their marks
    for (const pet of this.petMap.values()) {
      for (const skill of pet.skills) {
        skill.clearTemporaryEffects(phaseId)
      }
      for (const mark of pet.marks) {
        mark.clearTemporaryEffects(phaseId)
      }
    }
  }

  toMessage(viewerId?: playerId, showHidden = false): BattleState {
    showHidden = showHidden || this.showHidden
    return {
      status: this.status,
      currentPhase: this.currentPhase,
      currentTurn: this.currentTurn,
      marks: this.marks.map(m => m.toMessage()),
      sequenceId: this.sequenceId, // 包含当前的序列ID
      players: [this.playerA, this.playerB].map(p => p.toMessage(viewerId, showHidden)),
    }
  }

  public getState(viewerId?: playerId, showHidden = false): BattleState {
    return this.toMessage(viewerId, showHidden)
  }

  // Phase handler methods for the new phase-based battle system

  // AbortController-based selection management
  private currentSelectionController?: AbortController
  private playerSelectionResolvers = new Map<string, () => void>()

  public async waitForSwitchSelections(players: Player[]): Promise<void> {
    // Cancel any existing selection waiting
    this.cancelCurrentSelections()

    // Continue waiting until all players are ready
    while (true) {
      // Check if already ready
      const allReady = this.checkSwitchPlayersReady(players)
      if (allReady) {
        return
      }

      // 检查战斗是否已结束，避免无限等待
      if (this.isBattleEnded()) {
        this.logger.warn({ battleId: this.id }, 'Battle ended while waiting for switch selections')
        return
      }

      // Create new AbortController for this selection session
      const abortController = new AbortController()
      this.currentSelectionController = abortController

      // Create promises for each player that needs to make a selection
      const playerPromises = players
        .filter(player => !this.isPlayerSwitchReady(player))
        .map(player => this.createPlayerSwitchSelectionPromise(player, abortController.signal))

      if (playerPromises.length === 0) {
        this.currentSelectionController = undefined
        return
      }

      try {
        await Promise.all(playerPromises)
        // All players made selections, exit the loop
        break
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          // Selection was cancelled (player cancelled their choice), continue waiting
          this.logger.debug({ battleId: this.id }, 'Switch selection cancelled, continuing to wait')
          continue
        }
        throw error
      } finally {
        this.currentSelectionController = undefined
      }
    }
  }

  public async waitForBothPlayersReady(): Promise<void> {
    // Cancel any existing selection waiting
    this.cancelCurrentSelections()

    // Continue waiting until both players are ready
    while (true) {
      // Check if already ready
      if (this.bothPlayersReady()) {
        return
      }

      // 检查战斗是否已结束，避免无限等待
      if (this.isBattleEnded()) {
        this.logger.warn({ battleId: this.id }, 'Battle ended while waiting for players ready')
        return
      }

      // Create new AbortController for this selection session
      const abortController = new AbortController()
      this.currentSelectionController = abortController

      // Create promises for each player that needs to make a selection
      const playerPromises = [this.playerA, this.playerB]
        .filter(player => !player.selection)
        .map(player => this.createPlayerSelectionPromise(player, abortController.signal))

      if (playerPromises.length === 0) {
        this.currentSelectionController = undefined
        return
      }

      try {
        await Promise.all(playerPromises)
        // All players made selections, exit the loop
        break
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          // Selection was cancelled (player cancelled their choice), continue waiting
          this.logger.debug({ battleId: this.id }, 'Player selection cancelled, continuing to wait')
          continue
        }
        throw error
      } finally {
        this.currentSelectionController = undefined
      }
    }
  }

  // Helper methods for the new Promise.all-based selection system

  /**
   * Cancel current selection waiting
   */
  public cancelCurrentSelections(): void {
    if (this.currentSelectionController) {
      this.currentSelectionController.abort()
      this.currentSelectionController = undefined
    }
    this.playerSelectionResolvers.clear()
  }

  /**
   * Cancel a specific player's selection (e.g., when they want to change their choice)
   */
  public cancelPlayerSelection(playerId: playerId): void {
    const player = [this.playerA, this.playerB].find(p => p.id === playerId)
    if (player) {
      player.selection = null
      // 通知TimerManager选择状态已清理
      this.timerManager.handlePlayerSelectionChange(playerId, false)

      // Trigger re-evaluation of waiting promises by cancelling current session
      // This will cause the while loop to restart and wait for this player again
      if (this.currentSelectionController) {
        this.currentSelectionController.abort()
      }
    }
  }

  /**
   * Check if all switch players are ready
   */
  private checkSwitchPlayersReady(players: Player[]): boolean {
    return players.every(player => this.isPlayerSwitchReady(player))
  }

  /**
   * Check if a specific player is ready for switch selection
   */
  private isPlayerSwitchReady(player: Player): boolean {
    if (!player.selection) return false

    // 投降选择总是被认为是ready状态
    if (player.selection.type === 'surrender') {
      return true
    }

    // 如果是强制更换的玩家，必须选择switch-pet
    if (this.pendingForcedSwitches.includes(player)) {
      return player.selection.type === 'switch-pet'
    }

    // 如果是击破奖励更换的玩家，可以选择switch-pet或do-nothing
    if (this.pendingFaintSwitch === player) {
      return player.selection.type === 'switch-pet' || player.selection.type === 'do-nothing'
    }

    return false
  }

  /**
   * Create a promise that resolves when a player makes any valid selection
   */
  private createPlayerSelectionPromise(player: Player, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Check if already has selection (for immediate AI or human players who already chose)
      if (player.selection) {
        resolve()
        return
      }

      // Check if signal is already aborted
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }

      // Handle AI players that need delayed decision
      if (player instanceof AIPlayer && player.needsDelayedDecision()) {
        player
          .makeDelayedDecision()
          .then((selection: PlayerSelection) => {
            if (signal.aborted) {
              reject(new DOMException('Aborted', 'AbortError'))
              return
            }
            // Set selection through battle to trigger proper notifications
            this.setSelection(selection)
            resolve()
          })
          .catch((error: Error) => {
            if (!signal.aborted) {
              reject(error)
            }
          })
        return
      }

      // Listen for abort signal
      const abortHandler = () => {
        this.playerSelectionResolvers.delete(player.id)
        reject(new DOMException('Aborted', 'AbortError'))
      }
      signal.addEventListener('abort', abortHandler, { once: true })

      // Store resolver for this player
      const resolverWrapper = () => {
        signal.removeEventListener('abort', abortHandler)
        this.playerSelectionResolvers.delete(player.id)
        resolve()
      }
      this.playerSelectionResolvers.set(player.id, resolverWrapper)
    })
  }

  /**
   * Create a promise that resolves when a player makes a valid switch selection
   */
  private createPlayerSwitchSelectionPromise(player: Player, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      // Check if already ready
      if (this.isPlayerSwitchReady(player)) {
        resolve()
        return
      }

      // Check if signal is already aborted
      if (signal.aborted) {
        reject(new DOMException('Aborted', 'AbortError'))
        return
      }

      // Handle AI players that need delayed decision for switch
      if (player instanceof AIPlayer && player.needsDelayedDecision()) {
        player
          .makeDelayedDecision()
          .then((selection: PlayerSelection) => {
            if (signal.aborted) {
              reject(new DOMException('Aborted', 'AbortError'))
              return
            }
            // Set selection through battle to trigger proper notifications
            this.setSelection(selection)
            resolve()
          })
          .catch((error: Error) => {
            if (!signal.aborted) {
              reject(error)
            }
          })
        return
      }

      // Listen for abort signal
      const abortHandler = () => {
        this.playerSelectionResolvers.delete(player.id)
        reject(new DOMException('Aborted', 'AbortError'))
      }
      signal.addEventListener('abort', abortHandler, { once: true })

      // Store resolver for this player
      const resolverWrapper = () => {
        if (this.isPlayerSwitchReady(player)) {
          signal.removeEventListener('abort', abortHandler)
          this.playerSelectionResolvers.delete(player.id)
          resolve()
        }
      }
      this.playerSelectionResolvers.set(player.id, resolverWrapper)
    })
  }

  /**
   * Resolve waiting promises for a specific player
   */
  private resolvePlayerSelection(playerId: playerId): void {
    const resolver = this.playerSelectionResolvers.get(playerId)
    if (resolver) {
      resolver()
    }
  }

  public async cleanup() {
    this.clearListeners()

    // Cancel any ongoing selections
    this.cancelCurrentSelections()

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
