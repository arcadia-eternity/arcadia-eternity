import { EffectTrigger, StackStrategy } from '@arcadia-eternity/const'
import {
  AddMarkContext,
  RemoveMarkContext,
  StackContext,
  ConsumeStackContext,
  MarkTransferContext,
  SwitchPetContext,
  TurnContext,
  type MarkOperationParent,
} from '../context.js'
import type { Mark } from '../mark.js'
import { Mark as MarkInstance } from '../mark.js'
import { Pet } from '../pet.js'
import { copyData, requireNumber } from '../data.js'
import { SynchronousPhase } from './base.js'

export class AddMarkPhase extends SynchronousPhase<AddMarkContext, Mark | null> {
  readonly kind = 'add-mark'
  protected executeOperation() {
    const ctx = this.context,
      battle = this.battle
    if (ctx.target.battle !== battle) throw new Error('Mark owner belongs to another battle')
    battle.applyEffects(ctx, EffectTrigger.OnBeforeAddMark)
    if (!ctx.available) return null
    if (ctx.statStage) {
      if (!(ctx.target instanceof Pet)) throw new Error('Stat stage requires a Pet owner')
      const { stat, level } = ctx.statStage,
        before = ctx.target.stages[stat],
        next = Math.max(-6, Math.min(6, before + level))
      for (const mark of [...ctx.target.marks])
        if (mark.base.id.startsWith(`stat_stage_${stat}_`)) battle.removeMark(new RemoveMarkContext(ctx, mark, true))
      if (next === 0) {
        battle.emitEvent('statStageChange', { petId: ctx.target.id, stat, before, stage: next })
        return null
      }
      ctx.baseMark = battle.content.mark(`stat_stage_${stat}_${next > 0 ? 'up' : 'down'}`)
      ctx.stack = Math.abs(next)
      ctx.config = copyData(ctx.baseMark.config)
      ctx.duration = ctx.config.duration
      const mark = this.attach()
      battle.emitEvent('statStageChange', { petId: ctx.target.id, stat, before, stage: next })
      return mark
    }
    return this.attach()
  }
  private attach(): Mark | null {
    const ctx = this.context,
      battle = this.battle
    requireNumber(ctx.stack, 'mark stack', 1)
    requireNumber(ctx.config.maxStacks, 'mark max stacks', 1)
    if (!Number.isInteger(ctx.duration) || ctx.duration < -1) throw new Error('Invalid mark duration override')
    const existing = ctx.target.marks.find(mark => mark.base.id === ctx.baseMark.id && mark.isActive)
    if (existing) {
      battle.phaseManager.executeSync(new MarkStackPhase(new StackContext(ctx, existing)))
      return existing
    }
    for (const mark of [...ctx.target.marks])
      if (ctx.config.mutexGroup && mark.config.mutexGroup === ctx.config.mutexGroup)
        battle.removeMark(new RemoveMarkContext(ctx, mark, true))
    const mark = new MarkInstance(
      battle.allocateMarkId(),
      ctx.baseMark,
      ctx.target,
      ctx.stack,
      ctx.creatorId,
      ctx.config,
    )
    mark.duration = ctx.duration
    ctx.createdMark = mark
    ctx.target.marks.push(mark)
    battle.emitEvent('markAdded', {
      markId: mark.id,
      baseMarkId: mark.base.id,
      ownerId: mark.owner.id,
      stack: mark.stack,
      duration: mark.duration,
    })
    battle.applyEffects(ctx, EffectTrigger.OnMarkCreated, [mark])
    battle.applyEffects(ctx, EffectTrigger.OnAnyMarkAdded)
    return mark
  }
}
export class RemoveMarkPhase extends SynchronousPhase<RemoveMarkContext> {
  readonly kind = 'remove-mark'
  protected executeOperation() {
    const ctx = this.context,
      mark = ctx.mark,
      battle = this.battle
    if (!mark.isActive || (!ctx.force && !mark.config.destroyable)) return
    battle.applyEffects(ctx, EffectTrigger.OnRemoveMark, [mark])
    if (!ctx.available) return
    mark.isActive = false
    battle.valueSystem.removeSource(mark.id)
    battle.applyEffects(ctx, EffectTrigger.OnMarkDestroy, [mark])
    battle.transformationSystem.cleanupMark(mark, ctx)
    battle.emitEvent('markRemoved', { markId: mark.id, baseMarkId: mark.base.id, ownerId: mark.owner.id })
    mark.owner.marks = mark.owner.marks.filter(m => m !== mark)
  }
}
export class MarkStackPhase extends SynchronousPhase<StackContext> {
  readonly kind = 'mark-stack'
  protected executeOperation() {
    const ctx = this.context,
      mark = ctx.existingMark,
      config = mark.config,
      incoming = ctx.parent
    if (!config.stackable) return
    if (config.stackStrategy === StackStrategy.remove) {
      this.battle.removeMark(new RemoveMarkContext(incoming, mark, true))
      return
    }
    switch (config.stackStrategy) {
      case StackStrategy.stack:
        ctx.stacksAfter = Math.min(config.maxStacks, mark.stack + incoming.stack)
        ctx.durationAfter = incoming.duration
        break
      case StackStrategy.refresh:
        ctx.durationAfter = incoming.duration
        break
      case StackStrategy.extend:
        ctx.stacksAfter = Math.min(config.maxStacks, mark.stack + incoming.stack)
        ctx.durationAfter = mark.duration + incoming.duration
        break
      case StackStrategy.max:
        ctx.stacksAfter = Math.min(config.maxStacks, Math.max(mark.stack, incoming.stack))
        ctx.durationAfter = incoming.duration
        break
      case StackStrategy.replace:
        ctx.stacksAfter = Math.min(config.maxStacks, incoming.stack)
        ctx.durationAfter = incoming.duration
        break
      case StackStrategy.none:
        break
    }
    this.battle.applyEffects(ctx, EffectTrigger.OnStackBefore)
    if (!ctx.available) return
    mark.stack = Math.max(0, Math.min(config.maxStacks, ctx.stacksAfter))
    mark.duration = ctx.durationAfter
    this.battle.applyEffects(ctx, EffectTrigger.OnStack)
    if (mark.stack === 0) this.battle.removeMark(new RemoveMarkContext(ctx, mark, true))
  }
}
export class ConsumeStackPhase extends SynchronousPhase<ConsumeStackContext, number> {
  readonly kind = 'consume-stack'
  protected executeOperation() {
    const ctx = this.context,
      mark = ctx.mark
    requireNumber(ctx.amount, 'stack consumption')
    if (!mark.isActive) return 0
    this.battle.applyEffects(ctx, EffectTrigger.OnBeforeConsumeStack, [mark])
    if (!ctx.available) return 0
    const before = mark.stack
    mark.stack -= Math.min(before, ctx.amount)
    ctx.consumed = Math.max(0, before - mark.stack)
    this.battle.applyEffects(ctx, EffectTrigger.OnConsumeStack, [mark])
    if (mark.stack <= 0) this.battle.removeMark(new RemoveMarkContext(ctx, mark, true))
    return ctx.consumed
  }
}
export class MarkTransferPhase extends SynchronousPhase<MarkTransferContext> {
  readonly kind = 'mark-transfer'
  protected executeOperation() {
    const { mark, target } = this.context
    if (target.battle !== this.battle) throw new Error('Cannot transfer a mark between battles')
    mark.setOwner(target)
  }
}
export class MarkSwitchOutPhase extends SynchronousPhase<SwitchPetContext> {
  readonly kind = 'mark-switch-out'
  protected executeOperation() {
    const ctx = this.context,
      battle = this.battle
    battle.applyEffects(ctx, EffectTrigger.OnOwnerSwitchOut, [...ctx.outgoing.marks])
    for (const mark of [...ctx.outgoing.marks]) {
      if (mark.config.transferOnSwitch || (!ctx.outgoing.isAlive && mark.config.inheritOnFaint))
        battle.phaseManager.executeSync(new MarkTransferPhase(new MarkTransferContext(ctx, mark, ctx.incoming)))
      else if (!mark.config.keepOnSwitchOut) battle.removeMark(new RemoveMarkContext(ctx, mark, true))
    }
  }
}
export class MarkUpdatePhase extends SynchronousPhase<TurnContext> {
  readonly kind = 'mark-update'
  constructor(
    context: TurnContext,
    readonly mark: Mark,
  ) {
    super(context)
  }
  protected executeOperation() {
    const mark = this.mark
    if (!mark.isActive || mark.config.persistent) return
    if (mark.duration > 0) {
      mark.duration--
      this.battle.emitEvent('markDuration', { markId: mark.id, duration: mark.duration })
    }
    if (mark.duration === 0) {
      this.battle.applyEffects(this.context, EffectTrigger.OnMarkDurationEnd, [mark])
      this.battle.removeMark(new RemoveMarkContext(this.context, mark, true))
    }
  }
}
export class MarkCleanupPhase<C extends MarkOperationParent> extends SynchronousPhase<C> {
  readonly kind = 'mark-cleanup'
  protected executeOperation() {
    for (const owner of [this.battle, ...this.battle.players.flatMap(p => p.team)]) {
      for (const mark of [...owner.marks]) {
        if (!mark.isActive) {
          this.battle.valueSystem.removeSource(mark.id)
          this.battle.transformationSystem.cleanupMark(mark, new RemoveMarkContext(this.context, mark, true))
        } else if (mark.stack <= 0) this.battle.removeMark(new RemoveMarkContext(this.context, mark, true))
      }
      owner.marks = owner.marks.filter(mark => mark.isActive && mark.stack > 0)
    }
  }
}
