import { EffectTrigger, CleanStageStrategy, StatTypeWithoutHp } from '@arcadia-eternity/const'
import type { Battle } from '../battle'
import { EffectContext } from '../context'
import type { MarkOwner } from '../entity'
import { CreateStatStageMark } from '../mark'
import { SynchronousPhase } from './base'
import { AddMarkPhase } from './AddMarkPhase'
import { RemoveMarkPhase } from './RemoveMarkPhase'

/**
 * StatStagePhase handles stat stage operations including:
 * - Adding stat stages
 * - Setting stat stages
 * - Clearing stat stages
 * - Reversing stat stages
 */
export class StatStagePhase extends SynchronousPhase<EffectContext<EffectTrigger>> {
  constructor(
    battle: Battle,
    private readonly parentContext: EffectContext<EffectTrigger>,
    private readonly target: MarkOwner,
    private readonly operation: 'add' | 'set' | 'clear' | 'reverse',
    private readonly statType?: StatTypeWithoutHp,
    private readonly value?: number,
    private readonly cleanStageStrategy?: CleanStageStrategy,
    private readonly statTypes?: StatTypeWithoutHp[],
    id?: string,
  ) {
    super(battle, id)
  }

  protected createContext(): EffectContext<EffectTrigger> {
    return this.parentContext
  }

  protected executeOperation(): void {
    switch (this.operation) {
      case 'add':
        this.executeAddStatStage()
        break
      case 'set':
        this.executeSetStatStage()
        break
      case 'clear':
        this.executeClearStatStage()
        break
      case 'reverse':
        this.executeReverseStatStage()
        break
      default:
        throw new Error(`Unknown stat stage operation: ${this.operation}`)
    }
  }

  private executeAddStatStage(): void {
    if (!this.statType || this.value === undefined) {
      throw new Error('Stat type and value are required for add operation')
    }

    const upMark = CreateStatStageMark(this.statType, this.value)
    const addMarkPhase = new AddMarkPhase(this.battle, this.parentContext, this.target, upMark)
    this.battle.phaseManager.registerPhase(addMarkPhase)
    this.battle.phaseManager.executePhase(addMarkPhase.id)
  }

  private executeSetStatStage(): void {
    if (!this.statType || this.value === undefined) {
      throw new Error('Stat type and value are required for set operation')
    }

    // First clear all stat stages for this type
    this.executeClearStatStageInternal(CleanStageStrategy.all, this.statType)
    
    // Then add the new stat stage if value is not zero
    if (this.value !== 0) {
      this.executeAddStatStage()
    }
  }

  private executeClearStatStage(): void {
    if (!this.cleanStageStrategy || !this.statTypes) {
      throw new Error('Clean strategy and stat types are required for clear operation')
    }

    this.executeClearStatStageInternal(this.cleanStageStrategy, ...this.statTypes)
  }

  private executeReverseStatStage(): void {
    if (!this.cleanStageStrategy || !this.statTypes) {
      throw new Error('Clean strategy and stat types are required for reverse operation')
    }

    this.executeReverseStatStageInternal(this.cleanStageStrategy, ...this.statTypes)
  }

  private executeClearStatStageInternal(
    cleanStageStrategy: CleanStageStrategy,
    ...statTypes: StatTypeWithoutHp[]
  ): void {
    if (!statTypes || statTypes.length === 0) {
      statTypes = [
        StatTypeWithoutHp.atk,
        StatTypeWithoutHp.def,
        StatTypeWithoutHp.spa,
        StatTypeWithoutHp.spd,
        StatTypeWithoutHp.spe,
      ]
    }

    statTypes.forEach(statType => {
      // Find all stat stage marks for this stat type
      const statStageMarks = this.target.marks.filter(
        mark => mark.config.isStatStageMark && mark.config.statType === statType,
      )

      statStageMarks.forEach(mark => {
        const stage = mark.config.statStageValue || 0
        const shouldClear =
          cleanStageStrategy === CleanStageStrategy.all ||
          (cleanStageStrategy === CleanStageStrategy.positive && stage > 0) ||
          (cleanStageStrategy === CleanStageStrategy.negative && stage < 0)

        if (shouldClear) {
          const removeMarkPhase = new RemoveMarkPhase(this.battle, this.parentContext, mark)
          this.battle.phaseManager.registerPhase(removeMarkPhase)
          this.battle.phaseManager.executePhase(removeMarkPhase.id)
        }
      })
    })
  }

  private executeReverseStatStageInternal(
    cleanStageStrategy: CleanStageStrategy,
    ...statTypes: StatTypeWithoutHp[]
  ): void {
    if (!statTypes || statTypes.length === 0) {
      statTypes = [
        StatTypeWithoutHp.atk,
        StatTypeWithoutHp.def,
        StatTypeWithoutHp.spa,
        StatTypeWithoutHp.spd,
        StatTypeWithoutHp.spe,
      ]
    }

    statTypes.forEach(statType => {
      // Find all stat stage marks for this stat type
      const statStageMarks = this.target.marks.filter(
        mark => mark.config.isStatStageMark && mark.config.statType === statType,
      )

      statStageMarks.forEach(mark => {
        const stage = mark.config.statStageValue || 0
        const shouldReverse =
          cleanStageStrategy === CleanStageStrategy.all ||
          (cleanStageStrategy === CleanStageStrategy.positive && stage > 0) ||
          (cleanStageStrategy === CleanStageStrategy.negative && stage < 0)

        if (shouldReverse) {
          // Remove the existing mark
          const removeMarkPhase = new RemoveMarkPhase(this.battle, this.parentContext, mark)
          this.battle.phaseManager.registerPhase(removeMarkPhase)
          this.battle.phaseManager.executePhase(removeMarkPhase.id)

          // Add a new mark with reversed stage
          const reversedMark = CreateStatStageMark(statType, -stage)
          const addMarkPhase = new AddMarkPhase(this.battle, this.parentContext, this.target, reversedMark)
          this.battle.phaseManager.registerPhase(addMarkPhase)
          this.battle.phaseManager.executePhase(addMarkPhase.id)
        }
      })
    })
  }
}

/**
 * Helper functions to create StatStagePhase instances for different operations
 */
export function createAddStatStagePhase(
  battle: Battle,
  context: EffectContext<EffectTrigger>,
  target: MarkOwner,
  statType: StatTypeWithoutHp,
  value: number,
): StatStagePhase {
  return new StatStagePhase(battle, context, target, 'add', statType, value)
}

export function createSetStatStagePhase(
  battle: Battle,
  context: EffectContext<EffectTrigger>,
  target: MarkOwner,
  statType: StatTypeWithoutHp,
  value: number,
): StatStagePhase {
  return new StatStagePhase(battle, context, target, 'set', statType, value)
}

export function createClearStatStagePhase(
  battle: Battle,
  context: EffectContext<EffectTrigger>,
  target: MarkOwner,
  cleanStageStrategy: CleanStageStrategy = CleanStageStrategy.positive,
  ...statTypes: StatTypeWithoutHp[]
): StatStagePhase {
  return new StatStagePhase(battle, context, target, 'clear', undefined, undefined, cleanStageStrategy, statTypes)
}

export function createReverseStatStagePhase(
  battle: Battle,
  context: EffectContext<EffectTrigger>,
  target: MarkOwner,
  cleanStageStrategy: CleanStageStrategy = CleanStageStrategy.positive,
  ...statTypes: StatTypeWithoutHp[]
): StatStagePhase {
  return new StatStagePhase(battle, context, target, 'reverse', undefined, undefined, cleanStageStrategy, statTypes)
}