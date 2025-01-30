import { Skill } from './skill'
import { Type } from './type'
import {
  MAX_RAGE,
  StatBuffOnBattle,
  StatOnBattle,
  StatOutBattle,
  StatType,
  StatTypeOnBattle,
  StatTypeOnlyBattle,
  StatTypeWithoutHp,
} from './const'
import { Nature, NatureMap } from './nature'

export interface Species {
  name: string
  type: Type
  baseStats: { [key in StatType]: number }
  skills: Skill[]
  genderRatio?: [number, number]
  abilities?: string //TODO: 特性
  emblem?: string //TODO: 纹章
}

// 宝可梦类
export class Pet {
  public currentHp: number
  public currentRage: number
  public baseCritRate: number = 0.1 // 暴击率默认为10%
  public baseAccuracy: number = 1 // 命中率默认为100%
  public statModifiers: StatBuffOnBattle = {
    atk: [1, 0],
    def: [1, 0],
    spa: [1, 0],
    spd: [1, 0],
    spe: [1, 0],
    accuracy: [1, 0],
    critRate: [1, 0],
    evasion: [1, 0],
  }
  public type: Type
  public isAlive: boolean = true

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
    this.currentRage = 20 // 初始怒气为20
    this.type = species.type
  }

  // 选择随机技能
  selectRandomSkill(): Skill {
    return this.skills[Math.floor(Math.random() * this.skills.length)]
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
    }
  }

  get accuracy(): number {
    return this.baseAccuracy
  }

  get status(): string {
    return [`HP: ${this.currentHp}/${this.maxHp}`, `怒气: ${this.currentRage}/${MAX_RAGE}`].join(' | ')
  }
}
