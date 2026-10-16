import { AttributeSystem, type AttributeSystemState, type SkillAttributeSet } from './attributeSystem.js'
import type { skillId } from '@arcadia-eternity/const'
import type { Instance, OwnedEntity, EffectContainer } from './entity.js'
import type { BaseSkill } from './content.js'
import type { Pet } from './pet.js'
import { copyData } from './data.js'
import type { EffectReference } from './content.js'

export interface SkillState {
  attributes?: AttributeSystemState
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
  readonly attributeSystem: AttributeSystem<SkillAttributeSet>
  get power(): number {
    return this.attributeSystem.getCurrentValue('power')
  }
  set power(value: number) {
    this.rawPower = value
  }
  get accuracy(): number {
    return this.attributeSystem.getCurrentValue('accuracy')
  }
  set accuracy(value: number) {
    this.rawAccuracy = value
  }
  get rage(): number {
    return this.attributeSystem.getCurrentValue('rage')
  }
  set rage(value: number) {
    this.rawRage = value
  }
  get priority(): number {
    return this.attributeSystem.getCurrentValue('priority')
  }
  set priority(value: number) {
    this.rawPriority = value
  }
  get appeared(): boolean {
    return this.attributeSystem.getCurrentValue('appeared')
  }
  set appeared(value: boolean) {
    this.rawAppeared = value
  }
  readonly id: skillId
  base: BaseSkill
  readonly owner: Pet
  private rawPower: number
  private rawAccuracy: number
  private rawRage: number
  private rawPriority: number
  effectReferences?: readonly EffectReference[]
  private rawAppeared = false
  constructor(id: string, base: BaseSkill, owner: Pet) {
    this.id = id as skillId
    this.base = base
    this.owner = owner
    this.rawPower = base.power
    this.rawAccuracy = base.accuracy
    this.rawRage = base.rage
    this.rawPriority = base.priority
    this.attributeSystem = new AttributeSystem<SkillAttributeSet>(
      this,
      () => ({
        power: this.rawPower,
        accuracy: this.rawAccuracy,
        rage: this.rawRage,
        priority: this.rawPriority,
        appeared: this.rawAppeared,
      }),
      (key, value) => {
        if (key === 'power') {
          this.rawPower = value as number
          return true
        }
        if (key === 'accuracy') {
          this.rawAccuracy = value as number
          return true
        }
        if (key === 'rage') {
          this.rawRage = value as number
          return true
        }
        if (key === 'priority') {
          this.rawPriority = value as number
          return true
        }
        if (key === 'appeared') {
          this.rawAppeared = value as boolean
          return true
        }
        return false
      },
    )
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
      attributes: this.attributeSystem.snapshot(),
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
