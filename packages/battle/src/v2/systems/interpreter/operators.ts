// battle/src/v2/systems/interpreter/operators.ts
// Operator execution for effect DSL.
// All ~60 operator types fully implemented.

import type { InterpreterContext, InterpreterFireContext } from './context.js'
import type { UseSkillContextData, DamageContextData } from '../../schemas/context.schema.js'
import type { BaseMarkData } from '../../schemas/mark.schema.js'
import type { OperatorDSL, Value } from '@arcadia-eternity/schema'
import type { ConfigValue, ConfigModifierType, EffectDef } from '@arcadia-eternity/engine'
import {
  getComponent,
  setConfigValue,
  registerConfig,
  addConfigModifier,
  getConfigKeysByTag,
} from '@arcadia-eternity/engine'
import {
  applyTransformation,
  removeTransformation,
} from '@arcadia-eternity/plugin-transformation'
import { resolveSelector } from './selector.js'
import { resolveValue } from './value.js'
import { evaluateCondition } from './conditions.js'
import { isDamageContext, isRecord, isSelectorDsl, isUseSkillContext } from './type-guards.js'

/**
 * Get the current phase ID from the phase stack (for parentId).
 */
function getCurrentPhaseId(ctx: InterpreterContext): string {
  const { world } = ctx
  const stack = world.phaseStack
  return stack.length > 0 ? stack[stack.length - 1].id : ''
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

function asSelectorDsl(value: unknown): import('@arcadia-eternity/schema').SelectorDSL | undefined {
  return isSelectorDsl(value) ? value : undefined
}

function getDynamicSelectorFromValue(
  value: unknown,
): import('@arcadia-eternity/schema').SelectorDSL | undefined {
  if (!isRecord(value)) return undefined
  if (value.type !== 'dynamic') return undefined
  return asSelectorDsl(value.selector)
}

function asConfigModifierType(value: unknown): ConfigModifierType {
  if (value === 'override' || value === 'delta' || value === 'append' || value === 'prepend') {
    return value
  }
  return 'override'
}

type TaggedConfigModifierTemplate = {
  tag: string
  modifierType: ConfigModifierType
  value: ConfigValue
  priority: number
  sourceId: string
}

function getTaggedConfigModifierTemplates(ctx: InterpreterContext): TaggedConfigModifierTemplate[] {
  const key = '__taggedConfigModifierTemplates'
  const meta = ctx.world.meta as Record<string, unknown>
  const existing = meta[key]
  if (Array.isArray(existing)) return existing as TaggedConfigModifierTemplate[]
  const created: TaggedConfigModifierTemplate[] = []
  meta[key] = created
  return created
}

function getFireContextBag(ctx: InterpreterContext): InterpreterFireContext {
  return ctx.fireCtx
}

function getUseSkillContext(ctx: InterpreterContext): UseSkillContextData | undefined {
  const fireCtx = getFireContextBag(ctx)
  const context = fireCtx.context
  return isUseSkillContext(context) ? context : undefined
}

function getDamageContext(ctx: InterpreterContext): DamageContextData | undefined {
  const fireCtx = getFireContextBag(ctx)
  const fromField = fireCtx.damageContext
  if (isDamageContext(fromField)) return fromField
  const fromContext = fireCtx.context
  if (isDamageContext(fromContext)) return fromContext
  return undefined
}

function resolveTargetPlayerId(ctx: InterpreterContext, targetId: string): string | undefined {
  const { world, systems } = ctx
  const { playerSystem, petSystem, skillSystem, markSystem } = systems

  const player = playerSystem.get(world, targetId)
  if (player) return player.id

  const pet = petSystem.get(world, targetId)
  if (pet?.ownerId) return pet.ownerId

  const skill = skillSystem.get(world, targetId)
  if (skill?.ownerId) {
    const ownerPet = petSystem.get(world, skill.ownerId)
    if (ownerPet?.ownerId) return ownerPet.ownerId
  }

  const mark = markSystem.get(world, targetId)
  if (mark?.ownerType === 'pet' && mark.ownerId) {
    const ownerPet = petSystem.get(world, mark.ownerId)
    if (ownerPet?.ownerId) return ownerPet.ownerId
  }

  return undefined
}

function isExecutableOperator(value: unknown): value is ExecutableOperator {
  if (!isRecord(value) || typeof value.type !== 'string') return false
  if (value.type === 'noop') return true
  if (value.type === 'sequence') {
    return Array.isArray(value.operators) && value.operators.every(isExecutableOperator)
  }
  return true
}

type PropertyRef = { object: Record<string, unknown>; key: string }

function asPropertyRef(value: unknown): PropertyRef | undefined {
  if (!isRecord(value)) return undefined
  const object = isRecord(value.object) ? value.object : undefined
  const key = typeof value.key === 'string' ? value.key : undefined
  if (!object || !key) return undefined
  return { object, key }
}

function setPropertyValue(ctx: InterpreterContext, ref: PropertyRef, value: unknown): void {
  const id = typeof ref.object.id === 'string' ? ref.object.id : undefined
  if (id) {
    const base = ctx.systems.attrSystem.getBaseValue(ctx.world, id, ref.key)
    if (base !== undefined) {
      ctx.systems.attrSystem.setBaseValue(ctx.world, id, ref.key, value as Parameters<typeof ctx.systems.attrSystem.setBaseValue>[3])
    }
  }
  ref.object[ref.key] = value
}

function addPropertyValue(ctx: InterpreterContext, ref: PropertyRef, delta: number): void {
  const currentObjectValue = ref.object[ref.key]
  const nextObjectValue = typeof currentObjectValue === 'number' ? currentObjectValue + delta : undefined

  const id = typeof ref.object.id === 'string' ? ref.object.id : undefined
  if (id) {
    const base = ctx.systems.attrSystem.getBaseValue(ctx.world, id, ref.key)
    if (typeof base === 'number') {
      const nextBase = base + delta
      ctx.systems.attrSystem.setBaseValue(ctx.world, id, ref.key, nextBase)
      ref.object[ref.key] = nextBase
      return
    }
  }

  if (nextObjectValue !== undefined) {
    ref.object[ref.key] = nextObjectValue
  }
}

function togglePropertyValue(ctx: InterpreterContext, ref: PropertyRef): void {
  const id = typeof ref.object.id === 'string' ? ref.object.id : undefined
  if (id) {
    const base = ctx.systems.attrSystem.getBaseValue(ctx.world, id, ref.key)
    if (typeof base === 'boolean') {
      const next = !base
      ctx.systems.attrSystem.setBaseValue(ctx.world, id, ref.key, next)
      ref.object[ref.key] = next
      return
    }
  }
  const current = ref.object[ref.key]
  if (typeof current === 'boolean') ref.object[ref.key] = !current
}

function inferTargetType(ctx: InterpreterContext, entityId: string): 'pet' | 'skill' | 'mark' | undefined {
  const { world, systems } = ctx
  if (systems.petSystem.get(world, entityId)) return 'pet'
  if (systems.skillSystem.get(world, entityId)) return 'skill'
  if (systems.markSystem.get(world, entityId)) return 'mark'
  return undefined
}

function getCurrentBaseId(
  ctx: InterpreterContext,
  entityId: string,
  targetType: 'pet' | 'skill' | 'mark',
): string | undefined {
  const { world, systems } = ctx
  if (targetType === 'pet') {
    const pet = systems.petSystem.get(world, entityId)
    return pet?.speciesId
  }
  if (targetType === 'skill') {
    const skill = systems.skillSystem.get(world, entityId)
    return skill?.baseSkillId
  }
  const mark = systems.markSystem.get(world, entityId)
  return mark?.baseMarkId
}

/**
 * Execute an OperatorDSL.
 */
export async function executeOperator(ctx: InterpreterContext, operator: ExecutableOperator): Promise<void> {
  const op = operator

  switch (op.type) {
    // -----------------------------------------------------------------------
    // Control flow
    // -----------------------------------------------------------------------

    case 'noop':
      break

    case 'sequence': {
      for (const subOp of op.operators) {
        await executeOperator(ctx, subOp)
      }
      break
    }

    case 'conditional': {
      const condResult = evaluateCondition(ctx, op.condition)
      if (condResult) {
        await executeOperator(ctx, op.trueOperator)
      } else if (op.falseOperator) {
        await executeOperator(ctx, op.falseOperator)
      }
      break
    }

    // -----------------------------------------------------------------------
    // Phase execution operators (execute sub-phases via phaseManager)
    // -----------------------------------------------------------------------

    case 'dealDamage': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const value = resolveValue(ctx, op.value) as number
      if (targets.length === 0 || value === undefined) break

      const { world, fireCtx, systems } = ctx
      const { phaseManager, eventBus } = systems
      for (const targetId of targets) {
        await phaseManager.execute(world, 'damage', eventBus, {
          context: {
            type: 'damage',
            parentId: getCurrentPhaseId(ctx),
            sourceId: fireCtx.sourceEntityId,
            targetId,
            baseDamage: value,
            damageType: 'effect',
            crit: false,
            effectiveness: 1,
            ignoreShield: false,
            randomFactor: 1,
            modified: [0, 0],
            minThreshold: 0,
            maxThreshold: Number.MAX_SAFE_INTEGER,
            damageResult: 0,
            available: true,
            element: '',
          },
        })
      }
      break
    }

    case 'heal': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const value = resolveValue(ctx, op.value) as number
      if (targets.length === 0 || value === undefined) break

      const { world, fireCtx, systems } = ctx
      const { phaseManager, eventBus } = systems
      for (const targetId of targets) {
        await phaseManager.execute(world, 'heal', eventBus, {
          context: {
            type: 'heal',
            parentId: getCurrentPhaseId(ctx),
            sourceId: fireCtx.sourceEntityId,
            targetId,
            baseHeal: value,
            modified: [0, 0],
            healResult: 0,
            available: true,
          },
        })
      }
      break
    }

    case 'executeKill': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const { world, systems } = ctx
      const { petSystem } = systems

      for (const targetId of targets) {
        if (petSystem.isAlive(world, targetId)) {
          petSystem.setCurrentHp(world, targetId, 0)
        }
      }
      break
    }

    case 'addMark': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const markBaseId = resolveValue(ctx, op.mark) as string
      if (targets.length === 0 || !markBaseId) break

      const { world, fireCtx, systems } = ctx
      const { phaseManager, eventBus } = systems
      const baseMark = getComponent<BaseMarkData>(world, markBaseId, 'baseMark')
      if (!baseMark) break
      const defaultStack = baseMark.config.maxStacks ?? 1
      const defaultDuration = baseMark.config.duration
      const stack = op.stack !== undefined ? resolveValue(ctx, op.stack) as number : defaultStack
      const duration = op.duration !== undefined ? resolveValue(ctx, op.duration) as number : defaultDuration
      for (const targetId of targets) {
        await phaseManager.execute(world, 'addMark', eventBus, {
          context: {
            type: 'add-mark',
            parentId: getCurrentPhaseId(ctx),
            targetId,
            baseMarkId: markBaseId,
            creatorId: fireCtx.sourceEntityId,
            stack,
            duration,
            available: true,
          },
        })
      }
      break
    }

    case 'transferMark': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const markIds = resolveSelector(ctx, asSelectorDsl(op.mark)) as string[]
      if (targets.length === 0 || markIds.length === 0) break

      const { world, systems } = ctx
      const { markSystem } = systems
      for (const markId of markIds) {
        const mark = markSystem.get(world, markId)
        if (mark && targets[0]) {
          // Detach from old owner, attach to new owner
          markSystem.detach(world, markId)
          markSystem.attach(world, markId, targets[0], 'pet')
        }
      }
      break
    }

    case 'destroyMark': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const { world, systems } = ctx
      const { phaseManager, eventBus } = systems

      for (const markId of targets) {
        await phaseManager.execute(world, 'removeMark', eventBus, {
          context: {
            type: 'remove-mark',
            parentId: getCurrentPhaseId(ctx),
            markId,
            available: true,
          },
        })
      }
      break
    }

    case 'statStageBuff': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const stat = resolveValue(ctx, op.statType) as string
      const stage = resolveValue(ctx, op.value) as number
      if (targets.length === 0 || !stat || typeof stage !== 'number') break

      const { world, systems } = ctx
      const { phaseManager, eventBus, effectPipeline } = systems
      for (const targetId of targets) {
        let finalDelta = stage
        // Compatibility with v1 stat-stage-as-mark semantics:
        // run OnBeforeAddMark with a synthetic stat_stage_* addMarkContext,
        // so effects like mark_hunzhuoshuiyu can mutate statLevelMarkLevel.
        if (stage !== 0) {
          const direction = stage > 0 ? 'up' : 'down'
          const creatorId =
            typeof ctx.fireCtx.triggerSourceEntityId === 'string'
              ? ctx.fireCtx.triggerSourceEntityId
              : ctx.fireCtx.sourceEntityId
          const syntheticAddMarkContext = {
            type: 'add-mark' as const,
            parentId: getCurrentPhaseId(ctx),
            targetId,
            baseMarkId: `stat_stage_${stat}_${direction}`,
            baseMark: {
              id: `stat_stage_${stat}_${direction}`,
              initialLevel: Math.abs(stage),
              tags: ['statStage'],
            },
            stack: Math.abs(stage),
            duration: -1,
            creatorId,
            available: true,
            statLevelMarkLevel: Math.abs(stage),
          }
          await effectPipeline.fire(world, 'OnBeforeAddMark', {
            trigger: 'OnBeforeAddMark',
            sourceEntityId: creatorId,
            context: syntheticAddMarkContext,
          })
          if (!syntheticAddMarkContext.available) continue
          const adjustedLevel = typeof syntheticAddMarkContext.statLevelMarkLevel === 'number'
            ? syntheticAddMarkContext.statLevelMarkLevel
            : Math.abs(stage)
          finalDelta = (stage < 0 ? -1 : 1) * adjustedLevel
        }
        await phaseManager.execute(world, 'statStage', eventBus, {
          operation: 'add',
          entityId: targetId,  // Fixed: use entityId not targetId
          stat,
          delta: finalDelta,   // Fixed: use delta not stage
        })
      }
      break
    }

    case 'clearStatStage': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const statType = op.statType ? resolveValue(ctx, op.statType) : undefined
      const strategy = (op.cleanStageStrategy as string) ?? 'all'
      if (targets.length === 0) break

      const { world, systems } = ctx
      const { phaseManager, eventBus } = systems
      for (const targetId of targets) {
        await phaseManager.execute(world, 'statStage', eventBus, {
          operation: 'clear',
          entityId: targetId,
          stats: statType ? (Array.isArray(statType) ? statType : [statType]) : undefined,
          cleanStageStrategy: strategy,
        })
      }
      break
    }

    case 'reverseStatStage': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const statType = op.statType ? resolveValue(ctx, op.statType) : undefined
      const strategy = (op.cleanStageStrategy as string) ?? 'all'
      if (targets.length === 0) break

      const { world, systems } = ctx
      const { phaseManager, eventBus } = systems
      for (const targetId of targets) {
        await phaseManager.execute(world, 'statStage', eventBus, {
          operation: 'reverse',
          entityId: targetId,
          stats: statType ? (Array.isArray(statType) ? statType : [statType]) : undefined,
          cleanStageStrategy: strategy,
        })
      }
      break
    }

    case 'transferStatStage': {
      const sources = resolveSelector(ctx, op.source) as string[]
      const targets = resolveSelector(ctx, op.target) as string[]
      const statType = op.statType ? resolveValue(ctx, op.statType) : undefined
      const strategy = (op.cleanStageStrategy as string) ?? 'negative'
      if (sources.length === 0 || targets.length === 0) break

      const { world, systems } = ctx
      const { phaseManager, eventBus } = systems
      await phaseManager.execute(world, 'statStage', eventBus, {
        operation: 'transfer',
        entityId: sources[0],
        sourceEntityId: sources[0],
        targetEntityId: targets[0],
        stats: statType ? (Array.isArray(statType) ? statType : [statType]) : undefined,
        cleanStageStrategy: strategy,
      })
      break
    }

    case 'addRage': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const value = resolveValue(ctx, op.value) as number
      if (targets.length === 0 || value === undefined) break

      const { world, systems } = ctx
      const { phaseManager, eventBus } = systems
      for (const targetId of targets) {
        const targetPlayerId = resolveTargetPlayerId(ctx, targetId)
        if (!targetPlayerId) continue
        await phaseManager.execute(world, 'rage', eventBus, {
          context: {
            type: 'rage',
            parentId: getCurrentPhaseId(ctx),
            targetPlayerId,
            reason: 'effect',
            modifiedType: value >= 0 ? 'add' : 'reduce',
            value: Math.abs(value),
            ignoreRageObtainEfficiency: false,
            modified: [0, 0],
            rageChangeResult: 0,
            available: true,
          },
        })
      }
      break
    }

    case 'setRage': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const value = resolveValue(ctx, op.value) as number
      if (targets.length === 0 || value === undefined) break

      const { world, systems } = ctx
      const { playerSystem } = systems
      for (const targetId of targets) {
        const targetPlayerId = resolveTargetPlayerId(ctx, targetId)
        if (!targetPlayerId) continue
        playerSystem.setRage(world, targetPlayerId, value)
      }
      break
    }

    // -----------------------------------------------------------------------
    // Context modification operators
    // -----------------------------------------------------------------------

    case 'stun': {
      const targets = resolveSelector(ctx, op.target)
      for (const target of targets) {
        const context = toRecord(target)
        if (context && typeof context.available === 'boolean') {
          context.available = false
        }
      }
      break
    }

    case 'setSureHit': {
      const context = getUseSkillContext(ctx)
      if (context) context.accuracy = 100
      break
    }

    case 'setSureCrit': {
      const context = getUseSkillContext(ctx)
      if (context) context.critRate = 100
      break
    }

    case 'setSureMiss': {
      const context = getUseSkillContext(ctx)
      if (context) context.accuracy = 0
      break
    }

    case 'setSureNoCrit': {
      const context = getUseSkillContext(ctx)
      if (context) context.critRate = 0
      break
    }

    case 'setIgnoreShield': {
      const context = toRecord(getFireContextBag(ctx).context)
      if (context) context.ignoreShield = true
      break
    }

    case 'setSkill': {
      const value = resolveValue(ctx, op.value)
      const newSkillId = typeof value === 'string' ? value : (Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined)
      if (!newSkillId) break

      const context = getUseSkillContext(ctx)
      if (context) {
        context.skillId = newSkillId

        // If updateConfig is true, update context properties from the new skill
        if (op.updateConfig) {
          const { world, systems } = ctx
          const { skillSystem, playerSystem } = systems
          skillSystem.applyToUseSkillContext(world, newSkillId, context, {
            getOpponentActivePetId: (originPlayerId) => {
              const rawOpponentId =
                originPlayerId === world.state.playerAId ? world.state.playerBId : world.state.playerAId
              const opponentId = typeof rawOpponentId === 'string' ? rawOpponentId : undefined
              if (!opponentId) return undefined
              const opponentPet = playerSystem.getActivePet(world, opponentId)
              return opponentPet?.id
            },
          })
        }
      }
      break
    }

    case 'preventDamage': {
      const targets = resolveSelector(ctx, op.target)
      for (const target of targets) {
        const context = toRecord(target)
        if (context && typeof context.available === 'boolean') {
          context.available = false
        }
      }
      break
    }

    case 'setActualTarget': {
      const newTargets = resolveSelector(ctx, asSelectorDsl(op.newTarget)) as string[]
      if (newTargets.length === 0) break
      const context = getUseSkillContext(ctx)
      if (context) context.actualTargetId = newTargets[0]
      break
    }

    case 'amplifyPower': {
      const value = resolveValue(ctx, op.value) as number
      const context = getUseSkillContext(ctx)
      if (context && value !== undefined) {
        context.power = (context.power ?? 0) * value
      }
      break
    }

    case 'addPower': {
      const value = resolveValue(ctx, op.value) as number
      const context = getUseSkillContext(ctx)
      if (context && value !== undefined) {
        context.power = (context.power ?? 0) + value
      }
      break
    }

    case 'addCritRate': {
      const value = resolveValue(ctx, op.value) as number
      const context = getUseSkillContext(ctx)
      if (context && value !== undefined) {
        context.critRate = (context.critRate ?? 0) + value
      }
      break
    }

    case 'addMultihitResult': {
      const value = resolveValue(ctx, op.value) as number
      const context = getUseSkillContext(ctx)
      if (context && value !== undefined) {
        context.multihitResult = (context.multihitResult ?? 1) + value
      }
      break
    }

    case 'setMultihit': {
      const value = resolveValue(ctx, op.value) as number
      const context = getUseSkillContext(ctx)
      if (context && value !== undefined) {
        context.multihitResult = value
      }
      break
    }

    case 'addModified': {
      const targets = resolveSelector(ctx, op.target)
      const percent = op.percent !== undefined ? resolveValue(ctx, op.percent) as number : 0
      const delta = op.delta !== undefined ? resolveValue(ctx, op.delta) as number : 0

      // Modify the context's modified array
      for (const target of targets) {
        const context = toRecord(target)
        const modified = context?.modified
        if (Array.isArray(modified) && modified.length >= 2) {
          const p = typeof modified[0] === 'number' ? modified[0] : 0
          const d = typeof modified[1] === 'number' ? modified[1] : 0
          modified[0] = p + percent
          modified[1] = d + delta
        }
      }
      break
    }

    case 'addThreshold': {
      const damageCtx = getDamageContext(ctx)
      if (damageCtx) {
        if (op.min !== undefined) {
          const min = resolveValue(ctx, op.min) as number
          damageCtx.minThreshold = Math.max(damageCtx.minThreshold ?? 0, min)
        }
        if (op.max !== undefined) {
          const max = resolveValue(ctx, op.max) as number
          damageCtx.maxThreshold = Math.min(damageCtx.maxThreshold ?? Number.MAX_SAFE_INTEGER, max)
        }
      }
      break
    }

    case 'addAccuracy': {
      const value = resolveValue(ctx, op.value) as number
      const context = getUseSkillContext(ctx)
      if (context && value !== undefined) {
        context.accuracy = (context.accuracy ?? 100) + value
      }
      break
    }

    case 'setAccuracy': {
      const value = resolveValue(ctx, op.value) as number
      const context = getUseSkillContext(ctx)
      if (context && value !== undefined) {
        context.accuracy = value
      }
      break
    }

    case 'setIgnoreStageStrategy': {
      const value = resolveValue(ctx, op.value) as string
      const context = getUseSkillContext(ctx)
      if (context && value !== undefined) {
        context.ignoreStageStrategy = value
      }
      break
    }

    case 'disableContext': {
      const targets = resolveSelector(ctx, op.target)
      for (const target of targets) {
        const context = toRecord(target)
        if (context && typeof context.available === 'boolean') {
          context.available = false
        }
      }
      break
    }

    // -----------------------------------------------------------------------
    // Mark modification operators (used in addMark context)
    // -----------------------------------------------------------------------

    case 'overrideMarkConfig': {
      const context = toRecord(getFireContextBag(ctx).context)
      if (context && op.config) {
        context.configOverride = { ...(context.configOverride ?? {}), ...(op.config as object) }
      }
      break
    }

    case 'setMarkDuration': {
      const value = resolveValue(ctx, op.value) as number
      const context = toRecord(getFireContextBag(ctx).context)
      if (context && value !== undefined) context.duration = value
      break
    }

    case 'setMarkStack': {
      const value = resolveValue(ctx, op.value) as number
      const context = toRecord(getFireContextBag(ctx).context)
      if (context && value !== undefined) context.stack = value
      break
    }

    case 'setMarkMaxStack': {
      const value = resolveValue(ctx, op.value) as number
      const context = toRecord(getFireContextBag(ctx).context)
      if (context && value !== undefined) {
        context.configOverride = { ...(context.configOverride ?? {}), maxStack: value }
      }
      break
    }

    case 'setMarkPersistent': {
      const value = resolveValue(ctx, op.value) as boolean
      const context = toRecord(getFireContextBag(ctx).context)
      if (context && value !== undefined) {
        context.configOverride = { ...(context.configOverride ?? {}), persistent: value }
      }
      break
    }

    case 'setMarkStackable': {
      const value = resolveValue(ctx, op.value) as boolean
      const context = toRecord(getFireContextBag(ctx).context)
      if (context && value !== undefined) {
        context.configOverride = { ...(context.configOverride ?? {}), stackable: value }
      }
      break
    }

    case 'setMarkStackStrategy': {
      const value = resolveValue(ctx, op.value) as string
      const context = toRecord(getFireContextBag(ctx).context)
      if (context && value !== undefined) {
        context.configOverride = { ...(context.configOverride ?? {}), stackStrategy: value }
      }
      break
    }

    case 'setMarkDestroyable': {
      const value = resolveValue(ctx, op.value) as boolean
      const context = toRecord(getFireContextBag(ctx).context)
      if (context && value !== undefined) {
        context.configOverride = { ...(context.configOverride ?? {}), destroyable: value }
      }
      break
    }

    case 'setMarkIsShield': {
      const value = resolveValue(ctx, op.value) as boolean
      const context = toRecord(getFireContextBag(ctx).context)
      if (context && value !== undefined) {
        context.configOverride = { ...(context.configOverride ?? {}), isShield: value }
      }
      break
    }

    case 'setMarkKeepOnSwitchOut': {
      const value = resolveValue(ctx, op.value) as boolean
      const context = toRecord(getFireContextBag(ctx).context)
      if (context && value !== undefined) {
        context.configOverride = { ...(context.configOverride ?? {}), keepOnSwitchOut: value }
      }
      break
    }

    case 'setMarkTransferOnSwitch': {
      const value = resolveValue(ctx, op.value) as boolean
      const context = toRecord(getFireContextBag(ctx).context)
      if (context && value !== undefined) {
        context.configOverride = { ...(context.configOverride ?? {}), transferOnSwitch: value }
      }
      break
    }

    case 'setMarkInheritOnFaint': {
      const value = resolveValue(ctx, op.value) as boolean
      const context = toRecord(getFireContextBag(ctx).context)
      if (context && value !== undefined) {
        context.configOverride = { ...(context.configOverride ?? {}), inheritOnFaint: value }
      }
      break
    }

    case 'setStatLevelMarkLevel': {
      const value = resolveValue(ctx, op.value) as number
      const context = toRecord(getFireContextBag(ctx).context)
      if (context && value !== undefined) {
        context.statLevelMarkLevel = value
      }
      break
    }

    // -----------------------------------------------------------------------
    // Mark stack operators (operate on existing marks)
    // -----------------------------------------------------------------------

    case 'addStacks': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const value = resolveValue(ctx, op.value) as number
      if (targets.length === 0 || value === undefined) break

      const { world, systems } = ctx
      const { markSystem } = systems
      for (const markId of targets) {
        markSystem.addStack(world, markId, value)
      }
      break
    }

    case 'consumeStacks': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const value = resolveValue(ctx, op.value) as number
      if (targets.length === 0 || value === undefined) break

      const { world, systems } = ctx
      const { markSystem } = systems
      for (const markId of targets) {
        markSystem.consumeStack(world, markId, value)
      }
      break
    }

    case 'modifyStackResult': {
      const context = toRecord(getFireContextBag(ctx).context)
      if (context) {
        if (op.newStacks !== undefined) {
          context.stacksAfter = resolveValue(ctx, op.newStacks) as number
        }
        if (op.newDuration !== undefined) {
          context.durationAfter = resolveValue(ctx, op.newDuration) as number
        }
      }
      break
    }

    // -----------------------------------------------------------------------
    // Attribute modifier operators
    // -----------------------------------------------------------------------

    case 'modifyStat': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const stat = resolveValue(ctx, op.statType) as string
      const delta = op.delta !== undefined ? (resolveValue(ctx, op.delta) as number) : undefined
      const percent = op.percent !== undefined ? (resolveValue(ctx, op.percent) as number) : undefined
      if (targets.length === 0 || !stat || (delta === undefined && percent === undefined)) break

      const { world, systems } = ctx
      const { attrSystem } = systems
      for (const targetId of targets) {
        if (delta !== undefined) {
          attrSystem.addModifier(world, targetId, stat, {
            id: `attrModDelta_${ctx.fireCtx.sourceEntityId}_${stat}_${Date.now()}`,
            type: 'delta',
            value: { kind: 'static', value: delta },
            priority: 100,
            sourceId: ctx.fireCtx.sourceEntityId,
            durationType: 'binding',
          })
        }
        if (percent !== undefined) {
          attrSystem.addModifier(world, targetId, stat, {
            id: `attrModPercent_${ctx.fireCtx.sourceEntityId}_${stat}_${Date.now()}`,
            type: 'percent',
            value: { kind: 'static', value: percent },
            priority: 100,
            sourceId: ctx.fireCtx.sourceEntityId,
            durationType: 'binding',
          })
        }
      }
      break
    }

    case 'addAttributeModifier': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const stat = resolveValue(ctx, op.stat) as string
      const modType = (op.modifierType as string) ?? 'delta'
      if (targets.length === 0 || !stat) break

      const { world, systems } = ctx
      const { attrSystem } = systems
      const dynamicSelector = getDynamicSelectorFromValue(op.value)
      const staticValue = dynamicSelector ? undefined : (resolveValue(ctx, op.value) as number)
      if (!dynamicSelector && staticValue === undefined) break

      for (const targetId of targets) {
        attrSystem.addModifier(world, targetId, stat, {
          id: `attrMod_${ctx.fireCtx.sourceEntityId}_${stat}_${Date.now()}`,
          type: modType === 'percent' ? 'percent' : 'delta',
          value: dynamicSelector
            ? {
                kind: 'expr',
                expr: {
                  type: 'formula',
                  op: 'selectorValue',
                  selector: dynamicSelector,
                  fireCtx: {
                    trigger: ctx.fireCtx.trigger,
                    sourceEntityId: ctx.fireCtx.sourceEntityId,
                    contextId: ctx.fireCtx.contextId,
                    phaseId: ctx.fireCtx.phaseId,
                    effectId: ctx.fireCtx.effectId,
                    effectEntityId: ctx.fireCtx.effectEntityId,
                    targetEntityId: targetId,
                  },
                },
              }
            : { kind: 'static', value: staticValue as number },
          priority: op.priority ? (resolveValue(ctx, op.priority) as number) : 100,
          sourceId: ctx.fireCtx.sourceEntityId,
          durationType: 'binding',
        })
      }
      break
    }

    case 'addDynamicAttributeModifier': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const stat = resolveValue(ctx, op.stat) as string
      const modType = (op.modifierType as string) ?? 'delta'
      if (targets.length === 0 || !stat) break

      const { world, systems } = ctx
      const { attrSystem } = systems
      for (const targetId of targets) {
        attrSystem.addModifier(world, targetId, stat, {
          id: `attrDynMod_${ctx.fireCtx.sourceEntityId}_${stat}_${Date.now()}`,
          type: modType === 'percent' ? 'percent' : 'delta',
          value: {
            kind: 'expr',
            expr: {
              type: 'formula',
              op: 'selectorValue',
              selector: op.observableValue,
              fireCtx: {
                trigger: ctx.fireCtx.trigger,
                sourceEntityId: ctx.fireCtx.sourceEntityId,
                contextId: ctx.fireCtx.contextId,
                phaseId: ctx.fireCtx.phaseId,
                effectId: ctx.fireCtx.effectId,
                effectEntityId: ctx.fireCtx.effectEntityId,
                targetEntityId: targetId,
              },
            },
          },
          priority: op.priority ? (resolveValue(ctx, op.priority) as number) : 100,
          sourceId: ctx.fireCtx.sourceEntityId,
          durationType: 'binding',
        })
      }
      break
    }

    case 'addClampMaxModifier': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const stat = resolveValue(ctx, op.stat) as string
      const value = resolveValue(ctx, op.maxValue) as number
      if (targets.length === 0 || !stat || value === undefined) break

      const { world, systems } = ctx
      const { attrSystem } = systems
      for (const targetId of targets) {
        attrSystem.addModifier(world, targetId, stat, {
          id: `attrClampMax_${ctx.fireCtx.sourceEntityId}_${stat}_${Date.now()}`,
          type: 'clampMax',
          value: { kind: 'static', value },
          priority: op.priority ? (resolveValue(ctx, op.priority) as number) : 500,
          sourceId: ctx.fireCtx.sourceEntityId,
          durationType: 'binding',
        })
      }
      break
    }

    case 'addClampMinModifier': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const stat = resolveValue(ctx, op.stat) as string
      const value = resolveValue(ctx, op.minValue) as number
      if (targets.length === 0 || !stat || value === undefined) break

      const { world, systems } = ctx
      const { attrSystem } = systems
      for (const targetId of targets) {
        attrSystem.addModifier(world, targetId, stat, {
          id: `attrClampMin_${ctx.fireCtx.sourceEntityId}_${stat}_${Date.now()}`,
          type: 'clampMin',
          value: { kind: 'static', value },
          priority: op.priority ? (resolveValue(ctx, op.priority) as number) : 500,
          sourceId: ctx.fireCtx.sourceEntityId,
          durationType: 'binding',
        })
      }
      break
    }

    case 'addClampModifier': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const stat = resolveValue(ctx, op.stat) as string
      const min = op.minValue !== undefined ? resolveValue(ctx, op.minValue) as number : undefined
      const max = op.maxValue !== undefined ? resolveValue(ctx, op.maxValue) as number : undefined
      if (targets.length === 0 || !stat) break

      const { world, systems } = ctx
      const { attrSystem } = systems
      for (const targetId of targets) {
        if (min !== undefined) {
          attrSystem.addModifier(world, targetId, stat, {
            id: `attrClampMin_${ctx.fireCtx.sourceEntityId}_${stat}_${Date.now()}`,
            type: 'clampMin',
            value: { kind: 'static', value: min },
            priority: op.priority ? (resolveValue(ctx, op.priority) as number) : 500,
            sourceId: ctx.fireCtx.sourceEntityId,
            durationType: 'binding',
          })
        }
        if (max !== undefined) {
          attrSystem.addModifier(world, targetId, stat, {
            id: `attrClampMax_${ctx.fireCtx.sourceEntityId}_${stat}_${Date.now()}_max`,
            type: 'clampMax',
            value: { kind: 'static', value: max },
            priority: op.priority ? (resolveValue(ctx, op.priority) as number) : 500,
            sourceId: ctx.fireCtx.sourceEntityId,
            durationType: 'binding',
          })
        }
      }
      break
    }

    // Skill attribute modifiers (same pattern as pet attribute modifiers)
    case 'addSkillAttributeModifier': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const attribute = resolveValue(ctx, op.attribute) as string
      const modType = resolveValue(ctx, op.modifierType) as string
      const priority = op.priority ? (resolveValue(ctx, op.priority) as number) : 100
      if (targets.length === 0 || !attribute) break

      const { world, systems } = ctx
      const { attrSystem } = systems
      const dynamicSelector = getDynamicSelectorFromValue(op.value)
      const staticValue = dynamicSelector ? undefined : (resolveValue(ctx, op.value) as number)
      if (!dynamicSelector && staticValue === undefined) break

      for (const skillId of targets) {
        attrSystem.addModifier(world, skillId, attribute, {
          id: `skillMod_${ctx.fireCtx.sourceEntityId}_${attribute}_${Date.now()}`,
          type: modType === 'percent' ? 'percent' : modType === 'override' ? 'override' : 'delta',
          value: dynamicSelector
            ? {
                kind: 'expr',
                expr: {
                  type: 'formula',
                  op: 'selectorValue',
                  selector: dynamicSelector,
                  fireCtx: {
                    trigger: ctx.fireCtx.trigger,
                    sourceEntityId: ctx.fireCtx.sourceEntityId,
                    contextId: ctx.fireCtx.contextId,
                    phaseId: ctx.fireCtx.phaseId,
                    effectId: ctx.fireCtx.effectId,
                    effectEntityId: ctx.fireCtx.effectEntityId,
                    targetEntityId: skillId,
                  },
                },
              }
            : { kind: 'static', value: staticValue as number },
          priority,
          sourceId: ctx.fireCtx.sourceEntityId,
          durationType: 'binding',
        })
      }
      break
    }

    case 'addDynamicSkillAttributeModifier': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const attribute = resolveValue(ctx, op.attribute) as string
      const modType = resolveValue(ctx, op.modifierType) as string
      const priority = op.priority ? (resolveValue(ctx, op.priority) as number) : 100
      if (targets.length === 0 || !attribute) break

      // For dynamic modifiers, use expr with the selector DSL
      const { world, systems } = ctx
      const { attrSystem } = systems
      for (const skillId of targets) {
        attrSystem.addModifier(world, skillId, attribute, {
          id: `skillDynMod_${ctx.fireCtx.sourceEntityId}_${attribute}_${Date.now()}`,
          type: modType === 'percent' ? 'percent' : modType === 'override' ? 'override' : 'delta',
          value: {
            kind: 'expr',
            expr: {
              type: 'formula',
              op: 'selectorValue',
              selector: op.observableValue,
              fireCtx: {
                trigger: ctx.fireCtx.trigger,
                sourceEntityId: ctx.fireCtx.sourceEntityId,
                contextId: ctx.fireCtx.contextId,
                phaseId: ctx.fireCtx.phaseId,
                effectId: ctx.fireCtx.effectId,
                effectEntityId: ctx.fireCtx.effectEntityId,
                targetEntityId: skillId,
              },
            },
          },
          priority,
          sourceId: ctx.fireCtx.sourceEntityId,
          durationType: 'binding',
        })
      }
      break
    }

    case 'addSkillClampMaxModifier': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const attribute = resolveValue(ctx, op.attribute) as string
      const maxValue = resolveValue(ctx, op.maxValue) as number
      const priority = op.priority ? (resolveValue(ctx, op.priority) as number) : 500
      if (targets.length === 0 || !attribute || maxValue === undefined) break

      const { world, systems } = ctx
      const { attrSystem } = systems
      for (const skillId of targets) {
        attrSystem.addModifier(world, skillId, attribute, {
          id: `skillClampMax_${ctx.fireCtx.sourceEntityId}_${attribute}_${Date.now()}`,
          type: 'clampMax',
          value: { kind: 'static', value: maxValue },
          priority,
          sourceId: ctx.fireCtx.sourceEntityId,
          durationType: 'binding',
        })
      }
      break
    }

    case 'addSkillClampMinModifier': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const attribute = resolveValue(ctx, op.attribute) as string
      const minValue = resolveValue(ctx, op.minValue) as number
      const priority = op.priority ? (resolveValue(ctx, op.priority) as number) : 500
      if (targets.length === 0 || !attribute || minValue === undefined) break

      const { world, systems } = ctx
      const { attrSystem } = systems
      for (const skillId of targets) {
        attrSystem.addModifier(world, skillId, attribute, {
          id: `skillClampMin_${ctx.fireCtx.sourceEntityId}_${attribute}_${Date.now()}`,
          type: 'clampMin',
          value: { kind: 'static', value: minValue },
          priority,
          sourceId: ctx.fireCtx.sourceEntityId,
          durationType: 'binding',
        })
      }
      break
    }

    case 'addSkillClampModifier': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const attribute = resolveValue(ctx, op.attribute) as string
      const minValue = resolveValue(ctx, op.minValue) as number
      const maxValue = resolveValue(ctx, op.maxValue) as number
      const priority = op.priority ? (resolveValue(ctx, op.priority) as number) : 500
      if (targets.length === 0 || !attribute) break

      const { world, systems } = ctx
      const { attrSystem } = systems
      for (const skillId of targets) {
        if (minValue !== undefined) {
          attrSystem.addModifier(world, skillId, attribute, {
            id: `skillClampMin_${ctx.fireCtx.sourceEntityId}_${attribute}_${Date.now()}`,
            type: 'clampMin',
            value: { kind: 'static', value: minValue },
            priority,
            sourceId: ctx.fireCtx.sourceEntityId,
            durationType: 'binding',
          })
        }
        if (maxValue !== undefined) {
          attrSystem.addModifier(world, skillId, attribute, {
            id: `skillClampMax_${ctx.fireCtx.sourceEntityId}_${attribute}_${Date.now()}_max`,
            type: 'clampMax',
            value: { kind: 'static', value: maxValue },
            priority,
            sourceId: ctx.fireCtx.sourceEntityId,
            durationType: 'binding',
          })
        }
      }
      break
    }

    // -----------------------------------------------------------------------
    // Config system operators
    // -----------------------------------------------------------------------

    case 'setConfig': {
      const key = resolveValue(ctx, op.key) as string
      const value = resolveValue(ctx, op.value) as ConfigValue
      if (!key) break

      setConfigValue(ctx.world.configStore, key, value)
      break
    }

    case 'registerConfig': {
      const key = resolveValue(ctx, op.configKey) as string
      const initialValue = resolveValue(ctx, op.initialValue) as ConfigValue
      if (!key) break

      registerConfig(ctx.world.configStore, key, initialValue)
      break
    }

    case 'registerTaggedConfig': {
      const key = resolveValue(ctx, op.configKey) as string
      const initialValue = resolveValue(ctx, op.initialValue) as ConfigValue
      const tags = resolveValue(ctx, op.tags)
      if (!key) break

      const tagArray = Array.isArray(tags) ? tags : [tags]
      registerConfig(ctx.world.configStore, key, initialValue, tagArray.filter((t): t is string => typeof t === 'string'))
      break
    }

    case 'addConfigModifier': {
      const key = resolveValue(ctx, op.configKey) as string
      const modType = asConfigModifierType(resolveValue(ctx, op.modifierType))
      const value = resolveValue(ctx, op.value) as ConfigValue
      const priority = op.priority ? (resolveValue(ctx, op.priority) as number) : 0
      if (!key) break

      addConfigModifier(ctx.world.configStore, key, {
        id: `configMod_${ctx.fireCtx.sourceEntityId}_${key}_${Date.now()}`,
        type: modType,
        value,
        priority,
        sourceId: ctx.fireCtx.sourceEntityId,
        durationType: 'binding',
      })
      break
    }

    case 'addDynamicConfigModifier': {
      const key = resolveValue(ctx, op.configKey) as string
      const modType = asConfigModifierType(resolveValue(ctx, op.modifierType))
      const priority = op.priority ? (resolveValue(ctx, op.priority) as number) : 0
      if (!key) break

      const dynamicValue = resolveSelector(ctx, op.observableValue)
      const value = dynamicValue[0] as ConfigValue

      addConfigModifier(ctx.world.configStore, key, {
        id: `configDynMod_${ctx.fireCtx.sourceEntityId}_${key}_${Date.now()}`,
        type: modType,
        value,
        priority,
        sourceId: ctx.fireCtx.sourceEntityId,
        durationType: 'binding',
      })
      break
    }

    case 'addTaggedConfigModifier': {
      const tag = resolveValue(ctx, op.tag) as string
      const modType = asConfigModifierType(resolveValue(ctx, op.modifierType))
      const value = resolveValue(ctx, op.value) as ConfigValue
      const priority = op.priority ? (resolveValue(ctx, op.priority) as number) : 0
      if (!tag) break

      const sourceId = String(ctx.fireCtx.sourceEntityId)
      getTaggedConfigModifierTemplates(ctx).push({
        tag,
        modifierType: modType,
        value,
        priority,
        sourceId,
      })

      const keys = getConfigKeysByTag(ctx.world.configStore, tag)
      for (const key of keys) {
        addConfigModifier(ctx.world.configStore, key, {
          id: `configTagMod_${sourceId}_${tag}_${key}_${Date.now()}`,
          type: modType,
          value,
          priority,
          sourceId,
          durationType: 'binding',
        })
      }
      break
    }

    case 'addPhaseConfigModifier': {
      const key = resolveValue(ctx, op.configKey) as string
      const modType = asConfigModifierType(resolveValue(ctx, op.modifierType))
      const value = resolveValue(ctx, op.value) as ConfigValue
      const priority = op.priority ? (resolveValue(ctx, op.priority) as number) : 0
      if (!key) break

      addConfigModifier(ctx.world.configStore, key, {
        id: `configPhaseMod_${ctx.fireCtx.sourceEntityId}_${key}_${Date.now()}`,
        type: modType,
        value,
        priority,
        sourceId: ctx.fireCtx.sourceEntityId,
        durationType: 'phase',
      })
      break
    }

    case 'addPhaseDynamicConfigModifier': {
      const key = resolveValue(ctx, op.configKey) as string
      const modType = asConfigModifierType(resolveValue(ctx, op.modifierType))
      const priority = op.priority ? (resolveValue(ctx, op.priority) as number) : 0
      if (!key) break

      const dynamicValue = resolveSelector(ctx, op.observableValue)
      const value = dynamicValue[0] as ConfigValue

      addConfigModifier(ctx.world.configStore, key, {
        id: `configPhaseDynMod_${ctx.fireCtx.sourceEntityId}_${key}_${Date.now()}`,
        type: modType,
        value,
        priority,
        sourceId: ctx.fireCtx.sourceEntityId,
        durationType: 'phase',
      })
      break
    }

    case 'addPhaseTypeConfigModifier': {
      const key = resolveValue(ctx, op.configKey) as string
      const modType = asConfigModifierType(resolveValue(ctx, op.modifierType))
      const value = resolveValue(ctx, op.value) as ConfigValue
      const phaseType = resolveValue(ctx, op.phaseType) as string
      const priority = op.priority ? (resolveValue(ctx, op.priority) as number) : 0
      if (!key || !phaseType) break

      addConfigModifier(ctx.world.configStore, key, {
        id: `configPhaseTypeMod_${ctx.fireCtx.sourceEntityId}_${key}_${Date.now()}`,
        type: modType,
        value,
        priority,
        sourceId: ctx.fireCtx.sourceEntityId,
        durationType: 'phaseType',
        phaseTypeSpec: {
          phaseType,
          scope: 'current',
        },
      })
      break
    }

    case 'addDynamicPhaseTypeConfigModifier': {
      const key = resolveValue(ctx, op.configKey) as string
      const modType = asConfigModifierType(resolveValue(ctx, op.modifierType))
      const phaseType = resolveValue(ctx, op.phaseType) as string
      const priority = op.priority ? (resolveValue(ctx, op.priority) as number) : 0
      if (!key || !phaseType) break

      const dynamicValue = resolveSelector(ctx, op.observableValue)
      const value = dynamicValue[0] as ConfigValue

      addConfigModifier(ctx.world.configStore, key, {
        id: `configPhaseTypeDynMod_${ctx.fireCtx.sourceEntityId}_${key}_${Date.now()}`,
        type: modType,
        value,
        priority,
        sourceId: ctx.fireCtx.sourceEntityId,
        durationType: 'phaseType',
        phaseTypeSpec: {
          phaseType,
          scope: 'current',
        },
      })
      break
    }

    // -----------------------------------------------------------------------
    // Transform operators
    // -----------------------------------------------------------------------

    case 'transform':
    case 'transformWithPreservation': {
      const targets = resolveSelector(ctx, op.target) as string[]
      const newBaseValue = resolveValue(ctx, op.newBase)
      const newBaseId = typeof newBaseValue === 'string'
        ? newBaseValue
        : (isRecord(newBaseValue) && typeof newBaseValue.id === 'string' ? newBaseValue.id : undefined)
      const transformType = (resolveValue(ctx, op.transformType) as string) ?? 'temporary'
      const priority = op.priority ? (resolveValue(ctx, op.priority) as number) : 0
      const effectHandlingSource = toRecord(op)?.effectHandlingStrategy as Value | undefined
      const effectHandlingStrategy = ((resolveValue(ctx, effectHandlingSource) as string) ?? 'preserve') === 'override'
        ? 'override'
        : 'preserve'
      const permanentStrategy = op.type === 'transformWithPreservation'
        ? 'preserve_temporary' as const
        : ((resolveValue(ctx, op.permanentStrategy) as string) ?? 'clear_temporary')
      if (targets.length === 0 || !newBaseId) break

      const { world, systems } = ctx
      const transformStrategy = systems.transformStrategy
      if (!transformStrategy) break
      for (const targetId of targets) {
        const targetType = inferTargetType(ctx, targetId)
        if (!targetType) continue
        const originalBaseId = getCurrentBaseId(ctx, targetId, targetType)
        applyTransformation(
          world,
          targetId,
          targetType,
          newBaseId,
          transformType === 'permanent' ? 'permanent' : 'temporary',
          transformStrategy,
          {
            priority,
            causedById: ctx.fireCtx.sourceEntityId,
            permanentStrategy: permanentStrategy === 'preserve_temporary' ? 'preserve_temporary' : 'clear_temporary',
            extra: { effectHandlingStrategy, originalBaseId },
          },
        )
      }
      break
    }

    case 'removeTransformation': {
      const targets = resolveSelector(ctx, op.target) as string[]
      if (targets.length === 0) break

      const { world, systems } = ctx
      const transformStrategy = systems.transformStrategy
      if (!transformStrategy) break
      for (const targetId of targets) {
        const targetType = inferTargetType(ctx, targetId)
        if (!targetType) continue
        removeTransformation(world, targetId, transformStrategy)
      }
      break
    }

    // -----------------------------------------------------------------------
    // Generic value operators
    // -----------------------------------------------------------------------

    case 'setValue': {
      const targets = resolveSelector(ctx, op.target)
      const value = resolveValue(ctx, op.value)
      for (const target of targets) {
        const ref = asPropertyRef(target)
        if (ref) setPropertyValue(ctx, ref, value)
      }
      break
    }

    case 'addValue': {
      const targets = resolveSelector(ctx, op.target)
      const value = resolveValue(ctx, op.value) as number
      for (const target of targets) {
        const ref = asPropertyRef(target)
        if (ref) addPropertyValue(ctx, ref, value)
      }
      break
    }

    case 'toggle': {
      const targets = resolveSelector(ctx, op.target)
      for (const target of targets) {
        const ref = asPropertyRef(target)
        if (ref) togglePropertyValue(ctx, ref)
      }
      break
    }

    case 'executeActions': {
      // Execute a list of action operators
      const targets = resolveSelector(ctx, op.target)
      for (const target of targets) {
        if (isExecutableOperator(target)) {
          await executeOperator(ctx, target)
        }
      }
      break
    }

    case 'addTemporaryEffect': {
      // Add a temporary effect to an entity
      const targets = resolveSelector(ctx, op.target) as string[]
      const effect = toRecord(op.effect) as Partial<EffectDef> | undefined
      if (targets.length === 0 || !effect) break

      const { world, systems } = ctx
      for (const targetId of targets) {
        systems.effectPipeline.attachEffect(world, targetId, {
          id: typeof effect.id === 'string' ? effect.id : `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          triggers: Array.isArray(effect.triggers) ? effect.triggers.filter((t): t is string => typeof t === 'string') : [],
          priority: typeof effect.priority === 'number' ? effect.priority : 0,
          apply: effect.apply,
          condition: effect.condition,
          consumesStacks: typeof effect.consumesStacks === 'number' ? effect.consumesStacks : undefined,
          tags: Array.isArray(effect.tags) ? effect.tags.filter((t): t is string => typeof t === 'string') : undefined,
        })
      }
      break
    }

    default:
      // Unknown operator type, skip silently
      break
  }
}
type InterpreterOperator =
  | { type: 'sequence'; operators: ExecutableOperator[] }
  | { type: 'noop' }

type ExecutableOperator = OperatorDSL | InterpreterOperator
