import type { markId } from '@arcadia-eternity/const'
import type { Instance, OwnedEntity, MarkOwner, EffectContainer } from './entity.js'
import type { BaseMark, MarkConfig } from './content.js'
import { copyData } from './data.js'
import type { EffectReference } from './content.js'

export interface MarkState {
  id: string
  baseId: string
  effects?: EffectReference[]
  ownerId: string
  stack: number
  duration: number
  isActive: boolean
  config: MarkConfig
  creatorId: string | null
}
export class Mark implements Instance<BaseMark, markId>, OwnedEntity<MarkOwner>, EffectContainer {
  stack: number
  duration: number
  isActive = true
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
    this.stack = Math.min(stack, this.config.maxStacks)
    this.duration = this.config.duration
  }
  get battle() {
    return this.owner.battle
  }
  get effects() {
    return this.effectReferences ?? this.base.effects
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
      baseId: this.base.id,
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
