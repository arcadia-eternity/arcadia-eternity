import type { BaseSkill } from './content.js'
import type { Pet } from './pet.js'
import { copyData } from './data.js'

export interface SkillState {
  id: string
  baseId: string
  power: number
  accuracy: number
  rage: number
  priority: number
  appeared: boolean
}
export class Skill {
  readonly id: string
  readonly base: BaseSkill
  readonly owner: Pet
  power: number
  accuracy: number
  rage: number
  priority: number
  appeared = false
  constructor(id: string, base: BaseSkill, owner: Pet) {
    this.id = id
    this.base = base
    this.owner = owner
    this.power = base.power
    this.accuracy = base.accuracy
    this.rage = base.rage
    this.priority = base.priority
  }
  get category() {
    return this.base.category
  }
  get element() {
    return this.base.element
  }
  get target() {
    return this.base.target
  }
  get multihit() {
    return this.base.multihit
  }
  get sureHit() {
    return this.base.sureHit
  }
  get sureCrit() {
    return this.base.sureCrit
  }
  get ignoreShield() {
    return this.base.ignoreShield
  }
  get tags() {
    return this.base.tags
  }
  get effects() {
    return this.base.effects
  }
  getState(): SkillState {
    return copyData({
      id: this.id,
      baseId: this.base.id,
      power: this.power,
      accuracy: this.accuracy,
      rage: this.rage,
      priority: this.priority,
      appeared: this.appeared,
    })
  }
}
