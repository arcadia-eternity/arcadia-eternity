import { Skill } from './skill'
import { Type } from './type'
import {
  OwnedEntity,
  Prototype,
  RAGE_PER_TURN,
  StatBuffOnBattle,
  StatOnBattle,
  StatOutBattle,
  StatType,
  StatTypeOnBattle,
  StatTypeOnlyBattle,
  StatTypeWithoutHp,
} from './const'
import { Nature, NatureMap } from './nature'
import { Player } from './player'
import { Mark } from './mark'
import { AddMarkContext, DamageContext, HealContext, RemoveMarkContext } from './context'
import { BattleMessageType } from './message'
import { EffectTrigger } from './effect'

export interface Species extends Prototype {
  id: string
  name: string
  type: Type
  baseStats: { [key in StatType]: number }
  genderRatio?: [number, number]
  abilities?: string //TODO: 特性
  emblem?: string //TODO: 纹章
}

// 精灵类
export class Pet implements OwnedEntity {
  public currentHp: number
  public baseCritRate: number = 0.1 // 暴击率默认为10%
  public baseAccuracy: number = 1 // 命中率默认为100%
  public statModifiers: StatBuffOnBattle = {
    // [百分比，固定值]
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
  public type: Type
  public isAlive: boolean = true
  public lastUseSkill: Skill | null = null
  public baseRageObtainEfficiency: number = 1
  public owner: Player | null
  public marks: Mark[] = []

  constructor(
    public readonly name: string,
    public readonly species: Species,
    public readonly level: number,
    public readonly evs: StatOutBattle,
    public readonly ivs: StatOutBattle,
    public readonly nature: Nature,
    public readonly skills: Skill[],
    public maxHp?: number, //可以额外手动设置hp
  ) {
    this.maxHp = maxHp ? maxHp : this.calculateMaxHp()
    this.currentHp = this.maxHp
    this.type = species.type
    this.owner = null
  }

  public damage(ctx: DamageContext): boolean {
    //通过技能威力造成伤害的事件
    if (ctx.source instanceof Pet) {
      ctx.battle.applyEffects(ctx, EffectTrigger.OnDamage)
    }
    this.currentHp = Math.max(0, this.currentHp - ctx.value)
    if (this.currentHp === 0) {
      this.isAlive = false
    }

    ctx.battle!.emitMessage(BattleMessageType.Damage, {
      currentHp: this.currentHp,
      maxHp: this.maxHp!,
      source: ctx.source.name,
      target: this.name,
      damage: ctx.value,
      isCrit: ctx.crit,
      effectiveness: ctx.effectiveness,
      damageType: ctx.damageType,
    })
    return this.isAlive
  }

  public heal(ctx: HealContext): boolean {
    ctx.battle.applyEffects(ctx, EffectTrigger.OnHeal)
    this.currentHp = Math.min(this.maxHp!, this.currentHp + ctx.value)
    return this.isAlive
  }

  public addMark(ctx: AddMarkContext) {
    const existingMark = this.marks.find(mark => mark.id === ctx.mark.id)
    if (existingMark) {
      existingMark.tryStack(ctx)
    } else {
      const newMark = ctx.mark.clone()
      this.marks.push(newMark)
      newMark.attachTo(this)
    }
  }

  public removeMark(ctx: RemoveMarkContext) {
    this.marks = this.marks.filter(mark => mark.id !== ctx.mark.id)
  }

  //TODO: 属性修改器
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

    return Math.floor(((2 * baseStat + iv + Math.floor(ev / 4)) * level) / 100 + 5) * natureMultiplier
  }

  private calculateStatOnlyBattle(type: StatTypeOnBattle): number {
    if (type === 'accuracy') {
      return this.baseAccuracy
    } else if (type === 'critRate') {
      return this.baseCritRate
    } else if (type === 'evasion') {
      return 0
    } else if (type === 'ragePerTurn') {
      return RAGE_PER_TURN
    } else {
      return this.calculateStatWithoutHp(type)
    }
  }

  private calculateMaxHp(): number {
    const baseStat = this.species.baseStats.hp
    const level = this.level
    const iv = this.ivs.hp
    const ev = this.evs.hp

    return Math.floor(((2 * baseStat + iv + Math.floor(ev / 4)) * level) / 100) + level + 10
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

  get status(): string {
    return [`NAME:${this.name} HP: ${this.currentHp}/${this.maxHp}`].join(' | ')
  }
}
