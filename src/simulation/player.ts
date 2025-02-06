import {
  BattleSystem,
  DoNothingSelection,
  PlayerSelection,
  SwitchPetSelection,
  UseSkillSelection,
} from './battleSystem'
import { AttackTargetOpinion, RAGE_PER_DAMAGE } from './const'
import { DamageContext, RageContext, SwitchPetContext, UseSkillContext } from './context'
import { EffectTrigger } from './effect'
import { BattleMessageType } from './message'
import { Pet } from './pet'
import { SkillType } from './skill'
import { TYPE_CHART } from './type'

export class Player {
  public currentRage: number = 20
  public battle?: BattleSystem
  constructor(
    public readonly name: string,
    public activePet: Pet,
    public readonly team: Pet[],
    public selection: PlayerSelection | null = null,
  ) {
    team.forEach(pet => pet.setOwner(this))
  }

  public registerBattle(battle: BattleSystem) {
    this.battle = battle
  }

  public getAvailableSelection(): PlayerSelection[] {
    const actions: PlayerSelection[] = [...this.getAvailableSkills(), ...this.getAvailableSwitch()]
    if (actions.length == 0)
      actions.push({
        source: this,
        type: 'do-nothing',
      } as DoNothingSelection)
    return actions
  }

  public getAvailableSkills(): UseSkillSelection[] {
    return this.activePet.skills
      .filter(
        skill => skill.rageCost <= this.currentRage, // 怒气足够
      )
      .map(
        skill =>
          ({
            type: 'use-skill',
            skill,
            source: this,
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
        pet,
        source: this,
      }))
  }

  //TODO: 对于印记禁用的限制
  private checkSkillsActionAvailable(selection: UseSkillSelection) {
    if (selection.type !== 'use-skill') {
      throw new Error("Invalid action type. Expected 'use-skill'.")
    }
    return selection.source.currentRage >= selection.skill.rageCost
  }

  private checkDoNothingActionAvailable() {
    return this.getAvailableSelection()[0].type == 'do-nothing'
  }

  private checkSwitchAvailable(selection: SwitchPetSelection) {
    return selection.pet !== this.activePet && selection.pet.isAlive
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
      default:
        throw '未实现的selection类型'
    }
    this.selection = selection
    return true
  }

  public performSwitchPet(context: SwitchPetContext) {
    const player = context.player
    const newPet = context.target

    // 检查新宠物是否可用
    if (!player.team.includes(newPet) || !newPet.isAlive) {
      this.battle!.emitMessage(BattleMessageType.Error, { message: `${newPet.name} 无法出战！` })
      return
    }

    // 执行换宠
    const oldPet = player.activePet
    player.activePet = newPet
    this.battle!.emitMessage(BattleMessageType.PetSwitch, {
      player: this.name,
      fromPet: oldPet.name,
      toPet: newPet.name,
      currentHp: newPet.currentHp,
    })

    // 换宠后怒气为原怒气的80%
    player.settingRage(Math.floor(player.currentRage * 0.8))
  }

  public *handleForcedSwitch(): Generator<void, void, PlayerSelection> {
    // 获取可换宠列表
    const switchActions = this.getAvailableSwitch()
    if (switchActions.length === 0) {
      this.battle!.emitMessage(BattleMessageType.Error, { message: `${this.name} 没有可用的精灵！` })
      return
    }
    this.battle!.emitMessage(BattleMessageType.ForcedSwitch, { player: this, required: true })

    // 强制玩家选择换宠
    let selection: PlayerSelection
    do {
      selection = yield
      if (selection.type === 'switch-pet' && selection.source === this) {
        this.setSelection(selection)
      } else {
        this.battle!.emitMessage(BattleMessageType.Error, { message: '必须选择更换精灵！' })
      }
    } while (!this.selection)

    // 执行换宠
    this.performSwitchPet(new SwitchPetContext(this, this, (this.selection as SwitchPetSelection).pet))

    // 清空选择以准备正常回合
    this.selection = null
  }

  public *handleOptionalSwitch(): Generator<void, void, PlayerSelection> {
    const switchActions = this.getAvailableSwitch()
    if (switchActions.length === 0) return

    this.battle!.emitMessage(BattleMessageType.KillerSwitch, {
      player: this.name,
      available: this.battle!.allowKillerSwitch,
    })

    let selection: PlayerSelection
    do {
      selection = yield
      if (
        (selection.type === 'switch-pet' && selection.source === this) ||
        (selection.type === 'do-nothing' && selection.source === this)
      ) {
        break
      }
      this.battle!.emitMessage(BattleMessageType.InvalidAction, {
        player: this.name,
        action: selection.type,
        reason: 'invalid_action',
      })
    } while (true)

    if (selection.type === 'switch-pet') {
      this.performSwitchPet(new SwitchPetContext(this, this, selection.pet))
    }
  }

  public performAttack(context: UseSkillContext): boolean {
    // 攻击前触发
    const attacker = context.pet
    const defender =
      context.skill.target === AttackTargetOpinion.opponent
        ? this.battle!.getOpponent(context.player).activePet
        : attacker // 动态获取当前目标
    context.actualTarget = defender
    if (!context.skill) {
      this.battle!.emitMessage(BattleMessageType.Error, { message: `${attacker.name} 没有可用技能!` })
      return false
    }
    if (attacker.currentHp <= 0 || !attacker.isAlive) return false

    this.battle!.emitMessage(BattleMessageType.SkillUse, {
      user: attacker.name,
      target: defender.name,
      skill: context.skill.name,
      rageCost: context.rageCost,
    })

    if (!context.useSkillSuccess) {
      return false
    }

    context.skill.applyEffects(this.battle!, EffectTrigger.BeforeAttack, context)

    // 怒气检查
    if (context.player.currentRage < context.rageCost) {
      this.battle!.emitMessage(BattleMessageType.Error, {
        message: `${attacker.name} 怒气不足无法使用 ${context.skill.name}!`,
      })
      return false
    }

    context.player.addRage(new RageContext(context, context.player, 'skill', 'reduce', context.skill.rageCost))

    // 命中判定
    if (this.battle!.random() > context.skill.accuracy) {
      this.battle!.emitMessage(BattleMessageType.SkillMiss, {
        user: attacker.name,
        target: defender.name,
        skill: context.skill.name,
        reason: 'accuracy',
      })
      context.skill.applyEffects(this.battle!, EffectTrigger.OnMiss, context) // 触发未命中特效
      return false
    }

    // 暴击判定
    context.crit = Math.random() < attacker.stat.critRate
    if (context.crit) {
      this.battle!.emitMessage(BattleMessageType.Crit, { attacker: attacker.name, target: defender.name })
      context.skill.applyEffects(this.battle!, EffectTrigger.OnCritPreDamage, context) // 触发暴击前特效
    }

    // 伤害计算
    if (context.skill.skillType !== SkillType.Status) {
      // 攻击命中
      //TODO: 影响伤害的印记
      context.skill.applyEffects(this.battle!, EffectTrigger.PreDamage, context) // 触发伤害前特效
      const typeMultiplier = TYPE_CHART[context.skill.type][defender.type] || 1
      let atk = 0
      let def = 0
      switch (context.skill.skillType) {
        case SkillType.Physical:
          atk = attacker.stat.atk
          def = defender.stat.def
          break
        case SkillType.Special:
          atk = attacker.stat.spa
          def = defender.stat.spd
          break
        case SkillType.Climax:
          if (attacker.stat.atk > attacker.stat.spa) {
            atk = attacker.stat.atk
            def = defender.stat.def
          } else {
            atk = attacker.stat.spa
            def = defender.stat.spd
          }
      }
      const baseDamage = Math.floor((((2 * defender.level) / 5 + 2) * context.skill.power * (atk / def)) / 50 + 2)

      // 随机波动
      const randomFactor = this.battle!.random() * 0.15 + 0.85

      // STAB加成
      const stabMultiplier = attacker.species.type === context.skill.type ? 1.5 : 1

      // 暴击加成
      const critMultiplier = context.crit ? 1.5 : 1

      // 应用百分比修正（叠加计算）
      const percentModifier = 1 + context.damageModified[0] / 100

      // 计算中间伤害
      let intermediateDamage = Math.floor(
        baseDamage * randomFactor * typeMultiplier * stabMultiplier * critMultiplier * percentModifier,
      )

      // 应用固定值修正
      intermediateDamage += context.damageModified[1]

      // 应用伤害阈值（先处理最小值再处理最大值）
      // 最小值阈值处理
      if (context.minThreshold) {
        intermediateDamage = Math.min(intermediateDamage, context.minThreshold)
      }

      // 最大值阈值处理
      if (context.maxThreshold) {
        intermediateDamage = Math.max(intermediateDamage, context.maxThreshold)
      }

      // 记录最终伤害
      context.damageResult = Math.max(0, intermediateDamage)

      // 应用伤害
      defender.damage(new DamageContext(context, context.damageResult))

      this.battle!.emitMessage(BattleMessageType.Damage, {
        currentHp: defender.currentHp,
        maxHp: defender.maxHp!,
        source: attacker.name,
        target: defender.name,
        damage: context.damageResult,
        basePower: context.skill.power,
        isCrit: context.crit,
        effectiveness: typeMultiplier,
        damageType:
          context.skill.skillType === SkillType.Physical
            ? 'physical'
            : context.skill.skillType === SkillType.Special
              ? 'special'
              : 'fixed',
      })

      // 受伤者获得怒气
      const gainedRage = Math.floor(context.damageResult * RAGE_PER_DAMAGE)
      defender.owner!.addRage(new RageContext(context, defender.owner!, 'damage', 'add', gainedRage))

      context.skill.applyEffects(this.battle!, EffectTrigger.PostDamage, context) // 触发伤害后特效

      context.player.addRage(new RageContext(context, context.player, 'skillHit', 'add', 15)) //命中奖励
    }

    context.skill.applyEffects(this.battle!, EffectTrigger.OnCritPostDamage, context) // 触发命中特效
    if (context.crit) {
      context.skill.applyEffects(this.battle!, EffectTrigger.OnCritPostDamage, context) // 触发暴击后特效
    }

    if (defender.currentHp <= 0) {
      this.battle!.emitMessage(BattleMessageType.PetDefeated, { pet: defender.name, killer: context.pet.name })
      defender.isAlive = false
      context.skill.applyEffects(this.battle!, EffectTrigger.OnDefeat, context) // 触发击败特效

      const defeatedPlayer = defender.owner
      if (defeatedPlayer) {
        this.battle!.pendingDefeatedPlayer = defeatedPlayer
        this.battle!.lastKiller = context.player
      }
      return true
    }
    return false
  }

  public settingRage(value: number) {
    //TODO:触发怒气相关事件
    this.currentRage = Math.max(Math.min(value, 100), 0)
  }

  public addRage(ctx: RageContext) {
    const before = this.currentRage

    if (ctx.value > 0) {
      //TODO: 触发和怒气增加相关的时间
    } else if (ctx.value < 0) {
      //TODO: 触发和怒气增加相关的事件
    }
    switch (ctx.modifiedType) {
      case 'setting':
        this.settingRage(ctx.value)
        break
      case 'add':
        this.settingRage(this.currentRage + ctx.value)
        break
      case 'reduce':
        this.settingRage(this.currentRage - ctx.value)
        break
    }

    this.battle!.emitMessage(BattleMessageType.RageChange, {
      player: this.name,
      pet: this.activePet.name,
      before: before,
      after: this.currentRage,
      reason: ctx.reason,
    })
  }
}
