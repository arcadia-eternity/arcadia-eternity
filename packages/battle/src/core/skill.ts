import type { skillId } from '@arcadia-eternity/const'
import type { Instance, OwnedEntity, EffectContainer } from './entity.js'
import type { BaseSkill } from './content.js'
import type { Pet } from './pet.js'
import { copyData } from './data.js'
import type { EffectReference } from './content.js'

export interface SkillState {
  id: string
  baseId: string
  effects?: EffectReference[]
  power: number
  accuracy: number
  rage: number
  priority: number
  appeared: boolean
}
export class Skill implements Instance<BaseSkill, skillId>, OwnedEntity<Pet>, EffectContainer {
  readonly id: skillId
  base: BaseSkill
  readonly owner: Pet
  power: number
  accuracy: number
  rage: number
  priority: number
  effectReferences?: readonly EffectReference[]
  appeared = false
  constructor(id: string, base: BaseSkill, owner: Pet) {
    this.id = id as skillId
    this.base = base
    this.owner = owner
    this.power = base.power
    this.accuracy = base.accuracy
    this.rage = base.rage
    this.priority = base.priority
  }
  get battle() {
    return this.owner.battle
  }
  setOwner(owner: Pet) {
    if (owner !== this.owner) throw new Error('Skill ownership is fixed for this battle instance')
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
    return this.effectReferences ?? this.base.effects
  }
  getState(): SkillState {
    return copyData({
      id: this.id,
      baseId: this.base.id,
      effects: this.effectReferences ? [...this.effectReferences] : undefined,
      power: this.power,
      accuracy: this.accuracy,
      rage: this.rage,
      priority: this.priority,
      appeared: this.appeared,
    })
  }
}
