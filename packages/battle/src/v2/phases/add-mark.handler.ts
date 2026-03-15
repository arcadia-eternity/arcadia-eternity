// battle/src/v2/phases/add-mark.handler.ts
import type { PhaseHandler, PhaseDef, PhaseResult, World, PhaseManager, EffectPipeline } from '@arcadia-eternity/engine'
import type { EventBus } from '@arcadia-eternity/engine'
import { getComponent } from '@arcadia-eternity/engine'
import { StackStrategy, EffectTrigger } from '@arcadia-eternity/const'
import type { MarkSystem } from '../systems/mark.system.js'
import { BATTLE_OWNER_ID } from '../systems/mark.system.js'
import type { AddMarkContextData } from '../schemas/context.schema.js'
import type { BaseMarkData } from '../schemas/mark.schema.js'
import type { V2DataRepository } from '../data/v2-data-repository.js'

const BASE_MARK = 'baseMark' as const

export interface AddMarkPhaseData {
  context: AddMarkContextData
}

export class AddMarkHandler implements PhaseHandler<AddMarkPhaseData> {
  readonly type = 'addMark'

  constructor(
    private markSystem: MarkSystem,
    private phaseManager: PhaseManager,
    private effectPipeline: EffectPipeline,
  ) {}

  initialize(_world: World, phase: PhaseDef): AddMarkPhaseData {
    return phase.data as AddMarkPhaseData
  }

  async execute(world: World, phase: PhaseDef, bus: EventBus): Promise<PhaseResult> {
    const data = phase.data as AddMarkPhaseData
    const ctx = data.context

    const baseMark = getComponent<BaseMarkData>(world, ctx.baseMarkId, BASE_MARK)
    if (!baseMark) {
      return { success: false, state: 'failed', error: `BaseMark '${ctx.baseMarkId}' not found` }
    }

    await this.effectPipeline.fire(world, EffectTrigger.OnBeforeAddMark, {
      trigger: EffectTrigger.OnBeforeAddMark,
      sourceEntityId: ctx.creatorId ?? ctx.targetId,
      context: ctx,
    })

    if (!ctx.available) {
      return { success: true, state: 'completed', data }
    }

    // Handle mutex group conflicts
    const mutexGroup = baseMark.config.mutexGroup
    if (mutexGroup) {
      const existingMutex = this.markSystem.findByMutexGroup(world, ctx.targetId, mutexGroup)
      for (const mark of existingMutex) {
        if (mark.baseMarkId === ctx.baseMarkId) continue
        await this.phaseManager.execute(world, 'removeMark', bus, {
          context: {
            type: 'remove-mark',
            parentId: phase.id,
            markId: mark.id,
            available: true,
          },
        })
      }
    }

    // Check for existing mark of the same base type
    const existing = this.markSystem.findByBaseId(world, ctx.targetId, ctx.baseMarkId)

    if (existing) {
      const existingConfig = this.markSystem.getConfig(world, existing.id)
      const strategy = existingConfig.stackStrategy as StackStrategy ?? StackStrategy.extend
      const stacksBefore = this.markSystem.getStack(world, existing.id)
      const durationBefore = this.markSystem.getDuration(world, existing.id)

      let stacksAfter = stacksBefore
      let durationAfter = durationBefore

      switch (strategy) {
        case StackStrategy.stack:
          stacksAfter = Math.min(stacksBefore + ctx.stack, existingConfig.maxStacks)
          durationAfter = Math.max(durationBefore, ctx.duration)
          break
        case StackStrategy.refresh:
          durationAfter = Math.max(durationBefore, ctx.duration)
          break
        case StackStrategy.extend:
          stacksAfter = Math.min(stacksBefore + ctx.stack, existingConfig.maxStacks)
          durationAfter = durationBefore + ctx.duration
          break
        case StackStrategy.max:
          stacksAfter = Math.min(Math.max(stacksBefore, ctx.stack), existingConfig.maxStacks)
          durationAfter = Math.max(durationBefore, ctx.duration)
          break
        case StackStrategy.replace:
          stacksAfter = ctx.stack
          durationAfter = ctx.duration
          break
        case StackStrategy.remove:
          await this.phaseManager.execute(world, 'removeMark', bus, {
            context: {
              type: 'remove-mark',
              parentId: phase.id,
              markId: existing.id,
              available: true,
            },
          })
          return { success: true, state: 'completed', data }
        case StackStrategy.none:
          return { success: true, state: 'completed', data }
      }

      // Keep mark attribute store in sync so dynamic selectors (e.g. mark.stack) see latest stacks.
      this.markSystem.setStack(world, existing.id, stacksAfter)
      this.markSystem.setDuration(world, existing.id, durationAfter)

      bus.emit(world, 'markStack', {
        targetId: ctx.targetId,
        markId: existing.id,
        baseMarkId: ctx.baseMarkId,
        stacksBefore,
        durationBefore,
        stacksAfter,
        durationAfter,
        strategy,
      })
    } else {
      const mark = this.markSystem.createFromBase(world, baseMark, {
        duration: ctx.duration,
        stack: ctx.stack,
        creatorId: ctx.creatorId,
      })
      const ownerType = ctx.targetId === BATTLE_OWNER_ID ? 'battle' : 'pet'
      this.markSystem.attach(world, mark.id, ctx.targetId, ownerType)
      const repo = world.meta.dataRepository as V2DataRepository
      if (!repo) {
        throw new Error('V2DataRepository not found in world.meta.dataRepository')
      }
      for (const effectId of mark.effectIds) {
        const effectDef = repo.getEffect(effectId)
        this.effectPipeline.attachEffect(world, mark.id, effectDef)
      }

      await this.effectPipeline.fire(world, EffectTrigger.OnMarkCreated, {
        trigger: EffectTrigger.OnMarkCreated,
        sourceEntityId: mark.id,
        markId: mark.id,
        baseMarkId: ctx.baseMarkId,
        targetId: ctx.targetId,
      }, [mark.id])

      bus.emit(world, 'markAdd', {
        targetId: ctx.targetId,
        markId: mark.id,
        baseMarkId: ctx.baseMarkId,
      })

      await this.effectPipeline.fire(world, EffectTrigger.OnAnyMarkAdded, {
        trigger: EffectTrigger.OnAnyMarkAdded,
        sourceEntityId: ctx.targetId,
        markId: mark.id,
        baseMarkId: ctx.baseMarkId,
        targetId: ctx.targetId,
      })
    }

    return { success: true, state: 'completed', data }
  }
}
