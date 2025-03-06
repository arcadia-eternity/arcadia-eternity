import { BattlePhase } from '@test-battle/const/battlePhase'
import { Category } from '@test-battle/const/category'
import { AttackTargetOpinion, DamageType, RAGE_PER_DAMAGE, type playerId } from '@test-battle/const/const'
import { EffectTrigger } from '@test-battle/const/effectTrigger'
import { ELEMENT_CHART } from '@test-battle/const/element'
import { type BattleMessage, BattleMessageType, type BattleState, type PlayerMessage } from '@test-battle/const/message'
import {
  type DoNothingSelection,
  type PlayerSelection,
  type SwitchPetSelection,
  type UseSkillSelection,
} from '@test-battle/const/selection'
import { Battle } from './battle'
import { DamageContext, RageContext, SwitchPetContext, UseSkillContext } from './context'
import { Pet } from './pet'

export class Player {
  public currentRage: number = 20
  public battle?: Battle
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
  }

  public registerBattle(battle: Battle) {
    this.battle = battle
    battle.registerListener(this.handleMessage.bind(this))
  }

  public registerListener(callback: (message: BattleMessage) => void) {
    this.messageCallbacks.push(callback)
  }

  public emitMessage(message: BattleMessage) {
    this.messageCallbacks.forEach(cb => cb(message))
  }

  private handleMessage(message: BattleMessage) {
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

  //TODO: 对于印记禁用的限制
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
    if (!context.skill) {
      this.battle!.emitMessage(BattleMessageType.Error, { message: `${context.pet.name} 没有可用技能!` })
      return false
    }

    context.updateActualTarget()

    /*几个无法使用技能的情况：
    1.当前使用技能的精灵倒下了（生命值低于0或标明了isAlive=false）
    2.当前的释放技能被打断（通过context.available=false）
    3.当前的目标不存在
     */
    if (context.pet.currentHp <= 0 || !context.pet.isAlive || !context.available || !context.actualTarget) {
      this.battle!.emitMessage(BattleMessageType.Error, {
        message: `${context.pet.id} 无法使用 ${context.skill.id}!`,
      })
      return false
    }
    if (context.origin.currentRage < context.rage) {
      // 怒气检查
      this.battle!.emitMessage(BattleMessageType.Error, {
        message: `${context.pet.id} 怒气不足无法使用 ${context.skill.id}!`,
      })
      return false
    }

    this.battle!.emitMessage(BattleMessageType.SkillUse, {
      user: context.pet.id,
      target: context.selectTarget,
      skill: context.skill.id,
      rageCost: context.rage,
    })

    context.origin.addRage(new RageContext(context, context.origin, 'skill', 'reduce', context.skill.rage))

    context.updateHitResult()
    context.updateMultihitResult()
    context.updateCritResult()

    this.battle!.applyEffects(context, EffectTrigger.AfterUseSkillCheck)

    for (; context.multihitResult > 0; context.multihitResult--) {
      // 命中判定
      if (context.hitResult) {
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

          // 应用伤害
          context.actualTarget.damage(
            new DamageContext(
              context,
              context.pet,
              context.actualTarget,
              context.damageResult,
              context.damageType,
              context.crit,
              context.typeMultiplier,
              context.ignoreShield,
            ),
          )

          if (context.crit)
            this.battle!.emitMessage(BattleMessageType.Crit, {
              attacker: context.pet.id,
              target: context.actualTarget.id,
            })

          // 受伤者获得怒气
          const gainedRage = Math.floor(context.damageResult * RAGE_PER_DAMAGE)
          context.actualTarget.owner!.addRage(
            new RageContext(context, context.actualTarget.owner!, 'damage', 'add', gainedRage),
          )

          context.origin.addRage(new RageContext(context, context.origin, 'skillHit', 'add', 15)) //命中奖励
        }
        this.battle!.applyEffects(context, EffectTrigger.OnHit) // 触发命中特效
      }

      if (context.actualTarget.currentHp <= 0) {
        this.battle!.emitMessage(BattleMessageType.PetDefeated, {
          pet: context.actualTarget.id,
          killer: context.pet.id,
        })
        context.actualTarget.isAlive = false
        this.battle!.applyEffects(context, EffectTrigger.OnDefeat) // 触发击败特效

        this.battle!.lastKiller = context.origin
        return true
      }
    }

    return false
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
        this.settingRage(this.currentRage + context.value)
        break
      case 'reduce':
        context.battle.applyEffects(context, EffectTrigger.OnRageLoss)
        this.settingRage(this.currentRage - context.value)
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

  public toMessage(viewerId?: string): PlayerMessage {
    const isSelf = viewerId === this.id
    const teamAlives = this.team.filter(p => p.isAlive).length

    return {
      name: this.name,
      id: this.id,
      activePet: this.activePet.toMessage(viewerId),
      rage: this.currentRage,
      teamAlives,
      team: isSelf ? this.team.map(p => p.toMessage(viewerId)) : undefined,
    }
  }

  public getState(): BattleState {
    return this.battle!.toMessage(this.id)
  }
}
