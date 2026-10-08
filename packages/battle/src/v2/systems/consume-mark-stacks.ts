import type { World } from '@arcadia-eternity/engine'
import { EffectTrigger } from '@arcadia-eternity/const'
import type { BattleSystems } from './interpreter/context.js'
import type { ConsumeStackContextData } from '../schemas/context.schema.js'

/** Shared effect/shield consumption path, including hooks and client notifications. */
export async function consumeMarkStacks(world: World, markId: string, amount: number): Promise<number> {
  const { markSystem, effectPipeline, phaseManager, eventBus } = world.systems as unknown as BattleSystems
  if (!Number.isFinite(amount) || amount <= 0 || !markSystem.get(world, markId)) return 0
  if (!markSystem.isActive(world, markId)) return 0

  const context: ConsumeStackContextData = {
    type: 'consumeStack',
    parentId: world.phaseStack.at(-1)?.id ?? '',
    markId,
    requestedAmount: amount,
    actualAmount: 0,
    available: true,
  }
  await effectPipeline.fire(world, EffectTrigger.OnBeforeConsumeStack, {
    trigger: EffectTrigger.OnBeforeConsumeStack,
    sourceEntityId: markId,
    context,
  })
  if (!context.available || !markSystem.get(world, markId) || !markSystem.isActive(world, markId)) return 0

  const currentStack = markSystem.getStack(world, markId)
  const actual = Math.min(amount, Math.max(0, currentStack))
  if (actual <= 0) return 0

  // Keep the entity active until its consume/destroy effects have run.
  markSystem.setStack(world, markId, currentStack - actual)
  context.actualAmount = actual
  await effectPipeline.fire(world, EffectTrigger.OnConsumeStack, {
    trigger: EffectTrigger.OnConsumeStack,
    sourceEntityId: markId,
    context,
  })

  const mark = markSystem.get(world, markId)
  if (!mark) return actual
  if (markSystem.getStack(world, markId) <= 0 && markSystem.getConfig(world, markId).destroyable) {
    const result = await phaseManager.execute(world, 'removeMark', eventBus, {
      context: { type: 'remove-mark', parentId: context.parentId, markId, available: true },
    })
    if (!result.success) throw new Error(result.error ?? `Failed to remove consumed mark '${markId}'`)
  } else {
    eventBus.emit(world, 'markUpdate', {
      markId,
      baseMarkId: mark.baseMarkId,
      ownerId: mark.ownerId,
      stack: markSystem.getStack(world, markId),
      duration: markSystem.getDuration(world, markId),
    })
  }
  return actual
}
