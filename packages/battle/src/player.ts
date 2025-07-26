import {
  type BattleMessage,
  BattleMessageType,
  BattlePhase,
  type BattleState,
  BattleStatus,
  Category,
  type DoNothingSelection,
  EffectTrigger,
  type Events,
  MAX_RAGE,
  type PlayerMessage,
  type PlayerSelection,
  type SwitchPetSelection,
  type UseSkillSelection,
  type TeamSelectionAction,
  type BattleTeamSelection,
  type playerId,
  type petId,
} from '@arcadia-eternity/const'
import { Battle } from './battle'
import { DamageContext, RageContext, SwitchPetContext, UseSkillContext } from './context'
import { Pet } from './pet'
import { PlayerAttributeSystem } from './attributeSystem'
import { SkillPhase } from './phase/skill'
import { SwitchPetPhase } from './phase/switch'
import { RagePhase } from './phase/rage'
import * as jsondiffpatch from 'jsondiffpatch'

export enum AIDecisionTiming {
  IMMEDIATE = 'immediate', // 立即决策（当前行为）
  DELAYED = 'delayed', // 在Promise等待期间决策
  REACTIVE = 'reactive', // 等待对方选择后决策
}
import type { Emitter } from 'mitt'

export class Player {
  public emitter?: Emitter<Events>

  private lastStateMessage: BattleState = {} as BattleState
  public battle?: Battle
  public owner?: Battle
  public selection: PlayerSelection | null = null
  public activePet: Pet
  private messageCallbacks: Array<(message: BattleMessage) => void> = []

  // Team management properties
  public readonly fullTeam: Pet[] // Complete 6-pet team
  public battleTeam: Pet[] // Actual pets participating in battle
  public teamSelection?: BattleTeamSelection // Team selection result

  // Attribute system for managing rage
  public readonly attributeSystem: PlayerAttributeSystem
  constructor(
    public readonly name: string,
    public readonly id: playerId,
    public readonly team: Pet[],
  ) {
    // Initialize team management properties for backward compatibility
    this.fullTeam = [...team] // Store complete team
    this.battleTeam = [...team] // Default to using full team
    this.teamSelection = undefined // No selection by default

    this.activePet = this.battleTeam[0]
    this.activePet.appeared = true

    // Initialize attribute system with player ID (battleId will be set later in registerBattle)
    this.attributeSystem = new PlayerAttributeSystem(this.id)

    // Initialize attribute system with default rage values
    this.attributeSystem.initializePlayerAttributes(20, MAX_RAGE)
  }

  /**
   * Apply team selection result and update battle team
   */
  public applyTeamSelection(selection: BattleTeamSelection): void {
    this.teamSelection = selection

    // Update battle team based on selection
    this.battleTeam = selection.selectedPets
      .map(petId => this.fullTeam.find(pet => pet.id === petId))
      .filter((pet): pet is Pet => pet !== undefined)

    // Update active pet to starter
    const starterPet = this.battleTeam.find(pet => pet.id === selection.starterPetId)
    if (starterPet) {
      this.activePet = starterPet
      this.activePet.appeared = true
    }
  }

  /**
   * Get the team that should be used for battle operations
   * This ensures backward compatibility by defaulting to the original team property
   */
  get effectiveTeam(): Pet[] {
    return this.battleTeam.length > 0 ? this.battleTeam : this.team
  }

  /**
   * Check if team selection has been applied
   */
  get hasTeamSelection(): boolean {
    return this.teamSelection !== undefined
  }

  // Convenience getters and setters for accessing rage through the attribute system
  get currentRage(): number {
    return this.attributeSystem.getCurrentRage()
  }

  set currentRage(value: number) {
    this.attributeSystem.setCurrentRage(value)
  }

  get maxRage(): number {
    return this.attributeSystem.getMaxRage()
  }

  set maxRage(value: number) {
    this.attributeSystem.setMaxRage(value)
  }

  public registerBattle(battle: Battle, emitter: Emitter<Events>) {
    this.battle = battle
    this.owner = battle
    // 所有Player都需要注册监听器来接收battle消息并转发给自己的监听器
    battle.registerListener(this.handleMessage.bind(this))
    this.emitter = emitter

    // Set battleId for player attribute system
    this.attributeSystem.setBattleId(battle.id)

    this.team.forEach(pet => {
      pet.setOwner(this, emitter)
      // Note: dirty flag removed, attribute system handles recalculation automatically
    })
  }

  public registerListener(
    callback: (message: BattleMessage) => void,
    options?: {
      // 对于player来说，回调中的信息始终默认显示自己可见的
      // 这里保留options参数是为了API一致性，但实际上player总是使用自己的视角
    },
  ) {
    // Player的回调始终使用自己的视角，忽略options参数
    this.messageCallbacks.push(callback)
  }

  public emitMessage(message: BattleMessage) {
    this.messageCallbacks.forEach(cb => cb(message))
  }

  public handleMessage(message: BattleMessage) {
    // Player应该始终从自己的视角获取battle状态
    const currentState = this.battle!.toMessage(this.id, false) // 不显示隐藏信息，只显示自己视角

    const newMessage = {
      type: message.type,
      data: message.data, // 保持原始消息数据不变
      sequenceId: message.sequenceId,
      stateDelta: jsondiffpatch.diff(this.lastStateMessage, currentState),
    }

    // 更新lastStateMessage为当前玩家视角的状态
    this.lastStateMessage = currentState
    this.emitMessage(newMessage as BattleMessage)
  }

  public getAvailableSelection(): PlayerSelection[] {
    if (this.battle!.status === BattleStatus.Unstarted) return []

    // 检查是否在团队选择阶段
    if (this.battle!.currentPhase === BattlePhase.TeamSelectionPhase) {
      // 返回团队选择选项和投降选项
      return [
        {
          type: 'team-selection',
          player: this.id,
          selectedPets: [], // 这里会被AI的makeTeamSelectionDecision方法覆盖
          starterPetId: '' as any, // 这里会被AI的makeTeamSelectionDecision方法覆盖
        },
        {
          type: 'surrender',
          player: this.id,
        },
      ]
    }

    // 检查是否在强制更换阶段
    if (this.battle!.currentPhase === BattlePhase.SwitchPhase) {
      // 如果是强制更换的玩家，可以选择换宠或投降
      if (this.battle!.pendingForcedSwitches.includes(this)) {
        return [
          ...this.getAvailableSwitch(),
          {
            type: 'surrender',
            player: this.id,
          },
        ]
      }

      // 如果是击破奖励更换的玩家，可以选择换宠、什么都不做或投降
      if (this.battle!.pendingFaintSwitch === this) {
        return [
          {
            player: this.id,
            type: 'do-nothing',
          },
          ...this.getAvailableSwitch(),
          {
            type: 'surrender',
            player: this.id,
          },
        ]
      }

      // 如果在更换阶段但不需要更换，只能投降（等待其他玩家完成更换）
      return [
        {
          type: 'surrender',
          player: this.id,
        },
      ]
    }

    // 击破奖励更换逻辑（非SwitchPhase时）
    if (this.battle?.lastKiller === this)
      return [
        {
          player: this.id,
          type: 'do-nothing',
        },
        ...this.getAvailableSwitch(),
      ]

    // 正常选择阶段：技能、换宠、投降
    const skillSelection = this.getAvailableSkills()
    const switchSelection = this.getAvailableSwitch()
    const actions: PlayerSelection[] = [...skillSelection, ...switchSelection]
    if (skillSelection.length == 0)
      actions.push({
        player: this.id,
        type: 'do-nothing',
      } as DoNothingSelection)
    actions.push({
      type: 'surrender',
      player: this.id,
    })
    return actions
  }

  public getAvailableSkills(): UseSkillSelection[] {
    return this.activePet.skills
      .filter(
        skill => skill.rage <= this.currentRage, // 怒气足够
      )
      .map(
        skill =>
          ({
            type: 'use-skill',
            skill: skill.id,
            player: this.id,
            target: skill.target,
          }) as UseSkillSelection,
      )
  }

  public getAvailableSwitch(): SwitchPetSelection[] {
    return this.effectiveTeam
      .filter(
        pet =>
          pet !== this.activePet && // 非当前出战精灵
          pet.isAlive, // 存活状态
      )
      .map(pet => ({
        type: 'switch-pet',
        pet: pet.id,
        player: this.id,
      }))
  }

  //TODO: 某个印记效果导致的禁用限制
  private checkSkillsActionAvailable(selection: UseSkillSelection) {
    if (selection.type !== 'use-skill') {
      throw new Error("Invalid action type. Expected 'use-skill'.")
    }
    if (this.battle?.currentPhase != BattlePhase.SelectionPhase) {
      return false
    }
    const skill = this.battle!.getSkillByID(selection.skill)
    return this.currentRage >= skill.rage
  }

  private checkDoNothingActionAvailable() {
    // 在强制更换阶段，只有击破奖励更换的玩家可以选择do-nothing
    if (this.battle?.currentPhase === BattlePhase.SwitchPhase) {
      return this.battle.pendingFaintSwitch === this
    }

    // 正常情况下的do-nothing检查
    return this.battle?.lastKiller === this || this.getAvailableSkills().length === 0
  }

  private checkSwitchAvailable(selection: SwitchPetSelection) {
    const selectionPet = this.battle!.getPetByID(selection.pet)
    return (
      selection.pet !== this.activePet.id &&
      selectionPet.isAlive &&
      this.effectiveTeam.some(v => v.id === selection.pet)
    )
  }

  private checkTeamSelectionAvailable(selection: TeamSelectionAction): boolean {
    if (!this.battle) return false

    // Only allow team selection during team selection phase
    if (this.battle.currentPhase !== BattlePhase.TeamSelectionPhase) {
      return false
    }

    // Validate that all selected pets exist in full team
    const fullTeamIds = new Set(this.fullTeam.map(pet => pet.id))
    for (const petId of selection.selectedPets) {
      if (!fullTeamIds.has(petId)) {
        return false
      }
    }

    // Validate that starter pet is in selected pets
    if (!selection.selectedPets.includes(selection.starterPetId)) {
      return false
    }

    // Additional validation can be added here based on active rules
    return true
  }

  public setSelection(selection: PlayerSelection): boolean {
    switch (selection.type) {
      case 'use-skill':
        if (!this.checkSkillsActionAvailable(selection)) return false
        break
      case 'switch-pet':
        if (!this.checkSwitchAvailable(selection)) return false
        break
      case 'do-nothing':
        if (!this.checkDoNothingActionAvailable()) return false
        break
      case 'surrender':
        break
      case 'team-selection':
        if (!this.checkTeamSelectionAvailable(selection)) return false
        break
      default:
        throw '未实现的selection类型'
    }
    this.selection = selection
    return true
  }

  public performSwitchPet(context: SwitchPetContext) {
    // Switch logic has been moved to SwitchPetPhase
    // This method now delegates to the phase system
    const switchPhase = new SwitchPetPhase(this.battle!, context.origin, context.switchInPet, context.parent)
    switchPhase.initialize()
    switchPhase.execute()
  }

  public performAttack(context: UseSkillContext): boolean {
    // Attack logic has been moved to SkillPhase
    // This method now delegates to the phase system
    const skillPhase = new SkillPhase(
      this.battle!,
      context.origin,
      context.pet,
      context.selectTarget,
      context.skill,
      context.parent,
    )
    this.battle!.phaseManager.registerPhase(skillPhase)
    this.battle!.phaseManager.executePhase(skillPhase.id)
    return context.defeated
  }

  public settingRage(value: number) {
    //TODO:触发设定怒气相关事件
    this.currentRage = Math.max(Math.min(value, this.maxRage), 0)
  }

  /**
   * @deprecated Use RagePhase directly instead of calling this method.
   * This method is kept for backward compatibility but will be removed in future versions.
   */
  public addRage(context: RageContext) {
    // Rage logic has been moved to RagePhase
    // This method now delegates to the phase system
    const ragePhase = new RagePhase(
      context.battle,
      context.parent,
      context.target,
      context.reason,
      context.modifiedType,
      context.value,
      context.ignoreRageObtainEfficiency,
      context.modified,
    )
    context.battle.phaseManager.registerPhase(ragePhase)
    context.battle.phaseManager.executePhase(ragePhase.id)

    // Sync the rage result back to the original context
    const phaseContext = ragePhase.context
    if (phaseContext) {
      context.rageChangeResult = phaseContext.rageChangeResult
    }
  }

  public toMessage(viewerId?: string, showHidden = false): PlayerMessage {
    const teamAlives = this.effectiveTeam.filter(p => p.isAlive).length
    const isSelf = viewerId === this.id

    // 只有在是自己或显示隐藏信息时才包含 modifier 状态
    const shouldShowModifiers = isSelf || showHidden
    const modifierState = shouldShowModifiers ? this.attributeSystem.getDetailedModifierState() : undefined

    return {
      name: this.name,
      id: this.id,
      activePet: this.activePet.id,
      rage: this.currentRage,
      maxRage: this.maxRage,
      teamAlives,
      team: this.effectiveTeam.map(p => p.toMessage(viewerId, showHidden)),
      modifierState,
    }
  }

  public getState(): BattleState {
    return this.battle!.toMessage(this.id)
  }
}
export class AIPlayer extends Player {
  private decisionPending = false
  private phaseChangeRegistered = false

  constructor(
    name: string,
    id: playerId,
    team: Pet[],
    private decisionTiming: AIDecisionTiming = AIDecisionTiming.IMMEDIATE,
  ) {
    super(name, id, team)
    this.registerPhaseListener()
  }

  private registerPhaseListener() {
    if (!this.phaseChangeRegistered) {
      this.registerListener(this.handleBattleMessage.bind(this))
      this.phaseChangeRegistered = true
    }
  }

  private handleBattleMessage(message: BattleMessage) {
    if (message.type === BattleMessageType.TurnAction && this.battle?.currentPhase === BattlePhase.SelectionPhase) {
      this.decisionPending = true

      // 只有IMMEDIATE模式的AI才立即决策
      if (this.decisionTiming === AIDecisionTiming.IMMEDIATE) {
        this.processAIDecision()
      }
      return
    }

    // Handle team selection start message
    if (
      message.type === BattleMessageType.TeamSelectionStart &&
      this.battle?.currentPhase === BattlePhase.TeamSelectionPhase
    ) {
      // 直接处理团队选择，不使用通用的决策流程
      if (this.decisionTiming === AIDecisionTiming.IMMEDIATE) {
        this.processTeamSelectionDecision()
      } else {
        this.decisionPending = true
      }
      return
    }

    if (message.type === BattleMessageType.ForcedSwitch && message.data.player.includes(this.id)) {
      this.handleForcedSwitch()
      return
    }

    if (message.type === BattleMessageType.FaintSwitch && message.data.player === this.id) {
      this.handleFaintSwitch()
      return
    }
  }

  private async processAIDecision() {
    if (!this.decisionPending || !this.battle) return

    try {
      const selection = this.makeAIDecision()
      if (selection) {
        this.setSelection(selection)
      }
    } catch (error) {
      this.battle.emitMessage(BattleMessageType.Error, {
        message: `AI决策失败: ${error instanceof Error ? error.message : '未知错误'}`,
      })
    } finally {
      this.decisionPending = false
    }
  }

  private async handleForcedSwitch() {
    const switchActions = this.getAvailableSwitch()
    if (switchActions.length > 0) {
      const selection = this.selectRandom(switchActions)
      this.setSelection(selection)
    }
  }

  private async handleFaintSwitch() {
    const availableActions = [
      { type: 'do-nothing', player: this.id } as DoNothingSelection,
      ...this.getAvailableSwitch(),
    ]
    const selection = this.selectRandom(availableActions)
    this.setSelection(selection)
  }

  public makeAIDecision(): PlayerSelection {
    const availableActions = this.getAvailableSelection()

    // Handle team selection
    const teamSelectionActions = availableActions.filter(a => a.type === 'team-selection')
    if (teamSelectionActions.length > 0) {
      return this.makeTeamSelectionDecision()
    }

    // Filter powerful skill actions (power > 80)
    const powerfulSkills = availableActions.filter(action => {
      if (action.type !== 'use-skill') return false
      const skill = this.battle!.getSkillByID(action.skill)
      return skill.power > 80
    })
    if (powerfulSkills.length > 0) {
      return this.selectRandom(powerfulSkills)
    }

    // Check for emergency switch condition
    const switchActions = availableActions.filter(a => a.type === 'switch-pet')
    if (this.shouldEmergencySwitch() && switchActions.length > 0) {
      return this.selectRandom(switchActions)
    }

    // Filter out surrender and do-nothing for priority selection
    const combatActions = availableActions.filter(a => a.type === 'use-skill')

    return combatActions.length > 0 ? this.selectRandom(combatActions) : this.selectRandom(availableActions) // Fallback to any remaining action
  }

  private shouldEmergencySwitch(): boolean {
    return this.activePet.currentHp / this.activePet.stat.maxHp < 0.3
  }

  private selectRandom<T extends PlayerSelection>(actions: T[]): T {
    if (actions.length === 0) {
      throw new Error('No actions available for random selection')
    }
    return actions[Math.floor(Math.random() * actions.length)]
  }

  /**
   * 专门处理团队选择的决策方法
   */
  private async processTeamSelectionDecision() {
    if (!this.battle) return

    try {
      const selection = this.makeTeamSelectionDecision()
      if (selection) {
        this.setSelection(selection)
      }
    } catch (error) {
      this.battle.emitMessage(BattleMessageType.Error, {
        message: `AI团队选择失败: ${error instanceof Error ? error.message : '未知错误'}`,
      })
    }
  }

  /**
   * AI团队选择决策逻辑
   */
  private makeTeamSelectionDecision(): PlayerSelection {
    if (!this.battle) {
      throw new Error('AI Player not in battle')
    }

    // 使用战斗的团队选择配置
    const config = this.battle.teamSelectionConfig
    const finalSelection = this.makeStrategicTeamSelection(config)

    return {
      type: 'team-selection',
      player: this.id,
      selectedPets: finalSelection.selectedPets,
      starterPetId: finalSelection.starterPetId,
    }
  }

  /**
   * 战略性团队选择
   */
  private makeStrategicTeamSelection(config: {
    enabled: boolean
    mode: 'VIEW_ONLY' | 'TEAM_SELECTION' | 'FULL_TEAM'
    maxTeamSize: number
    minTeamSize: number
    allowStarterSelection: boolean
    showOpponentTeam: boolean
    teamInfoVisibility: 'HIDDEN' | 'BASIC' | 'FULL'
    timeLimit: number
  }): BattleTeamSelection {
    const availablePets = this.fullTeam.filter(pet => pet.currentHp > 0)

    // FULL_TEAM模式：使用完整队伍，只选择首发
    if (config.mode === 'FULL_TEAM' || config.mode === 'VIEW_ONLY') {
      // 使用完整队伍
      const selectedPets = this.fullTeam.map(pet => pet.id)

      // 选择最适合首发的精灵（从有血量的精灵中选择）
      let starterPetId: petId
      if (config.allowStarterSelection && availablePets.length > 0) {
        // AI策略：选择最适合首发的精灵（优先考虑速度和攻击力）
        const bestStarter = availablePets.reduce((best, current) => {
          const bestScore = this.calculateStarterScore(best)
          const currentScore = this.calculateStarterScore(current)
          return currentScore > bestScore ? current : best
        }, availablePets[0])
        starterPetId = bestStarter.id
      } else {
        // 使用第一只有血量的精灵作为首发
        starterPetId = availablePets[0]?.id || this.fullTeam[0]?.id || ('' as petId)
      }

      return {
        selectedPets,
        starterPetId,
      }
    }

    // TEAM_SELECTION模式：从队伍中选择部分精灵
    const maxSize = config.maxTeamSize || 6
    const minSize = config.minTeamSize || 1

    // 计算有效的队伍大小限制
    const availableCount = availablePets.length
    const effectiveMaxSize = Math.min(maxSize, availableCount)
    const effectiveMinSize = Math.min(minSize, effectiveMaxSize)

    // 如果没有足够的可用精灵，记录警告
    if (availableCount < minSize) {
      console.warn(`AI Player ${this.id}: 可用精灵数量(${availableCount})少于最小要求(${minSize})，将使用所有可用精灵`)
    }

    // AI策略：优先选择高血量、高等级的精灵
    const scoredPets = availablePets.map(pet => ({
      pet,
      score: this.calculatePetScore(pet),
    }))

    // 按分数排序
    scoredPets.sort((a, b) => b.score - a.score)

    // AI始终选择最大数量的精灵
    const targetSize = effectiveMaxSize

    // 选择最佳精灵
    const selectedPets = scoredPets.slice(0, targetSize).map(item => item.pet.id)

    // 选择首发精灵（通常是分数最高的）
    const starterPetId = selectedPets[0] || availablePets[0]?.id || ('' as petId)

    // 验证选择结果
    if (selectedPets.length < effectiveMinSize || selectedPets.length > effectiveMaxSize) {
      console.error(`AI Player ${this.id}: 团队选择结果不符合配置限制`, {
        selected: selectedPets.length,
        minSize: effectiveMinSize,
        maxSize: effectiveMaxSize,
        config: { minTeamSize: config.minTeamSize, maxTeamSize: config.maxTeamSize },
      })
    }

    return {
      selectedPets,
      starterPetId,
    }
  }

  /**
   * 计算精灵的综合分数
   */
  private calculatePetScore(pet: Pet): number {
    const hpRatio = pet.currentHp / pet.stat.maxHp
    const levelScore = pet.level / 100
    const statScore = (pet.stat.atk + pet.stat.def + pet.stat.spa + pet.stat.spd + pet.stat.spe) / 500

    // 综合评分：血量比例权重最高，其次是等级和属性
    return hpRatio * 0.5 + levelScore * 0.3 + statScore * 0.2
  }

  /**
   * 计算精灵作为首发的分数
   */
  private calculateStarterScore(pet: Pet): number {
    const hpRatio = pet.currentHp / pet.stat.maxHp
    const speedScore = pet.stat.spe / 200 // 首发更看重速度
    const attackScore = Math.max(pet.stat.atk, pet.stat.spa) / 200

    // 首发评分：血量、速度、攻击力
    return hpRatio * 0.4 + speedScore * 0.4 + attackScore * 0.2
  }

  /**
   * 检查AI是否需要延迟决策
   */
  public needsDelayedDecision(): boolean {
    return this.decisionTiming !== AIDecisionTiming.IMMEDIATE && this.decisionPending && !this.selection
  }

  /**
   * 延迟决策方法，在Promise等待期间调用
   */
  public async makeDelayedDecision(): Promise<PlayerSelection> {
    if (!this.battle) {
      throw new Error('AI Player not in battle')
    }

    // 对于REACTIVE模式，等待对方选择
    if (this.decisionTiming === AIDecisionTiming.REACTIVE) {
      await this.waitForOpponentSelection()
    }

    // 根据当前阶段做出不同的决策
    let selection: PlayerSelection
    if (this.battle.currentPhase === BattlePhase.TeamSelectionPhase) {
      // 团队选择阶段使用专门的逻辑
      selection = this.makeTeamSelectionDecision()
    } else {
      // 其他阶段使用通用逻辑
      selection = this.makeAIDecision()
    }

    this.decisionPending = false
    return selection
  }

  /**
   * 等待对方玩家做出选择
   */
  private async waitForOpponentSelection(): Promise<void> {
    if (!this.battle) return

    const opponent = this.battle.playerA === this ? this.battle.playerB : this.battle.playerA

    // 轮询等待对方选择（简单实现）
    while (!opponent.selection && !this.battle.isBattleEnded()) {
      await new Promise(resolve => setTimeout(resolve, 10)) // 10ms轮询间隔
    }
  }
}
