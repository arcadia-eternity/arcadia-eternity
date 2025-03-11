import {
  type petId,
  RAGE_PER_TURN,
  type speciesId,
  STAT_STAGE_MULTIPLIER,
  type StatBuffOnBattle,
  type StatOnBattle,
  type StatOutBattle,
  type StatStage,
  StatType,
  type StatTypeOnBattle,
  StatTypeOnlyBattle,
  StatTypeWithoutHp,
} from '@test-battle/const/const'
import { EffectTrigger } from '@test-battle/const/effectTrigger'
import { Element } from '@test-battle/const/element'
import { BattleMessageType, type PetMessage } from '@test-battle/const/message'
import { Nature, NatureMap } from '@test-battle/const/nature'
import {
  AddMarkContext,
  DamageContext,
  EffectContext,
  HealContext,
  RageContext,
  RemoveMarkContext,
  SwitchPetContext,
} from './context'
import type { Instance, MarkOwner, OwnedEntity, Prototype } from './entity'
import { BaseMark, CreateStatStageMark, MarkInstance, StatLevelMarkInstance } from './mark'
import { Player } from './player'
import { BaseSkill, SkillInstance } from './skill'
import { Gender } from '@test-battle/const'
import { config } from 'process'

export interface Species extends Prototype {
  id: speciesId //约定:id为原中文名的拼音拼写
  num: number //用于原游戏内的序号
  name: string
  element: Element
  baseStats: StatOutBattle
  genderRatio: [number, number] | null
  heightRange: [number, number]
  weightRange: [number, number]
  ability?: BaseMark[]
  emblem?: BaseMark[]
}

// 精灵类
export class Pet implements OwnedEntity, MarkOwner, Instance {
  public currentHp: number
  public baseCritRate: number = 0.07 // 暴击率默认为7%
  public baseAccuracy: number = 100 // 命中率默认为100%
  public statStage: StatStage = { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 } //能力等级
  public statModifiers: StatBuffOnBattle = {
    atk: [100, 0],
    def: [100, 0],
    spa: [100, 0],
    spd: [100, 0],
    spe: [100, 0],
    accuracy: [100, 0],
    critRate: [100, 0],
    evasion: [100, 0],
    ragePerTurn: [15, 0],
  }
  public element: Element
  public isAlive: boolean = true
  public lastUseSkill: SkillInstance | null = null
  public baseRageObtainEfficiency: number = 1
  public owner: Player | null
  public marks: MarkInstance[] = []
  public readonly skills: SkillInstance[]
  public maxHp: number
  public base: Species
  public readonly weight: number
  public readonly height: number
  public readonly gender: Gender

  constructor(
    public readonly name: string,
    public readonly id: petId,
    public readonly species: Species,
    public readonly level: number,
    public readonly evs: StatOutBattle,
    public readonly ivs: StatOutBattle,
    public readonly nature: Nature,
    skills: BaseSkill[],
    ability?: BaseMark,
    emblem?: BaseMark,
    weight?: number,
    height?: number,
    gender?: Gender,
    maxHp?: number, //可以额外手动设置hp
  ) {
    this.maxHp = maxHp ? maxHp : this.calculateMaxHp()
    this.base = species
    this.currentHp = this.maxHp
    this.element = species.element
    this.owner = null
    this.skills = skills.map(s => new SkillInstance(s))
    this.skills.forEach(skill => skill.setOwner(this))
    if (!weight) this.weight = species.weightRange[1]
    else this.weight = weight
    if (!height) this.height = species.heightRange[1]
    else this.height = height
    if (!gender) {
      if (!this.species.genderRatio) this.gender = Gender.NoGender
      else if (this.species.genderRatio[0] != 0) this.gender = Gender.Female
      else this.gender = Gender.Male
    } else this.gender = gender
    if (ability) {
      const abilityMark = ability.createInstance()
      abilityMark.setOwner(this)
      this.marks.push(abilityMark)
    }
    if (emblem) {
      const emblemMark = emblem.createInstance()
      emblemMark.setOwner(this)
      this.marks.push(emblemMark)
    }
  }

  get currentRage() {
    return this.owner?.currentRage ?? 0
  }

  set currentRage(value) {
    if (this.owner) this.owner.currentRage = value
  }

  public isActive() {
    return this.owner?.activePet === this
  }

  public settingRage(value: number) {
    this.owner?.settingRage(value)
  }

  public addRage(context: RageContext) {
    this.owner?.addRage(context)
  }

  public damage(context: DamageContext): boolean {
    //通过技能威力造成伤害的事件
    if (context.source instanceof Pet) {
      context.battle.applyEffects(context, EffectTrigger.OnDamage)
      if (!context.available) {
        context.battle.emitMessage(BattleMessageType.Info, {
          message: `${this.name}受到的伤害被防止了！!`,
        })
        return this.isAlive
      }
      if (!context.ignoreShield) {
        context.battle.applyEffects(context, EffectTrigger.Shield)
        const shields = this.getShieldMark()
        shields.forEach(s => {
          context.baseDamage -= s.consumeStack(context, context.baseDamage)
        })
      }
    }
    this.currentHp = Math.max(0, this.currentHp - context.baseDamage)

    context.battle!.emitMessage(BattleMessageType.Damage, {
      currentHp: this.currentHp,
      maxHp: this.maxHp!,
      source: context.source.id,
      target: this.id,
      damage: context.baseDamage,
      isCrit: context.crit,
      effectiveness: context.effectiveness,
      damageType: context.damageType,
    })

    if (context.source instanceof Pet) {
      context.battle.applyEffects(context, EffectTrigger.PostDamage)
      if (context.crit) {
        context.battle.applyEffects(context, EffectTrigger.OnCritPostDamage) // 触发暴击后特效
      }
    }

    if (this.currentHp === 0) {
      this.isAlive = false
    }

    return this.isAlive
  }

  public heal(context: HealContext): boolean {
    context.battle.applyEffects(context, EffectTrigger.OnHeal)
    if (!context.available) {
      context.battle.emitMessage(BattleMessageType.Info, {
        message: `${this.name}受到的治疗被阻止了！!`,
      })
      return this.isAlive
    }
    this.currentHp = Math.min(this.maxHp!, this.currentHp + context.value)
    return this.isAlive
  }

  public addMark(context: AddMarkContext) {
    if (!context.available) return

    context.battle.applyEffects(context, EffectTrigger.OnBeforeAddMark)
    const config = {
      config: context.config,
      duration: context.duration ?? context.config?.duration,
      stack: context.stack ?? context.config?.duration,
    }
    const newMark = context.baseMark.createInstance(config)
    const existingOppositeMark = this.marks.find(
      mark =>
        mark instanceof StatLevelMarkInstance &&
        newMark instanceof StatLevelMarkInstance &&
        mark.isOppositeMark(newMark),
    )

    // 优先抵消互斥印记
    if (existingOppositeMark) {
      existingOppositeMark.tryStack(context) // 触发抵消逻辑
      return
    }

    const existingMark = this.marks.find(mark => mark.base.id === context.baseMark.id)
    if (existingMark) {
      existingMark.tryStack(context)
    } else {
      context.battle.applyEffects(context, EffectTrigger.OnAddMark)
      context.battle.applyEffects(context, EffectTrigger.OnMarkCreate, newMark)
      newMark.attachTo(this)
      this.marks.push(newMark)
      if (newMark instanceof StatLevelMarkInstance) {
        this.statStage[newMark.statType] = newMark.level
      }
    }
  }

  public removeMark(context: RemoveMarkContext) {
    this.marks.forEach(mark => {
      const filltered = mark.id !== context.mark.id
      if (filltered) mark.destroy(context)
      return false
    })
  }

  private getShieldMark() {
    return this.marks.filter(m => m.config.isShield)
  }

  private calculateStat(type: StatTypeOnBattle): number {
    if (type in StatTypeOnlyBattle) {
      return this.calculateStatOnlyBattle(type)
    } else if (type in StatTypeWithoutHp) {
      return this.calculateStatWithoutHp(type as StatTypeWithoutHp)
    }
    throw new Error('Invalid StatType')
  }

  private calculateStatWithoutHp(type: StatTypeWithoutHp): number {
    const baseStat = this.species.baseStats[type]
    const natureMultiplier = NatureMap[this.nature][type]
    const level = this.level
    const iv = this.ivs[type]
    const ev = this.evs[type]
    const base = Math.floor(((2 * baseStat + iv + Math.floor(ev / 4)) * level) / 100 + 5) * natureMultiplier
    const result = (base + this.statModifiers[type][1]) * (this.statModifiers[type][0] / 100)

    return result
  }

  private calculateStatOnlyBattle(type: StatTypeOnBattle): number {
    let base: number
    if (type === 'accuracy') {
      base = this.baseAccuracy
    } else if (type === 'critRate') {
      base = this.baseCritRate
    } else if (type === 'evasion') {
      base = 0
    } else if (type === 'ragePerTurn') {
      base = RAGE_PER_TURN
    } else {
      return this.calculateStatWithoutHp(type)
    }
    return ((base + this.statModifiers[type][1]) * this.statModifiers[type][0]) / 100
  }

  private calculateMaxHp(): number {
    const baseStat = this.species.baseStats.hp
    const level = this.level
    const iv = this.ivs.hp
    const ev = this.evs.hp
    const base = Math.floor(((2 * baseStat + iv + Math.floor(ev / 4)) * level) / 100) + level + 10
    return base
  }

  public setOwner(player: Player) {
    this.owner = player
  }

  get stat(): StatOnBattle {
    return {
      atk: this.calculateStat(StatTypeWithoutHp.atk),
      def: this.calculateStat(StatTypeWithoutHp.def),
      spa: this.calculateStat(StatTypeWithoutHp.spa),
      spd: this.calculateStat(StatTypeWithoutHp.spd),
      spe: this.calculateStat(StatTypeWithoutHp.spe),
      accuracy: this.calculateStat(StatTypeOnlyBattle.accuracy),
      critRate: this.calculateStat(StatTypeOnlyBattle.critRate),
      evasion: this.calculateStat(StatTypeOnlyBattle.evasion),
      ragePerTurn: this.calculateStat(StatTypeOnlyBattle.ragePerTurn),
    }
  }

  get actualStat(): StatOnBattle {
    const base = this.stat
    const modifiers = this.calculateStageModifiers()

    return {
      atk: modifiers.atk ?? base.atk,
      def: modifiers.def ?? base.def,
      spa: modifiers.spa ?? base.spa,
      spd: modifiers.spd ?? base.spd,
      spe: modifiers.spe ?? base.spe,
      accuracy: modifiers.accuracy ?? base.accuracy,
      evasion: modifiers.evasion ?? base.evasion,
      critRate: modifiers.critRate ?? base.critRate,
      ragePerTurn: modifiers.ragePerTurn ?? base.ragePerTurn,
    }
  }

  private calculateStageModifiers(): Partial<Record<StatTypeOnBattle, number>> {
    const modifiers: Partial<Record<StatTypeOnBattle, number>> = {}
    Object.entries(this.statStage).forEach(([stat, stage]) => {
      const statType = stat as StatTypeOnBattle
      const baseValue = this.stat[statType] // 直接使用 stat 中的基础值
      modifiers[statType] = this.applyStageModifier(baseValue, stage)
    })
    return modifiers
  }

  // 增强安全性的修正计算
  private applyStageModifier(base: number, stage: number): number {
    const validStage = Math.max(-6, Math.min(6, stage)) // 强制等级范围
    const index = validStage + 6
    return Math.floor(base * STAT_STAGE_MULTIPLIER[index])
  }

  public addStatStage(context: EffectContext<EffectTrigger>, statType: StatTypeWithoutHp, value: number) {
    const upMark = CreateStatStageMark(statType, value)
    this.addMark(new AddMarkContext(context, this, upMark, value))
  }

  // 清理能力等级时同时清除相关印记
  public clearStatStage(context: EffectContext<EffectTrigger>, ...statTypes: StatTypeWithoutHp[]) {
    if (!statTypes || statTypes.length === 0) {
      // Clear all stat stages
      this.statStage = { atk: 1, def: 1, spa: 1, spd: 1, spe: 1 }
      this.marks = this.marks.filter(mark => {
        if (mark instanceof StatLevelMarkInstance) {
          mark.destroy(context)
          return false
        }
        return true
      })
    } else {
      // Clear only specified stat stages
      statTypes.forEach(statType => {
        this.statStage[statType] = 1
        this.marks = this.marks.filter(mark => {
          if (mark instanceof StatLevelMarkInstance && mark.statType === statType) {
            mark.destroy(context)
            return false
          }
          return true
        })
      })
    }
  }

  public transferMarks(context: SwitchPetContext, ...marks: MarkInstance[]) {
    marks.forEach(mark => {
      const existingMark = this.marks.find(m => m.base.id === mark.base.id)
      if (existingMark) {
        // 创建 AddMarkContext，使用当前 SwitchPetContext 作为父上下文，这个被视为隐式的effect
        const effectContext = new EffectContext(context, EffectTrigger.OnOwnerSwitchOut, mark)
        const addMarkContext = new AddMarkContext(
          effectContext,
          this,
          mark.base,
          mark.stack,
          mark.duration,
          mark.config,
        )
        existingMark.tryStack(addMarkContext)
      } else {
        // 添加新印记
        mark.transfer(context, this)
      }
    })
  }

  public switchOut(context: SwitchPetContext) {
    context.battle.applyEffects(context, EffectTrigger.OnOwnerSwitchOut, ...this.marks)
    this.marks = this.marks.filter(mark => {
      const shouldKeep = mark.config.keepOnSwitchOut ?? false
      const shouldTransfer = mark.config.transferOnSwitch && context.target

      // 需要转移的印记
      if (mark.config.transferOnSwitch && context.target) {
        context.target.transferMarks(context, mark)
      } else if (!shouldKeep) {
        mark.destroy(context)
      }

      return shouldKeep || shouldTransfer
    })
  }

  switchIn(context: SwitchPetContext) {
    context.battle.applyEffects(context, EffectTrigger.OnOwnerSwitchIn, ...this.marks)
  }

  toMessage(viewerId?: string): PetMessage {
    const isSelf = viewerId === this.owner?.id

    return {
      name: this.name,
      id: this.id,
      speciesID: this.species.id,
      element: this.element,
      level: this.level,
      currentHp: this.currentHp,
      maxHp: this.maxHp,
      marks: this.marks.map(m => m.toMessage()),
      stats: isSelf ? this.stat : undefined,
      skills: isSelf ? this.skills.map(s => s.toMessage()) : undefined,
    }
  }

  get status(): string {
    return [`NAME:${this.name} HP: ${this.currentHp}/${this.maxHp}`].join(' | ')
  }
}
