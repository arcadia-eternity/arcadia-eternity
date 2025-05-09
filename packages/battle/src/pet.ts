import {
  BattleMessageType,
  CleanStageStrategy,
  EffectTrigger,
  Element,
  Gender,
  IgnoreStageStrategy,
  Nature,
  NatureMap,
  type petId,
  type PetMessage,
  RAGE_PER_TURN,
  type speciesId,
  STAT_STAGE_MULTIPLIER,
  type StatOnBattle,
  type StatOutBattle,
  type StatStage,
  type StatTypeOnBattle,
  StatTypeOnlyBattle,
  StatTypeWithoutHp,
} from '@arcadia-eternity/const'
import {
  AddMarkContext,
  DamageContext,
  EffectContext,
  HealContext,
  RageContext,
  RemoveMarkContext,
  SwitchPetContext,
  UpdateStatContext,
} from './context'
import type { Instance, MarkOwner, OwnedEntity, Prototype } from './entity'
import { BaseMark, CreateStatStageMark, type MarkInstance, StatLevelMarkInstanceImpl } from './mark'
import { Player } from './player'
import { BaseSkill, SkillInstance } from './skill'

export interface Species extends Prototype {
  id: speciesId //约定:id为原中文名的拼音拼写
  num: number //用于原游戏内的序号
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
  public readonly gender: Gender
  public currentHp: number

  public readonly baseCritRate: number = 7 // 暴击率默认为7%
  public readonly baseAccuracy: number = 100 // 命中率默认为100%
  public readonly baseRageObtainEfficiency: number = 1
  public statStage: StatStage = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 } //能力等级
  public element: Element
  public isAlive: boolean = true
  public owner: Player | null
  public marks: MarkInstance[] = []
  public readonly skills: SkillInstance[]

  public dirty: boolean = true
  public base: Species

  public appeared: boolean = false

  public lastSkill?: SkillInstance
  public lastSkillUsedTimes: number = 0

  public readonly baseStat: StatOnBattle = {
    maxHp: 0,
    atk: 0,
    def: 0,
    spa: 0,
    spd: 0,
    spe: 0,
    accuracy: 100,
    critRate: 7,
    evasion: 0,
    ragePerTurn: 15,
    weight: 0,
    height: 0,
  }

  public stat: StatOnBattle = {
    maxHp: 0,
    atk: 0,
    def: 0,
    spa: 0,
    spd: 0,
    spe: 0,
    accuracy: 100,
    critRate: 7,
    evasion: 0,
    ragePerTurn: 15,
    weight: 0,
    height: 0,
  }

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
    this.base = species

    this.element = species.element
    this.owner = null

    this.skills = skills.map(s => new SkillInstance(s))
    this.skills.forEach(skill => skill.setOwner(this))

    if (!weight) this.baseStat.weight = species.weightRange[1]
    else this.baseStat.weight = weight
    if (!height) this.baseStat.height = species.heightRange[1]
    else this.baseStat.height = height

    this.baseStat = this.calculateStats()
    this.stat = { ...this.baseStat }

    this.currentHp = this.baseStat.maxHp

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
      context.battle.applyEffects(context, EffectTrigger.OnBeforeCalculateDamage)
      context.updateDamageResult()
      context.battle.applyEffects(context, EffectTrigger.OnDamage)
      if (!context.available) {
        context.battle.emitMessage(BattleMessageType.DamageFail, {
          source: context.source.id,
          target: this.id,
          reason: 'disabled',
        })
        return this.isAlive
      }
      if (!context.ignoreShield) {
        context.battle.applyEffects(context, EffectTrigger.Shield)
        const shields = this.getShieldMark()
        shields.forEach(s => {
          context.damageResult -= s.consumeStack(context, context.damageResult)
        })
      }
    } else {
      context.updateDamageResult()
    }
    this.currentHp = Math.max(0, this.currentHp - context.damageResult)

    context.battle!.emitMessage(BattleMessageType.Damage, {
      currentHp: this.currentHp,
      maxHp: this.stat.maxHp!,
      source: context.source.id,
      target: this.id,
      damage: context.damageResult,
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
      context.battle.emitMessage(BattleMessageType.HealFail, {
        target: this.id,
        reason: 'disabled',
      })
      return this.isAlive
    }
    this.currentHp = Math.floor(Math.min(this.stat.maxHp!, this.currentHp + context.value))

    context.battle.emitMessage(BattleMessageType.Heal, {
      target: this.id,
      amount: context.value,
      source: 'effect',
    })

    return this.isAlive
  }

  public addMark(context: AddMarkContext) {
    context.battle.markSystem.addMark(this, context)
  }

  public removeMark(context: RemoveMarkContext) {
    context.battle.markSystem.removeMark(this, context)
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

    return base
  }

  private calculateStatOnlyBattle(type: StatTypeOnBattle): number {
    let base: number
    switch (type) {
      case 'accuracy':
        base = this.baseAccuracy
        break
      case 'critRate':
        base = this.baseCritRate
        break
      case 'evasion':
        base = 0
        break
      case 'ragePerTurn':
        base = RAGE_PER_TURN
        break
      case StatTypeWithoutHp.atk:
      case StatTypeWithoutHp.def:
      case StatTypeWithoutHp.spa:
      case StatTypeWithoutHp.spd:
      case StatTypeWithoutHp.spe:
        base = this.calculateStatWithoutHp(type)
        break
      case StatTypeOnlyBattle.weight:
        base = this.baseStat.weight
        break
      case StatTypeOnlyBattle.height:
        base = this.baseStat.height
        break
      case StatTypeOnlyBattle.maxHp:
        base = this.calculateMaxHp()
        break
      default:
        throw new Error(`Invalid StatType: ${type}`)
    }
    return base
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

  calculateStats() {
    const stat = {
      maxHp: this.calculateStat(StatTypeOnlyBattle.maxHp),
      atk: this.calculateStat(StatTypeWithoutHp.atk),
      def: this.calculateStat(StatTypeWithoutHp.def),
      spa: this.calculateStat(StatTypeWithoutHp.spa),
      spd: this.calculateStat(StatTypeWithoutHp.spd),
      spe: this.calculateStat(StatTypeWithoutHp.spe),
      accuracy: this.calculateStat(StatTypeOnlyBattle.accuracy),
      critRate: this.calculateStat(StatTypeOnlyBattle.critRate),
      evasion: this.calculateStat(StatTypeOnlyBattle.evasion),
      ragePerTurn: this.calculateStat(StatTypeOnlyBattle.ragePerTurn),
      weight: this.calculateStat(StatTypeOnlyBattle.weight),
      height: this.calculateStat(StatTypeOnlyBattle.height),
    }
    return stat
  }

  get actualStat(): StatOnBattle {
    return this.getEffectiveStat()
  }

  recalculate() {
    const newStat = this.calculateStats()
    const context = new UpdateStatContext(this.owner?.battle!, newStat, this)

    this.owner?.battle?.applyEffects(context, EffectTrigger.OnUpdateStat, ...this.marks)
    this.stat = { ...this.stat, ...newStat }
    console.log(this.stat)
    this.dirty = false
  }

  public getEffectiveStat(ignoreMark = false, ignoreStageStrategy = IgnoreStageStrategy.none): StatOnBattle {
    // Start with base stats
    if (this.dirty) this.recalculate()
    const baseStats = { ...this.stat }

    // If we're ignoring marks, return base stats
    if (ignoreMark) {
      return baseStats
    }

    // Get stage modifiers
    const modifiers = this.calculateStageModifiers()

    // Apply modifiers based on strategy
    return Object.entries(baseStats).reduce((result, [statKey, baseValue]) => {
      const statType = statKey as keyof StatOnBattle
      const modifier = modifiers[statType]

      // If no modifier exists, keep base value
      if (!modifier) {
        result[statType] = baseValue
        return result
      }

      // Determine if we should apply the modifier based on strategy
      const shouldApplyModifier = (() => {
        switch (ignoreStageStrategy) {
          case IgnoreStageStrategy.all:
            return false
          case IgnoreStageStrategy.positive:
            return modifier <= baseValue
          case IgnoreStageStrategy.negative:
            return modifier >= baseValue
          default:
            return true
        }
      })()

      result[statType] = shouldApplyModifier ? modifier : baseValue
      return result
    }, {} as StatOnBattle)
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
  public clearStatStage(
    context: EffectContext<EffectTrigger>,
    cleanStageStrategy = CleanStageStrategy.positive,
    ...statTypes: StatTypeWithoutHp[]
  ) {
    if (!statTypes || statTypes.length === 0) {
      statTypes = Object.keys(this.statStage) as StatTypeWithoutHp[]
    }
    statTypes.forEach(statType => {
      const stage = this.statStage[statType]
      const shouldClear =
        cleanStageStrategy === CleanStageStrategy.all ||
        (cleanStageStrategy === CleanStageStrategy.positive && stage > 1) ||
        (cleanStageStrategy === CleanStageStrategy.negative && stage < 1)
      if (shouldClear) {
        this.statStage[statType] = 1
        this.marks = this.marks.filter(mark => {
          if (mark instanceof StatLevelMarkInstanceImpl && mark.statType === statType) {
            mark.destroy(new RemoveMarkContext(context, mark))
            return false
          }
          return true
        })
      }
    })
  }

  public transferMarks(context: SwitchPetContext, ...marks: MarkInstance[]) {
    marks.forEach(mark => {
      const existingMark = this.marks.find(m => m.base.id === mark.base.id)
      if (existingMark) {
        // 创建 AddMarkContext，使用当前 SwitchPetContext 作为父上下文，这个被视为隐式的effect
        const effectContext = new EffectContext(context, EffectTrigger.OnOwnerSwitchOut, mark, undefined)
        // 印记覆盖的config替代原来的config
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
    this.appeared = true
  }

  toMessage(viewerId?: string, showHidden = false): PetMessage {
    const isSelf = viewerId === this.owner?.id
    const shouldShowDetails = this.appeared || isSelf || showHidden

    return {
      isUnknown: !shouldShowDetails,
      name: shouldShowDetails ? this.name : '',
      id: this.id,
      speciesID: shouldShowDetails ? this.species.id : ('' as speciesId),
      element: shouldShowDetails ? this.element : Element.Normal,
      level: shouldShowDetails ? this.level : 0,
      currentHp: shouldShowDetails ? this.currentHp : 0,
      maxHp: shouldShowDetails ? this.stat.maxHp : 0,
      marks: shouldShowDetails ? this.marks.map(m => m.toMessage.call(m)) : [],
      stats: shouldShowDetails ? this.stat : undefined,
      skills: shouldShowDetails ? this.skills.map(s => s.toMessage.call(s, viewerId, showHidden)) : undefined,
    }
  }

  get status(): string {
    return [`NAME:${this.name} HP: ${this.currentHp}/${this.stat.maxHp}`].join(' | ')
  }
}
