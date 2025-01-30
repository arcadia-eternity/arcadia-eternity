import { Skill } from './skill'
import { Type } from './type'
import { DurationDecorator, Mark, StatType, TriggerCondition } from './mark'
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
  public critRate: number = 0.1 // 暴击率默认为10%
  public type: Type

  constructor(
    public readonly name: string,
    public readonly species: Species,
    public readonly level: number,
    public readonly evs: { [key in StatType]: number },
    public readonly ivs: { [key in StatType]: number },
    public readonly nature: Nature,
    public readonly skills: Skill[],
    public maxHp?: number, //可以额外手动设置hp
  ) {
    this.maxHp = maxHp ? maxHp : this.calculateStat(StatType.hp)
    this.currentHp = this.maxHp
    this.currentRage = 20 // 初始怒气为20
    this.type = species.type
  }

  // 选择随机技能
  selectRandomSkill(): Skill {
    return this.skills[Math.floor(Math.random() * this.skills.length)]
  }

  // 新增印记存储
  private marks: Map<string, Mark> = new Map()

  get markStatus(): string {
    const str = []
    for (const [name, mark] of this.marks) {
      str.push(`${name}(${mark.status})`)
    }
    return str.join(', ')
  }

  // 添加印记
  addMark(mark: Mark, source?: Pet): void {
    const existing = this.marks.get(mark.name)

    if (!existing) {
      const newMark = Object.assign(Object.create(Object.getPrototypeOf(mark)), mark)
      newMark.source = source
      this.marks.set(mark.name, newMark)
      console.log(`${this.name} 获得 ${mark.name} 效果`)
      return
    } else {
      //TODO: 触发重复叠加
    }
  }

  // 移除印记
  removeMark(markName: string, removeAll: boolean = true): void {
    const mark = this.marks.get(markName)
    if (!mark) return

    if (removeAll) {
      this.marks.delete(markName)
      console.log(`${this.name} 的 ${markName} 效果消失`)
    } else {
      //TODO
    }
  }

  // 触发特定条件的效果
  triggerMarks(condition: TriggerCondition, source?: Pet, ...args: any[]): void {
    for (const [, mark] of this.marks) {
      for (const trigger of mark.triggers) {
        if (trigger === condition) {
          mark.effect.apply(this, [source, ...args])
        }
      }
    }
  }

  // 更新回合型印记
  updateRoundMarks(): void {
    for (const [name, mark] of this.marks) {
      if (mark instanceof DurationDecorator) {
        mark.duration--
        if (mark.duration <= 0) {
          this.marks.delete(name)
          console.log(`${this.name} 的 ${name} 效果消失`)
        }
      }
    }
  }

  private calculateStat(type: StatType): number {
    const baseStat = this.species.baseStats[type]
    const natureMultiplier = NatureMap[this.nature][type]
    const level = this.level
    const iv = this.ivs[type]
    const ev = this.evs[type]

    if (type === 'hp') {
      return Math.floor(((2 * baseStat + iv + Math.floor(ev / 4)) * level) / 100) + level + 10
    } else {
      return Math.floor(((2 * baseStat + iv + Math.floor(ev / 4)) * level) / 100 + 5) * natureMultiplier
    }
  }

  get attack(): number {
    return this.calculateStat(StatType.atk)
  }

  get defense(): number {
    return this.calculateStat(StatType.def)
  }

  get specialAttack(): number {
    return this.calculateStat(StatType.spa)
  }

  get specialDefense(): number {
    return this.calculateStat(StatType.spd)
  }

  get speed(): number {
    return this.calculateStat(StatType.spe)
  }
}
