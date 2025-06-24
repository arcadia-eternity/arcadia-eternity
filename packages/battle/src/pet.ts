import {
  BattleMessageType,
  Category,
  CleanStageStrategy,
  EffectTrigger,
  Element,
  type Events,
  Gender,
  IgnoreStageStrategy,
  Nature,
  NatureMap,
  type petId,
  type PetMessage,
  RAGE_PER_TURN,
  type speciesId,
  type StatOnBattle,
  type StatOutBattle,
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
} from './context'
import type { Instance, MarkOwner, OwnedEntity, Prototype } from './entity'
import { BaseMark, CreateStatStageMark, type MarkInstance, StatLevelMarkInstanceImpl } from './mark'
import { Player } from './player'
import { BaseSkill, SkillInstance } from './skill'
import { PetAttributeSystem } from './attributeSystem'
import { executeDamageOperation } from './phase/damage'
import { executeHealOperation } from './phase/heal'
import type { Emitter } from 'mitt'

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
  public emitter?: Emitter<Events>

  public gender: Gender = Gender.NoGender

  public readonly baseCritRate: number = 7 // 暴击率默认为7%
  public readonly baseAccuracy: number = 100 // 命中率默认为100%
  public readonly baseRageObtainEfficiency: number = 1
  public element: Element
  public isAlive: boolean = true
  public owner: Player | null
  public marks: MarkInstance[] = []
  public skills: SkillInstance[] = []

  private _base: Species
  public appeared: boolean = false

  public lastSkill?: SkillInstance
  public lastSkillUsedTimes: number = 0

  // Attribute system for managing stats and currentHp
  public readonly attributeSystem: PetAttributeSystem

  constructor(
    public readonly name: string,
    public readonly id: petId,
    public readonly originalSpecies: Species,
    public readonly level: number,
    public readonly evs: StatOutBattle,
    public readonly ivs: StatOutBattle,
    public readonly nature: Nature,
    public readonly baseSkills: BaseSkill[],
    public readonly ability?: BaseMark,
    public readonly emblem?: BaseMark,
    public readonly weight?: number,
    public readonly height?: number,
    gender?: Gender,
    public readonly maxHp?: number, //可以额外手动设置hp
  ) {
    this._base = originalSpecies

    this.element = originalSpecies.element
    this.owner = null

    // Initialize attribute system with pet ID (battleId will be set later in setOwner)
    this.attributeSystem = new PetAttributeSystem(this.id)

    // Set gender
    if (gender !== undefined) {
      this.gender = gender
    }
  }

  // base 和 species 都指向同一个对象，确保变身时两者保持同步
  get base(): Species {
    return this._base
  }

  set base(newBase: Species) {
    this._base = newBase
  }

  get species(): Species {
    return this._base
  }

  // Convenience getters for accessing attributes through the system
  get currentHp(): number {
    return this.attributeSystem.getCurrentHp()
  }

  set currentHp(value: number) {
    this.attributeSystem.setCurrentHp(value)
    if (value === 0) {
      this.isAlive = false
    }
  }

  get stat(): StatOnBattle {
    return this.attributeSystem.getEffectiveStats()
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
    // Damage logic has been moved to DamagePhase
    // This method now delegates to the phase system
    executeDamageOperation(context, context.battle)
    return this.isAlive
  }

  public heal(context: HealContext): boolean {
    // Heal logic has been moved to HealPhase
    // This method now delegates to the phase system
    executeHealOperation(context, context.battle)
    return this.isAlive
  }

  public addMark(context: AddMarkContext) {
    context.battle.markSystem.addMark(this, context)
  }

  public removeMark(context: RemoveMarkContext) {
    context.battle.markSystem.removeMark(this, context)
  }

  public getShieldMark() {
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
    const baseStat = this.base.baseStats[type]
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
        base = this.weight ?? this.base.weightRange[1]
        break
      case StatTypeOnlyBattle.height:
        base = this.height ?? this.base.heightRange[1]
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
    const baseStat = this.base.baseStats.hp
    const level = this.level
    const iv = this.ivs.hp
    const ev = this.evs.hp
    const base = Math.floor(((2 * baseStat + iv + Math.floor(ev / 4)) * level) / 100) + level + 10
    return base
  }

  public setOwner(player: Player, emitter: Emitter<Events>) {
    // 防止重复初始化
    if (this.owner === player && this.emitter === emitter) {
      return
    }

    this.owner = player
    this.emitter = emitter

    // Set battleId for attribute system if player has a battle
    if (player.battle) {
      this.attributeSystem.setBattleId(player.battle.id)
    }

    // 只在第一次设置owner时初始化技能
    if (this.skills.length === 0) {
      this.skills = this.baseSkills.map(s => new SkillInstance(s))
      this.skills.forEach(skill => {
        skill.setOwner(this)
        // Set battleId for skill attribute systems
        if (player.battle) {
          skill.attributeSystem.setBattleId(player.battle.id)
        }
      })
    }

    // Calculate base stats and initialize attribute system
    const baseStats = this.calculateStats()

    // Set weight and height in base stats
    if (!this.weight) baseStats.weight = this.originalSpecies.weightRange[1]
    else baseStats.weight = this.weight
    if (!this.height) baseStats.height = this.originalSpecies.heightRange[1]
    else baseStats.height = this.height

    // Initialize attribute system with calculated stats
    this.attributeSystem.initializePetAttributes(baseStats, baseStats.maxHp)

    if (!this.gender) {
      if (!this.originalSpecies.genderRatio) this.gender = Gender.NoGender
      else if (this.originalSpecies.genderRatio[0] != 0) this.gender = Gender.Female
      else this.gender = Gender.Male
    }

    // 防止重复添加特性和纹章印记
    if (this.ability) {
      // 检查是否已经存在相同的特性印记
      const existingAbilityMark = this.marks.find(mark => mark.base.id === this.ability!.id)
      if (!existingAbilityMark) {
        const abilityMark = this.ability.createInstance()
        abilityMark.setOwner(this, emitter)
        this.marks.push(abilityMark)
      }
    }
    if (this.emblem) {
      // 检查是否已经存在相同的纹章印记
      const existingEmblemMark = this.marks.find(mark => mark.base.id === this.emblem!.id)
      if (!existingEmblemMark) {
        const emblemMark = this.emblem.createInstance()
        emblemMark.setOwner(this, emitter)
        this.marks.push(emblemMark)
      }
    }
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

  // Recalculate base stats and update attribute system
  recalculate() {
    const newStat = this.calculateStats()

    // Update base values in attribute system
    Object.entries(newStat).forEach(([key, value]) => {
      this.attributeSystem.updateBaseValue(key, value)
    })

    // Note: Effects that previously used OnUpdateStat trigger should now
    // use the modifyStat operator which works directly with the Pet's attribute system
  }

  public getEffectiveStat(ignoreMark = false, ignoreStageStrategy = IgnoreStageStrategy.none): StatOnBattle {
    // If we're ignoring marks, get base stats without any modifiers
    if (ignoreMark) {
      const baseStats: StatOnBattle = {
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
      return baseStats
    }

    // Get current stats from attribute system (includes all modifiers)
    const effectiveStats = this.attributeSystem.getEffectiveStats()

    // Apply ignore stage strategy if needed
    if (ignoreStageStrategy !== IgnoreStageStrategy.none) {
      return this.applyIgnoreStageStrategy(effectiveStats, ignoreStageStrategy)
    }

    return effectiveStats
  }

  private applyIgnoreStageStrategy(
    effectiveStats: StatOnBattle,
    ignoreStageStrategy: IgnoreStageStrategy,
  ): StatOnBattle {
    // Get base stats without any modifiers for comparison
    const baseStats: StatOnBattle = {
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

    return Object.entries(effectiveStats).reduce((result, [statKey, effectiveValue]) => {
      const statType = statKey as keyof StatOnBattle
      const baseValue = baseStats[statType]

      // Determine if we should apply the effective value based on strategy
      const shouldApplyEffectiveValue = (() => {
        switch (ignoreStageStrategy) {
          case IgnoreStageStrategy.all:
            return false
          case IgnoreStageStrategy.positive:
            return effectiveValue <= baseValue
          case IgnoreStageStrategy.negative:
            return effectiveValue >= baseValue
          default:
            return true
        }
      })()

      result[statType] = shouldApplyEffectiveValue ? effectiveValue : baseValue
      return result
    }, {} as StatOnBattle)
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
      statTypes = [
        StatTypeWithoutHp.atk,
        StatTypeWithoutHp.def,
        StatTypeWithoutHp.spa,
        StatTypeWithoutHp.spd,
        StatTypeWithoutHp.spe,
      ]
    }
    statTypes.forEach(statType => {
      // Find all stat stage marks for this stat type
      const statStageMarks = this.marks.filter(
        mark => mark instanceof StatLevelMarkInstanceImpl && mark.statType === statType,
      ) as StatLevelMarkInstanceImpl[]

      statStageMarks.forEach(mark => {
        const stage = mark.level
        const shouldClear =
          cleanStageStrategy === CleanStageStrategy.all ||
          (cleanStageStrategy === CleanStageStrategy.positive && stage > 0) ||
          (cleanStageStrategy === CleanStageStrategy.negative && stage < 0)

        if (shouldClear) {
          mark.destroy(new RemoveMarkContext(context, mark))
        }
      })
    })
  }

  // 反转能力等级（正变负，负变正）
  public reverseStatStage(
    context: EffectContext<EffectTrigger>,
    cleanStageStrategy = CleanStageStrategy.positive,
    ...statTypes: StatTypeWithoutHp[]
  ) {
    if (!statTypes || statTypes.length === 0) {
      statTypes = [
        StatTypeWithoutHp.atk,
        StatTypeWithoutHp.def,
        StatTypeWithoutHp.spa,
        StatTypeWithoutHp.spd,
        StatTypeWithoutHp.spe,
      ]
    }
    statTypes.forEach(statType => {
      // Find all stat stage marks for this stat type
      const statStageMarks = this.marks.filter(
        mark => mark instanceof StatLevelMarkInstanceImpl && mark.statType === statType,
      ) as StatLevelMarkInstanceImpl[]

      statStageMarks.forEach(mark => {
        const stage = mark.level
        const shouldReverse =
          cleanStageStrategy === CleanStageStrategy.all ||
          (cleanStageStrategy === CleanStageStrategy.positive && stage > 0) ||
          (cleanStageStrategy === CleanStageStrategy.negative && stage < 0)

        if (shouldReverse) {
          // Remove the existing mark
          mark.destroy(new RemoveMarkContext(context, mark))
          // Add a new mark with reversed stage
          this.addStatStage(context, statType, -stage)
        }
      })
    })
  }

  public transferMarks(context: SwitchPetContext, ...marks: MarkInstance[]) {
    // Delegate to MarkSystem
    context.battle.markSystem.transferMarks(context, this, ...marks)
  }

  public switchOut(context: SwitchPetContext) {
    // Delegate to MarkSystem
    context.battle.markSystem.handleSwitchOut(context, this)
  }

  switchIn(context: SwitchPetContext) {
    context.battle.applyEffects(context, EffectTrigger.OnOwnerSwitchIn, ...this.marks)
    this.appeared = true
  }

  /**
   * 获取技能的原始类型（考虑变形）
   */
  private getSkillOriginalCategory(skill: SkillInstance): Category {
    if (!this.owner?.battle?.transformationSystem) {
      return skill.category
    }

    // 获取变身状态
    const transformState = this.owner.battle.transformationSystem.getTransformationState(skill)
    if (!transformState.isTransformed || !transformState.activeTransformation) {
      return skill.category
    }

    // 返回原始base的category（只有BaseSkill有category属性）
    const originalBase = transformState.currentTransformations[0]?.originalBase
    if (originalBase && 'category' in originalBase) {
      return (originalBase as BaseSkill).category
    }

    return skill.category
  }

  /**
   * 按原始类型排序技能
   */
  private sortSkillsByOriginalCategory(skills: SkillInstance[]): SkillInstance[] {
    return [...skills].sort((a, b) => {
      const aOriginalCategory = this.getSkillOriginalCategory(a)
      const bOriginalCategory = this.getSkillOriginalCategory(b)

      // Climax技能排在最后
      if (aOriginalCategory === Category.Climax && bOriginalCategory !== Category.Climax) {
        return 1
      }
      if (bOriginalCategory === Category.Climax && aOriginalCategory !== Category.Climax) {
        return -1
      }

      // 其他技能保持原有顺序
      return 0
    })
  }

  toMessage(viewerId?: string, showHidden = false): PetMessage {
    const isSelf = viewerId === this.owner?.id
    const shouldShowDetails = this.appeared || isSelf || showHidden

    // 只有在显示详细信息且是自己的宠物或显示隐藏信息时才包含 modifier 状态
    const shouldShowModifiers = shouldShowDetails && (isSelf || showHidden)
    const modifierState = shouldShowModifiers ? this.attributeSystem.getDetailedModifierState() : undefined

    // 按原始类型排序技能
    const sortedSkills = shouldShowDetails ? this.sortSkillsByOriginalCategory(this.skills) : undefined

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
      stats: isSelf || showHidden ? this.stat : undefined,
      skills: sortedSkills ? sortedSkills.map(s => s.toMessage.call(s, viewerId, showHidden)) : undefined,
      modifierState,
    }
  }

  get status(): string {
    return [`NAME:${this.name} HP: ${this.currentHp}/${this.stat.maxHp}`].join(' | ')
  }
}
