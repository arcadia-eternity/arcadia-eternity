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
  type playerId,
} from '@arcadia-eternity/const'
import { Battle } from './battle'
import { DamageContext, RageContext, SwitchPetContext, UseSkillContext } from './context'
import { Pet } from './pet'
import { PlayerAttributeSystem } from './attributeSystem'
import { executeSkillOperation } from './phase/skill'
import { executeSwitchPetOperation } from './phase/switch'
import * as jsondiffpatch from 'jsondiffpatch'
import type { Emitter } from 'mitt'

export class Player {
  public emitter?: Emitter<Events>

  private lastStateMessage: BattleState = {} as BattleState
  public battle?: Battle
  public owner?: Battle
  public selection: PlayerSelection | null = null
  public activePet: Pet
  private messageCallbacks: Array<(message: BattleMessage) => void> = []

  // Attribute system for managing rage
  public readonly attributeSystem: PlayerAttributeSystem
  constructor(
    public readonly name: string,
    public readonly id: playerId,
    public readonly team: Pet[],
  ) {
    this.activePet = team[0]
    this.activePet.appeared = true

    // Initialize attribute system with player ID (battleId will be set later in registerBattle)
    this.attributeSystem = new PlayerAttributeSystem(this.id)

    // Initialize attribute system with default rage values
    this.attributeSystem.initializePlayerAttributes(20, MAX_RAGE)
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
    battle.registerListener(this.handleMessage.bind(this))
    this.emitter = emitter

    // Set battleId for player attribute system
    this.attributeSystem.setBattleId(battle.id)

    this.team.forEach(pet => {
      pet.setOwner(this, emitter)
      // Note: dirty flag removed, attribute system handles recalculation automatically
    })
  }

  public registerListener(callback: (message: BattleMessage) => void) {
    this.messageCallbacks.push(callback)
  }

  public emitMessage(message: BattleMessage) {
    this.messageCallbacks.forEach(cb => cb(message))
  }

  public handleMessage(message: BattleMessage) {
    const newMessage = {
      type: message.type,
      data: message.data,
      sequenceId: message.sequenceId,
      stateDelta: jsondiffpatch.diff(this.lastStateMessage, this.battle!.toMessage(this.id)),
    }
    this.lastStateMessage = this.battle!.toMessage(this.id)
    this.emitMessage(newMessage as BattleMessage)
  }

  public getAvailableSelection(): PlayerSelection[] {
    if (this.battle!.status === BattleStatus.Unstarted) return []
    if (this.battle!.pendingDefeatedPlayers.includes(this)) return this.getAvailableSwitch()
    if (this.battle?.lastKiller === this)
      return [
        {
          player: this.id,
          type: 'do-nothing',
        },
        ...this.getAvailableSwitch(),
      ]
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
    return this.team
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
    return this.battle?.lastKiller === this || this.getAvailableSkills().length === 0
  }

  private checkSwitchAvailable(selection: SwitchPetSelection) {
    const selectionPet = this.battle!.getPetByID(selection.pet)
    return selection.pet !== this.activePet.id && selectionPet.isAlive && this.team.some(v => v.id === selection.pet)
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
      default:
        throw '未实现的selection类型'
    }
    this.selection = selection
    return true
  }

  public performSwitchPet(context: SwitchPetContext) {
    // Switch logic has been moved to SwitchPetPhase
    // This method now delegates to the phase system
    executeSwitchPetOperation(context, this.battle!)
  }

  public performAttack(context: UseSkillContext): boolean {
    // Attack logic has been moved to SkillPhase
    // This method now delegates to the phase system
    executeSkillOperation(context, this.battle!)
    return context.defeated
  }

  public settingRage(value: number) {
    //TODO:触发设定怒气相关事件
    this.currentRage = Math.max(Math.min(value, this.maxRage), 0)
  }

  public addRage(context: RageContext) {
    const before = this.currentRage

    switch (context.modifiedType) {
      case 'setting':
        this.settingRage(context.value)
        break
      case 'add':
        context.battle.applyEffects(context, EffectTrigger.OnRageGain)
        context.updateRageChangeResult()
        this.settingRage(this.currentRage + context.rageChangeResult)
        break
      case 'reduce':
        context.battle.applyEffects(context, EffectTrigger.OnRageLoss)
        context.updateRageChangeResult()
        this.settingRage(this.currentRage - context.rageChangeResult)
        break
    }

    this.battle!.emitMessage(BattleMessageType.RageChange, {
      player: this.id,
      pet: this.activePet.id,
      before: before,
      after: this.currentRage,
      reason: context.reason,
    })
  }

  public toMessage(viewerId?: string, showHidden = false): PlayerMessage {
    const teamAlives = this.team.filter(p => p.isAlive).length

    return {
      name: this.name,
      id: this.id,
      activePet: this.activePet.id,
      rage: this.currentRage,
      maxRage: this.maxRage,
      teamAlives,
      team: this.team.map(p => p.toMessage(viewerId, showHidden)),
    }
  }

  public getState(): BattleState {
    return this.battle!.toMessage(this.id)
  }
}
export class AIPlayer extends Player {
  private decisionPending = false
  private phaseChangeRegistered = false
  constructor(name: string, id: playerId, team: Pet[]) {
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
      this.processAIDecision()
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
}
