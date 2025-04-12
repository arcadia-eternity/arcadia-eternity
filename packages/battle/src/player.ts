import {
  type BattleMessage,
  BattleMessageType,
  BattlePhase,
  type BattleState,
  Category,
  type DoNothingSelection,
  EffectTrigger,
  type PlayerMessage,
  type PlayerSelection,
  type SwitchPetSelection,
  type UseSkillSelection,
  type playerId,
} from '@test-battle/const'
import { Battle } from './battle'
import { DamageContext, RageContext, SwitchPetContext, UseSkillContext } from './context'
import { Pet } from './pet'

export class Player {
  public currentRage: number = 20
  public battle?: Battle
  public owner?: Battle
  public selection: PlayerSelection | null = null
  public activePet: Pet
  private messageCallbacks: Array<(message: BattleMessage) => void> = []
  constructor(
    public readonly name: string,
    public readonly id: playerId,
    public readonly team: Pet[],
  ) {
    team.forEach(pet => pet.setOwner(this))
    this.activePet = team[0]
    this.activePet.appeared = true
  }

  public registerBattle(battle: Battle) {
    this.battle = battle
    this.owner = battle
    battle.registerListener(this.handleMessage.bind(this))
  }

  public registerListener(callback: (message: BattleMessage) => void) {
    this.messageCallbacks.push(callback)
  }

  public emitMessage(message: BattleMessage) {
    this.messageCallbacks.forEach(cb => cb(message))
  }

  public handleMessage(message: BattleMessage) {
    if (message.type === BattleMessageType.BattleState) {
      message.data.players[message.data.players.findIndex(p => p.id === this.id)] = this.toMessage(this.id)
    }
    this.emitMessage(message)
  }

  public getAvailableSelection(): PlayerSelection[] {
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
    const player = context.origin

    // 检查新宠物是否可用
    if (!player.team.includes(context.target) || !context.target.isAlive) {
      this.battle!.emitMessage(BattleMessageType.Error, { message: `${context.target.name} 无法出战！` })
      return
    }
    if (player.activePet === context.target) {
      //如果所换上的就是首发的精灵，则不做任何操作
      return
    }

    // 执行换宠
    const oldPet = player.activePet
    context.battle.applyEffects(context, EffectTrigger.OnSwitchOut)
    oldPet.switchOut(context)
    player.activePet = context.target
    context.battle.applyEffects(context, EffectTrigger.OnSwitchIn)
    player.activePet.switchIn(context)
    this.battle!.emitMessage(BattleMessageType.PetSwitch, {
      player: this.id,
      fromPet: oldPet.id,
      toPet: context.target.id,
      currentHp: context.target.currentHp,
    })

    // 换宠后怒气为原怒气的80%
    player.settingRage(Math.floor(player.currentRage * 0.8))
  }

  public performAttack(context: UseSkillContext): boolean {
    this.battle!.applyEffects(context, EffectTrigger.BeforeUseSkillCheck)
    context.skill.appeared = true
    context.updateActualTarget()

    /*几个无法使用技能的情况：
    1.当前使用技能的精灵倒下了（生命值低于0或标明了isAlive=false）
    2.当前的释放技能被打断（通过context.available=false）
    3.当前的目标不存在
     */
    if (context.pet.currentHp <= 0 || !context.pet.isAlive || !context.available || !context.actualTarget) {
      this.battle!.emitMessage(BattleMessageType.SkillUseFail, {
        user: context.pet.id,
        skill: context.skill.id,
        reason: !context.pet.isAlive ? 'faint' : !context.actualTarget ? 'invalid_target' : 'disabled',
      })
      return context.defeated
    }
    if (context.origin.currentRage < context.rage) {
      // 怒气检查
      this.battle!.emitMessage(BattleMessageType.SkillUseFail, {
        user: context.pet.id,
        skill: context.skill.id,
        reason: 'no_rage',
      })
      return context.defeated
    }

    this.battle!.emitMessage(BattleMessageType.SkillUse, {
      user: context.pet.id,
      target: context.selectTarget,
      skill: context.skill.id,
      rage: context.rage,
    })
    try {
      context.origin.addRage(new RageContext(context, context.origin, 'skill', 'reduce', context.skill.rage))

      context.updateHitResult()
      context.updateMultihitResult()
      context.updateCritResult()

      this.battle!.applyEffects(context, EffectTrigger.AfterUseSkillCheck)

      for (; context.multihitResult > 0; context.multihitResult--) {
        // 命中判定
        if (!context.hitResult) {
          this.battle!.emitMessage(BattleMessageType.SkillMiss, {
            user: context.pet.id,
            target: context.actualTarget.id,
            skill: context.skill.id,
            reason: 'accuracy',
          })
          this.battle!.applyEffects(context, EffectTrigger.OnMiss)
          // 后面都会Miss，没必要继续检定了
          break
        } else {
          this.battle!.applyEffects(context, EffectTrigger.BeforeHit)

          //开始计算伤害
          if (context.category !== Category.Status) {
            context.updateDamageResult()

            if (context.crit) this.battle!.applyEffects(context, EffectTrigger.OnCritPreDamage)
            this.battle!.applyEffects(context, EffectTrigger.PreDamage)

            const damageContext = new DamageContext(
              context,
              context.pet,
              context.actualTarget,
              context.baseDamage,
              context.damageType,
              context.crit,
              context.typeMultiplier,
              context.ignoreShield,
              context.randomFactor,
            )
            // 应用伤害
            context.actualTarget.damage(damageContext)

            // 受伤者获得怒气
            const gainedRage = Math.floor((damageContext.damageResult * 49) / context.actualTarget.maxHp)
            context.actualTarget.owner!.addRage(
              new RageContext(context, context.actualTarget.owner!, 'damage', 'add', gainedRage),
            )
          }
          this.battle!.applyEffects(context, EffectTrigger.OnHit) // 触发命中特效
        }
      }

      if (context.category !== Category.Status && context.hitResult) {
        context.origin.addRage(new RageContext(context, context.origin, 'skillHit', 'add', 15)) //命中奖励
      }

      if (context.actualTarget.currentHp <= 0) {
        this.battle!.emitMessage(BattleMessageType.PetDefeated, {
          pet: context.actualTarget.id,
          killer: context.pet.id,
        })
        context.actualTarget.isAlive = false
        this.battle!.applyEffects(context, EffectTrigger.OnDefeat) // 触发击败特效

        this.battle!.lastKiller = context.origin
        context.defeated = true
      }
      return context.defeated
    } finally {
      this.battle!.emitMessage(BattleMessageType.SkillUseEnd, {
        user: context.pet.id,
      })
    }
  }

  public settingRage(value: number) {
    //TODO:触发设定怒气相关事件
    this.currentRage = Math.max(Math.min(value, 100), 0)
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
      activePet: this.activePet.toMessage(viewerId),
      rage: this.currentRage,
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
    const combatActions = availableActions.filter(a => a.type === 'use-skill' || a.type === 'switch-pet')

    return combatActions.length > 0 ? this.selectRandom(combatActions) : this.selectRandom(availableActions) // Fallback to any remaining action
  }

  private shouldEmergencySwitch(): boolean {
    return this.activePet.currentHp / this.activePet.maxHp < 0.3
  }

  private selectRandom<T extends PlayerSelection>(actions: T[]): T {
    if (actions.length === 0) {
      throw new Error('No actions available for random selection')
    }
    return actions[Math.floor(Math.random() * actions.length)]
  }
}
