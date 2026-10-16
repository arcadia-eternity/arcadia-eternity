import { StackStrategy } from '@arcadia-eternity/const'
import type { BaseMark, MarkConfig } from './content.js'
import type { Battle } from './battle.js'
import type { Pet } from './pet.js'
import { copyData } from './data.js'

export interface MarkState {
  id: string
  baseId: string
  ownerId: string
  stack: number
  duration: number
  isActive: boolean
  config: MarkConfig
  creatorId: string | null
}
export class Mark {
  stack: number
  duration: number
  isActive = true
  config: MarkConfig
  constructor(
    readonly id: string,
    readonly base: BaseMark,
    public owner: Pet | Battle,
    stack = 1,
    readonly creatorId: string | null = null,
  ) {
    this.config = copyData(base.config)
    this.stack = Math.min(stack, this.config.maxStacks)
    this.duration = this.config.duration
  }
  merge(stack: number) {
    if (!this.config.stackable) return
    switch (this.config.stackStrategy) {
      case StackStrategy.stack:
        this.stack = Math.min(this.config.maxStacks, this.stack + stack)
        this.duration = this.config.duration
        break
      case StackStrategy.refresh:
        this.duration = this.config.duration
        break
      case StackStrategy.extend:
        this.stack = Math.min(this.config.maxStacks, this.stack + stack)
        this.duration += this.config.duration
        break
      case StackStrategy.max:
        this.stack = Math.min(this.config.maxStacks, Math.max(this.stack, stack))
        this.duration = this.config.duration
        break
      case StackStrategy.replace:
        this.stack = Math.min(this.config.maxStacks, stack)
        this.duration = this.config.duration
        break
      case StackStrategy.remove: // Battle routes this through the common destruction lifecycle.
        break
      case StackStrategy.none:
        break
    }
  }
  getState(): MarkState {
    return copyData({
      id: this.id,
      baseId: this.base.id,
      ownerId: this.owner.id,
      stack: this.stack,
      duration: this.duration,
      isActive: this.isActive,
      config: this.config,
      creatorId: this.creatorId,
    })
  }
}
