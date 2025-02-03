import { Skill } from './skill'
import { Type } from './type'
import {
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
import { Player } from './battleSystem'

export interface Species {
  name: string
  type: Type
  baseStats: { [key in StatType]: number }
  skills: Skill[]
  genderRatio?: [number, number]
  abilities?: string //TODO: 特性
  emblem?: string //TODO: 纹章
}

// 精灵类
export class Pet {
  public currentHp: number
  public baseCritRate: number = 0.1 // 暴击率默认为10%
  public baseAccuracy: number = 1 // 命中率默认为100%
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
    rageObtainEfficiency: [100, 0],
  }
  public type: Type
  public isAlive: boolean = true
  public lastUseSkill: Skill | null = null
  public baseRageObtainEfficiency: number = 1
  public owner: Player | null

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
    } else if (type === 'ragePerTurn') {
      return RAGE_PER_TURN
    } else if (type === 'rageObtainEfficiency') {
      return this.baseRageObtainEfficiency
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
      rageObtainEfficiency: this.calculateStat(StatTypeOnlyBattle.rageObtainEfficiency),
    }
  }

  get status(): string {
    return [`NAME:${this.name} HP: ${this.currentHp}/${this.maxHp}`].join(' | ')
  }
}
