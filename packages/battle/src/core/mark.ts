import { AttributeSystem, type AttributeSystemState, type MarkAttributeSet } from './attributeSystem.js'
import type { markId } from '@arcadia-eternity/const'
import type { Instance, OwnedEntity, MarkOwner, EffectContainer } from './entity.js'
import type { BaseMark, MarkConfig } from './content.js'
import { copyData } from './data.js'
import type { EffectReference } from './content.js'

export interface MarkState {
  attributes?: AttributeSystemState
  id: string
  baseId: string
  effects?: EffectReference[]
  effectsSuppressed?: true
  ownerId: string
  stack: number
  duration: number
  isActive: boolean
  config: MarkConfig
  creatorId: string | null
}
export class Mark implements Instance<BaseMark, markId>, OwnedEntity<MarkOwner>, EffectContainer {
  readonly attributeSystem: AttributeSystem<MarkAttributeSet>
  get stack(): number {
    return this.attributeSystem.getCurrentValue('stack')
  }
  set stack(value: number) {
    this.attributeSystem.setCurrentValue('stack', value)
  }
  get duration(): number {
    return this.attributeSystem.getCurrentValue('duration')
  }
  set duration(value: number) {
    this.attributeSystem.setCurrentValue('duration', value)
  }
  get isActive(): boolean {
    return this.rawIsActive && this.attributeSystem.getCurrentValue('isActive')
  }
  set isActive(value: boolean) {
    this.rawIsActive = value
  }
  private rawStack: number
  private rawDuration: number
  private rawIsActive = true
  effectsSuppressed = false
  effectReferences?: readonly EffectReference[]
  config: MarkConfig
  constructor(
    readonly id: markId,
    public base: BaseMark,
    public owner: MarkOwner,
    stack = 1,
    readonly creatorId: string | null = null,
    config: MarkConfig = base.config,
  ) {
    this.config = copyData(config)
    this.rawStack = Math.min(stack, this.config.maxStacks)
    this.rawDuration = this.config.duration
    this.attributeSystem = new AttributeSystem<MarkAttributeSet>(
      this,
      () => ({ stack: this.rawStack, duration: this.rawDuration, isActive: this.rawIsActive }),
      (key, value) => {
        if (key === 'stack') {
          this.rawStack = value as number
          return true
        }
        if (key === 'duration') {
          this.rawDuration = value as number
          return true
        }
        if (key === 'isActive') {
          this.rawIsActive = value as boolean
          return true
        }
        return false
      },
      undefined,
      ['stack', 'duration'],
      key => (key === 'stack' ? this.config.maxStacks : undefined),
    )
  }
  get battle() {
    return this.owner.battle
  }
  get effects() {
    return this.effectsSuppressed ? [] : (this.effectReferences ?? this.base.effects)
  }
  setOwner(owner: MarkOwner) {
    this.battle.assertInOperation()
    if (owner.battle !== this.battle) throw new Error('Cannot change mark battle ownership')
    if (owner === this.owner) return
    this.owner.marks = this.owner.marks.filter(mark => mark !== this)
    this.owner = owner
    if (!owner.marks.includes(this)) owner.marks.push(this)
  }
  getState(): MarkState {
    return copyData({
      id: this.id,
      attributes: this.attributeSystem.snapshot(),
      baseId: this.base.id,
      effectsSuppressed: this.effectsSuppressed ? true : undefined,
      effects: this.effectReferences ? [...this.effectReferences] : undefined,
      ownerId: this.owner.id,
      stack: this.stack,
      duration: this.duration,
      isActive: this.isActive,
      config: this.config,
      creatorId: this.creatorId,
    })
  }
}
