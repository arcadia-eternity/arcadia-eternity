import { StackStrategy, EffectTrigger, BattleMessageType, type markId } from '@arcadia-eternity/const'
import type { Battle } from '../battle'
import { RemoveMarkContext, type StackContext } from '../context'
import { CreateStatStageMark, StatLevelMarkInstanceImpl } from '../mark'
import { Pet } from '../pet'
import { SynchronousPhase } from './base'

export class MarkStackPhase extends SynchronousPhase<StackContext> {
  constructor(battle: Battle, stackContext: StackContext, id?: string) {
    super(battle, id)
    this._context = stackContext
  }

  protected createContext(): StackContext {
    return this._context!
  }

  protected executeOperation(): void {
    const context = this._context!
    const battle = this.battle

    const existingMark = context.existingMark
    const newMark = context.incomingMark
    const strategy = context.stackStrategy

    // Handle special strategies that don't modify values
    if (strategy === StackStrategy.remove) {
      battle.removeMark(new RemoveMarkContext(context, existingMark))
      return
    }

    if (strategy === StackStrategy.none) {
      return
    }

    // Handle StatLevel marks with special logic
    if (existingMark instanceof StatLevelMarkInstanceImpl && newMark instanceof StatLevelMarkInstanceImpl) {
      const level = Math.max(-6, Math.min(6, existingMark.level + newMark.level))
      if (level === 0) {
        battle.removeMark(new RemoveMarkContext(context, existingMark))
        return
      }
      const owner = existingMark.owner
      let updated = existingMark
      if (Math.sign(existingMark.level) === Math.sign(level)) {
        existingMark.level = level
      } else {
        if (!owner) return
        const base = CreateStatStageMark(existingMark.base.statType, level)
        updated = base.createInstance({ id: battle.allocateEventId('mark') as markId })
        updated.level = level
        updated.duration = existingMark.duration
        updated.config = { ...existingMark.config }
        if (existingMark.emitter) updated.setOwner(owner, existingMark.emitter)
        const index = owner.marks.indexOf(existingMark)
        if (index !== -1) owner.marks[index] = updated
        existingMark.detach()
        updated.attachTo(owner)
        existingMark.isActive = false
        battle.configSystem.releaseScope(existingMark)
      }
      battle.emitMessage(BattleMessageType.MarkUpdate, {
        target: owner instanceof Pet ? owner.id : 'battle',
        mark: updated.toMessage(),
      })
      return
    }

    // Handle regular marks with standard stacking strategies
    const maxStacks = existingMark.config.maxStacks ?? Infinity
    let newStacks = existingMark.stack
    let newDuration = existingMark.duration

    // Apply stacking strategy
    switch (strategy) {
      case StackStrategy.stack:
        newStacks = Math.min(newStacks + newMark.stack, maxStacks)
        newDuration = Math.max(newDuration, newMark.duration)
        break

      case StackStrategy.refresh:
        newDuration = Math.max(newDuration, newMark.duration)
        break

      case StackStrategy.extend:
        newStacks = Math.min(newStacks + newMark.stack, maxStacks)
        newDuration += newMark.duration
        break

      case StackStrategy.max:
        newStacks = Math.min(Math.max(newStacks, newMark.stack), maxStacks)
        newDuration = Math.max(newDuration, newMark.duration)
        break

      case StackStrategy.replace:
        newStacks = Math.min(newMark.stack, maxStacks)
        newDuration = newMark.duration
        break

      default:
        return
    }

    // Update context with calculated values
    context.stacksAfter = newStacks
    context.durationAfter = newDuration

    // Apply OnStackBefore effects (allows effects to modify the calculated values)
    battle.applyEffects(context, EffectTrigger.OnStackBefore)

    // Use potentially modified values from OnStackBefore effects
    const finalStacks = context.stacksAfter
    const finalDuration = context.durationAfter

    // Apply final results
    if (strategy === StackStrategy.replace) existingMark.deferredDamage = newMark.deferredDamage
    existingMark.attributeSystem.updateBaseValue('stack', Math.max(0, finalStacks))
    existingMark.duration = finalDuration
    existingMark.isActive = true

    // Apply OnStack effects
    battle.applyEffects(context, EffectTrigger.OnStack)

    // Check if mark should be destroyed (when stacks reach 0)
    if (existingMark.stack <= 0) {
      battle.removeMark(new RemoveMarkContext(context, existingMark))
      return
    }

    // Emit mark update message
    battle.emitMessage(BattleMessageType.MarkUpdate, {
      target: existingMark.owner instanceof Pet ? existingMark.owner.id : 'battle',
      mark: existingMark.toMessage(),
    })
  }
}
