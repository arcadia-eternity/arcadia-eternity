import { removeMark } from './RemoveMarkPhase'
import { DurationType, Modifier } from '../attributeSystem'
import type { DeferredDamage } from './skill'
import { markParameterContract, normalizeMarkInstanceParams, sameMarkInstanceParams } from '../content/mark-parameters'
import {
  EffectTrigger,
  StackStrategy,
  BattleMessageType,
  type markId,
  type StatTypeWithoutHp,
} from '@arcadia-eternity/const'
import { AddMarkContext, type EffectContext, RemoveMarkContext, StackContext } from '../context'
import {
  StatLevelMarkInstanceImpl,
  BaseStatLevelMark,
  CreateStatStageMark,
  type BaseMark,
  type MarkInstance,
} from '../mark'
import { Pet } from '../pet'
import { ContextPhase } from './base'
import { MarkStackPhase } from './MarkStackPhase'

export function addMark(context: AddMarkContext) {
  context.battle.phaseManager.run(new AddMarkPhase(context))
  return context.result
}

class AddMarkPhase extends ContextPhase<AddMarkContext> {
  protected executeOperation(): void {
    const context = this.event
    const battle = this.battle

    context.result = undefined
    // Apply OnBeforeAddMark effects
    battle.applyEffects(context, EffectTrigger.OnBeforeAddMark)
    if (!context.available) {
      return
    }

    const contract = markParameterContract(context.baseMark)
    const instanceParams = normalizeMarkInstanceParams(context.baseMark, context.instanceParams)
    contract?.assertInstalled(battle.configSystem)
    const parameterizedExisting = contract
      ? context.target.marks.find(mark => matchesMarkApplication(mark, context.baseMark, context.deferredDamage))
      : undefined
    if (parameterizedExisting && !sameMarkInstanceParams(parameterizedExisting.instanceParams, instanceParams)) {
      context.result = 'parameter-conflict'
      return
    }

    // Handle mutex group conflicts
    if (context.baseMark.config.mutexGroup) {
      // Get existing marks in the same mutex group
      const existingMarks = context.target.marks.filter(
        m => m !== parameterizedExisting && m.config.mutexGroup === context.baseMark.config.mutexGroup,
      )

      // Remove all conflicting marks using RemoveMarkPhase
      existingMarks.forEach(mark => {
        const removeMarkContext = new RemoveMarkContext(context, mark)
        removeMark(removeMarkContext)
      })
    }

    // Create new mark instance
    const config = {
      id: battle.allocateEventId('mark') as markId,
      instanceParams,
      config: context.config,
      duration: context.duration ?? context.config?.duration,
      stack: context.stack ?? context.config?.maxStacks,
    }
    const newMark = context.baseMark.createInstance(config)
    newMark.deferredDamage = context.deferredDamage
    newMark.registerBattle(battle)

    // Check for existing stat level mark of the same stat type
    let existingStatLevelMark: StatLevelMarkInstanceImpl | undefined
    let existingOppositeMark: StatLevelMarkInstanceImpl | undefined

    if (newMark instanceof StatLevelMarkInstanceImpl && context.baseMark instanceof BaseStatLevelMark) {
      // For stat level marks, find by stat type instead of base id
      const baseStatLevelMark = context.baseMark as BaseStatLevelMark
      existingStatLevelMark = context.target.marks.find(
        mark =>
          mark instanceof StatLevelMarkInstanceImpl &&
          mark.base instanceof BaseStatLevelMark &&
          mark.base.statType === baseStatLevelMark.statType,
      ) as StatLevelMarkInstanceImpl | undefined

      // Check if it's an opposite mark (different sign)
      if (existingStatLevelMark && existingStatLevelMark.isOppositeMark(newMark)) {
        existingOppositeMark = existingStatLevelMark
        existingStatLevelMark = undefined
      }
    }

    // Check for existing mark of the same type (for non-stat level marks)
    const existingMark =
      existingStatLevelMark ||
      context.target.marks.find(mark => matchesMarkApplication(mark, context.baseMark, context.deferredDamage))

    if (existingMark || existingOppositeMark) {
      const targetMark = existingMark || existingOppositeMark!
      const strategy = targetMark.config.stackStrategy || StackStrategy.extend

      // Create StackContext with initial values (calculation will be done in MarkStackPhase)
      const stackPhase = new MarkStackPhase(
        battle,
        new StackContext(
          context,
          targetMark,
          newMark,
          targetMark.stack,
          targetMark.duration,
          newMark.stack, // Initial values, will be calculated in MarkStackPhase
          newMark.duration,
          strategy,
        ),
      )
      battle.phaseManager.run(stackPhase)
      return
    }

    const target = context.target
    newMark.owner = target
    newMark.emitter = target.emitter
    try {
      contract?.installScope(battle.configSystem, newMark)
      battle.applyEffects(context, EffectTrigger.OnMarkCreated, newMark)
      battle.applyEffects(context, EffectTrigger.OnAnyMarkAdded)
    } catch (error) {
      battle.configSystem.releaseScope(newMark)
      throw error
    }
    // Creation hooks run before insertion, and can change the pending mark's owner.
    newMark.owner = target
    if (newMark instanceof StatLevelMarkInstanceImpl && target instanceof Pet) bindStatStage(newMark, target)
    target.marks.push(newMark)
    battle.emitMessage(BattleMessageType.MarkApply, {
      baseMarkId: context.baseMark.id,
      target: target instanceof Pet ? target.id : 'battle',
      mark: newMark.toMessage(),
    })
  }
}

/** Ordinary marks and separate field positions can coexist on a battle. */
export function matchesMarkApplication(mark: MarkInstance, base: BaseMark, pending?: DeferredDamage): boolean {
  return mark.baseId === base.id && mark.deferredDamage?.target.playerId === pending?.target.playerId
}

export function addStatStage(
  context: EffectContext<EffectTrigger>,
  target: Pet,
  stat: StatTypeWithoutHp,
  level: number,
): void {
  addMark(new AddMarkContext(context, target, CreateStatStageMark(stat, level), level))
}

export function bindStatStage(mark: StatLevelMarkInstanceImpl, owner: Pet): void {
  mark.modifierCleanupFn?.()
  const modifier = new Modifier(
    DurationType.binding,
    `stat_stage_${mark.statType}_${mark.id}`,
    mark.stageMultiplier$,
    'percent',
    1000,
    mark,
  )
  mark.modifierCleanupFn = owner.attributeSystem.addModifier(mark.statType, modifier)
}
