// battle/src/v2/systems/interpreter/conditions.ts
// Condition and evaluator evaluation for effect DSL.

import type { InterpreterContext } from './context.js'
import type { ConditionDSL, EvaluatorDSL, SelectorDSL, Value } from '@arcadia-eternity/schema'
import {
  evaluateCommonCondition,
  evaluateRuntimeEvaluator,
  type RuntimeEvaluator,
  type World,
} from '@arcadia-eternity/engine'
import { ContinuousUseSkillStrategy } from '@arcadia-eternity/const'
import { resolveSelector } from './selector.js'
import { resolveValue } from './value.js'
import { isRecord } from './type-guards.js'
import { getConditionHandler, registerConditionHandler } from './condition-registry.js'

/**
 * Find a context type by recursively searching world.phaseStack.
 * Similar to v1's findContextRecursively.
 *
 * In v2, contexts are nested via parentId. We need to:
 * 1. Start from the current context (in fireCtx)
 * 2. Follow parentId chain up through phaseStack
 * 3. Return the first context matching the requested type
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

type CommonConditionDsl = Extract<ConditionDSL, { type: 'every' | 'some' | 'not' | 'evaluate' }>

function isCommonCondition(
  condition: ConditionDSL | boolean | undefined | null,
): condition is CommonConditionDsl | boolean | undefined | null {
  if (condition === undefined || condition === null || typeof condition === 'boolean') return true
  return (
    condition.type === 'every'
    || condition.type === 'some'
    || condition.type === 'not'
    || condition.type === 'evaluate'
  )
}

function findContextInStack(ctx: InterpreterContext, contextType: string): Record<string, unknown> | null {
  const { world, fireCtx } = ctx

  // Start from current context if available
  let currentContext = asRecord((fireCtx as { context?: unknown }).context)
  if (!currentContext) {
    // If no context in fireCtx, search from top of stack
    for (let i = world.phaseStack.length - 1; i >= 0; i--) {
      const phase = world.phaseStack[i]
      const data = asRecord(phase.data)
      const nestedContext = asRecord(data?.context)
      if (nestedContext) {
        currentContext = nestedContext
        break
      }
    }
  }

  if (!currentContext) return null

  // Check current context first
  if (currentContext.type === contextType) {
    return currentContext
  }

  // Follow parentId chain
  let parentId = typeof currentContext.parentId === 'string' ? currentContext.parentId : undefined
  while (parentId !== undefined) {
    // Find phase with this ID in the stack
    const parentPhase = world.phaseStack.find(p => p.id === parentId)
    if (!parentPhase) break

    const parentData = asRecord(parentPhase.data)
    const parentContext = asRecord(parentData?.context)
    if (!parentContext) break

    if (parentContext.type === contextType) {
      return parentContext
    }

    parentId = typeof parentContext.parentId === 'string' ? parentContext.parentId : undefined
  }

  return null
}

function getCurrentContext(ctx: InterpreterContext): Record<string, unknown> | undefined {
  const direct = asRecord((ctx.fireCtx as { context?: unknown }).context)
  if (direct) return direct
  for (let i = ctx.world.phaseStack.length - 1; i >= 0; i--) {
    const data = asRecord(ctx.world.phaseStack[i].data)
    const nestedContext = asRecord(data?.context)
    if (nestedContext) return nestedContext
  }
  return undefined
}

function getSourceOwnerPetId(ctx: InterpreterContext): string | undefined {
  const { world, fireCtx, systems } = ctx
  const sourceId = fireCtx.sourceEntityId
  const { petSystem, skillSystem, markSystem, playerSystem } = systems

  const sourcePet = petSystem.get(world, sourceId)
  if (sourcePet) return sourcePet.id

  const sourceSkill = skillSystem.get(world, sourceId)
  if (sourceSkill?.ownerId) return sourceSkill.ownerId

  const sourceMark = markSystem.get(world, sourceId)
  if (sourceMark?.ownerType === 'pet' && sourceMark.ownerId) return sourceMark.ownerId

  const sourcePlayer = playerSystem.get(world, sourceId)
  if (sourcePlayer?.activePetId) return sourcePlayer.activePetId

  return undefined
}

function getOwnerPetIdByEntityId(ctx: InterpreterContext, entityId: string): string | undefined {
  const { world, systems } = ctx
  const { petSystem, skillSystem, markSystem, playerSystem } = systems

  const pet = petSystem.get(world, entityId)
  if (pet) return pet.id

  const skill = skillSystem.get(world, entityId)
  if (skill?.ownerId) return skill.ownerId

  const mark = markSystem.get(world, entityId)
  if (mark?.ownerType === 'pet' && mark.ownerId) return mark.ownerId

  const player = playerSystem.get(world, entityId)
  if (player?.activePetId) return player.activePetId

  return undefined
}

function getSourceOwnerPlayerId(ctx: InterpreterContext): string | undefined {
  const { world, systems } = ctx
  const ownerPetId = getSourceOwnerPetId(ctx)
  if (!ownerPetId) return undefined
  const ownerPet = systems.petSystem.get(world, ownerPetId)
  return ownerPet?.ownerId
}

type TurnLikeData = {
  plannedSkillPetIds?: string[]
  executedSkillPetIds?: string[]
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string')
}

function pickSequenceSourcePetId(
  ctx: InterpreterContext,
  source: 'self' | 'opponent',
): string | undefined {
  const sourcePetId = getSourceOwnerPetId(ctx)
  if (!sourcePetId) return undefined
  if (source === 'self') return sourcePetId

  const sourcePlayerId = getSourceOwnerPlayerId(ctx)
  if (!sourcePlayerId) return undefined
  const playerAId = ctx.world.state.playerAId
  const playerBId = ctx.world.state.playerBId
  if (!playerAId || !playerBId) return undefined
  const opponentPlayerId = sourcePlayerId === playerAId ? (playerBId as string) : (playerAId as string)
  return ctx.systems.playerSystem.getActivePet(ctx.world, opponentPlayerId)?.id
}

function hasExactSuffix(history: string[], sequence: string[]): boolean {
  if (sequence.length === 0 || history.length < sequence.length) return false
  const offset = history.length - sequence.length
  for (let i = 0; i < sequence.length; i++) {
    if (history[offset + i] !== sequence[i]) return false
  }
  return true
}

function containsInOrder(history: string[], sequence: string[]): boolean {
  if (sequence.length === 0) return false
  let cursor = 0
  for (const item of history) {
    if (item === sequence[cursor]) cursor++
    if (cursor >= sequence.length) return true
  }
  return false
}

function containsWithGap(history: string[], sequence: string[], maxGap: number): boolean {
  if (sequence.length === 0) return false
  if (maxGap < 0) return false

  for (let start = 0; start < history.length; start++) {
    if (history[start] !== sequence[0]) continue
    let lastIndex = start
    let ok = true
    for (let i = 1; i < sequence.length; i++) {
      let found = -1
      const end = Math.min(history.length - 1, lastIndex + maxGap + 1)
      for (let j = lastIndex + 1; j <= end; j++) {
        if (history[j] === sequence[i]) {
          found = j
          break
        }
      }
      if (found === -1) {
        ok = false
        break
      }
      lastIndex = found
    }
    if (ok) return true
  }
  return false
}

function findTurnDataForCurrentUseSkill(ctx: InterpreterContext): TurnLikeData | undefined {
  const useSkillCtx = findContextInStack(ctx, 'use-skill')
  if (!useSkillCtx) return undefined
  const turnPhaseId = typeof useSkillCtx.parentId === 'string' ? useSkillCtx.parentId : undefined
  if (!turnPhaseId) return undefined
  const turnPhase = ctx.world.phaseStack.find(phase => phase.id === turnPhaseId)
  if (!turnPhase) return undefined
  const phaseData = asRecord(turnPhase.data)
  if (!phaseData) return undefined
  return phaseData as unknown as TurnLikeData
}

/**
 * Default non-common condition implementations.
 */
function evaluateDefaultRegisteredCondition(
  ctx: InterpreterContext,
  condition: ConditionDSL | boolean | undefined | null,
): boolean
function evaluateDefaultRegisteredCondition(
  ctx: InterpreterContext,
  condition: ConditionDSL | boolean | undefined | null,
): boolean {
  if (isCommonCondition(condition)) {
    const commonResult = evaluateCommonCondition(condition, {
      evaluateCondition: nested => evaluateCondition(ctx, nested as ConditionDSL | boolean | undefined | null),
      resolveSelector: selector => resolveSelector(ctx, selector),
      evaluateEvaluator: (value, evaluator) => evaluateEvaluator(ctx, value, evaluator),
    })
    if (commonResult !== undefined) return commonResult
  }
  if (condition === undefined || condition === null || typeof condition === 'boolean') return true
  const cond = condition
  const condType = (cond as { type?: unknown }).type

  if (condType === 'skillSequence') {
    const seqCond = cond as unknown as {
      sequence: Value
      mode?: 'exact' | 'inOrder' | 'withGap'
      maxGap?: Value
      window?: Value
      source?: 'self' | 'opponent'
    }
    const source = (resolveValue(ctx, seqCond.source) as 'self' | 'opponent' | undefined) ?? 'self'
    const petId = pickSequenceSourcePetId(ctx, source)
    if (!petId) return false
    const pet = ctx.systems.petSystem.get(ctx.world, petId)
    if (!pet) return false

    const sequenceRaw = resolveValue(ctx, seqCond.sequence)
    const sequence = Array.isArray(sequenceRaw)
      ? sequenceRaw.filter((s): s is string => typeof s === 'string')
      : (typeof sequenceRaw === 'string' ? [sequenceRaw] : [])
    if (sequence.length === 0) return false

    const mode = (resolveValue(ctx, seqCond.mode) as 'exact' | 'inOrder' | 'withGap' | undefined) ?? 'exact'
    const windowValue = resolveValue(ctx, seqCond.window)
    const windowSize = typeof windowValue === 'number' && Number.isFinite(windowValue)
      ? Math.max(1, Math.floor(windowValue))
      : undefined

    const historyAll = toStringArray(pet.skillHistoryBaseIds)
    const history = windowSize ? historyAll.slice(-windowSize) : historyAll
    if (history.length === 0) return false

    if (mode === 'inOrder') return containsInOrder(history, sequence)
    if (mode === 'withGap') {
      const gapValue = resolveValue(ctx, seqCond.maxGap)
      const maxGap = typeof gapValue === 'number' && Number.isFinite(gapValue) ? Math.max(0, Math.floor(gapValue)) : 1
      return containsWithGap(history, sequence, maxGap)
    }
    return hasExactSuffix(history, sequence)
  }

  switch (cond.type) {
    case 'petIsActive': {
      // Check if source entity's owner pet is the active pet
      const { world, systems } = ctx
      const { petSystem, playerSystem } = systems
      const sourceOwnerPetId = getSourceOwnerPetId(ctx)
      if (!sourceOwnerPetId) return false
      const pet = petSystem.get(world, sourceOwnerPetId)
      if (!pet?.ownerId) return false
      const player = playerSystem.get(world, pet.ownerId)
      if (!player) return false
      return player.activePetId === sourceOwnerPetId
    }

    case 'selfUseSkill': {
      const useSkillCtx = findContextInStack(ctx, 'use-skill')
      if (!useSkillCtx) return false

      const { world, fireCtx, systems } = ctx
      const { skillSystem } = systems
      const sourceOwnerPetId = getSourceOwnerPetId(ctx)
      if (!sourceOwnerPetId) return false

      // Skill source: must be exactly the skill currently being used
      const sourceSkill = skillSystem.get(world, fireCtx.sourceEntityId)
      if (sourceSkill) {
        return sourceOwnerPetId === useSkillCtx.petId && sourceSkill.id === useSkillCtx.skillId
      }

      // Mark/pet source: same owner pet as current skill user
      return sourceOwnerPetId === useSkillCtx.petId
    }

    case 'checkSelf': {
      const sourceOwnerPetId = getSourceOwnerPetId(ctx)
      if (!sourceOwnerPetId) return false
      const current = getCurrentContext(ctx)
      if (current) {
        if (current.type === 'use-skill') return sourceOwnerPetId === current.petId
        if (current.type === 'damage') return sourceOwnerPetId === current.targetId
        if (current.type === 'heal') return sourceOwnerPetId === current.targetId
        if (current.type === 'switch-pet') return sourceOwnerPetId === current.switchInPetId
        if (current.type === 'stack') {
          const existingMarkId = typeof current.existingMarkId === 'string' ? current.existingMarkId : undefined
          if (!existingMarkId) return false
          const existingMark = ctx.systems.markSystem.get(ctx.world, existingMarkId)
          return existingMark?.ownerType === 'pet' && existingMark.ownerId === sourceOwnerPetId
        }
        if (current.type === 'consumeStack') {
          const markId = typeof current.markId === 'string' ? current.markId : undefined
          if (!markId) return false
          const mark = ctx.systems.markSystem.get(ctx.world, markId)
          return mark?.ownerType === 'pet' && mark.ownerId === sourceOwnerPetId
        }
      }

      const rageCtx = findContextInStack(ctx, 'rage')
      if (rageCtx && rageCtx.reason === 'damage') {
        const sourceOwnerPlayerId = getSourceOwnerPlayerId(ctx)
        return sourceOwnerPlayerId !== undefined && sourceOwnerPlayerId === rageCtx.targetPlayerId
      }

      const triggerSourceEntityId =
        typeof ctx.fireCtx.triggerSourceEntityId === 'string' ? ctx.fireCtx.triggerSourceEntityId : undefined
      if (triggerSourceEntityId) {
        const triggerOwnerPetId = getOwnerPetIdByEntityId(ctx, triggerSourceEntityId)
        if (triggerOwnerPetId) return sourceOwnerPetId === triggerOwnerPetId
      }

      return false
    }

    case 'opponentUseSkill': {
      // Check if source owner is NOT the skill user
      const useSkillCtx = findContextInStack(ctx, 'use-skill')  // Fixed: use 'use-skill'
      if (!useSkillCtx) return false
      const sourceOwnerPetId = getSourceOwnerPetId(ctx)
      if (!sourceOwnerPetId) return false
      return sourceOwnerPetId !== useSkillCtx.petId
    }

    case 'selfBeDamaged': {
      // Check if source owner is the damage target
      const damageCtx = findContextInStack(ctx, 'damage')  // Already correct
      if (!damageCtx) return false

      const sourceOwnerPetId = getSourceOwnerPetId(ctx)
      if (!sourceOwnerPetId) return false
      const rageCtx = findContextInStack(ctx, 'rage')
      if (rageCtx && rageCtx.reason === 'damage') {
        const targetPlayerId = typeof rageCtx.targetPlayerId === 'string' ? rageCtx.targetPlayerId : undefined
        if (!targetPlayerId) return false
        const targetActivePet = ctx.systems.playerSystem.getActivePet(ctx.world, targetPlayerId)
        return targetActivePet.id === sourceOwnerPetId
      }
      return sourceOwnerPetId === damageCtx.targetId
    }

    case 'opponentBeDamaged': {
      // Check if source owner is NOT the damage target
      const damageCtx = findContextInStack(ctx, 'damage')  // Already correct
      if (!damageCtx) return false

      const { world, systems } = ctx
      const { petSystem } = systems
      const sourceOwnerPetId = getSourceOwnerPetId(ctx)
      if (!sourceOwnerPetId) return false
      const sourcePet = petSystem.get(world, sourceOwnerPetId)
      if (!sourcePet) return false

      // Check if they are opponents (different players)
      const damageTargetId = typeof damageCtx.targetId === 'string' ? damageCtx.targetId : undefined
      if (!damageTargetId) return false
      const targetPet = petSystem.get(world, damageTargetId)
      if (!targetPet) return false

      return sourcePet.ownerId !== targetPet.ownerId
    }

    case 'selfAddMark': {
      // Check if source owner initiated the addMark
      const addMarkCtx = findContextInStack(ctx, 'add-mark')
      if (!addMarkCtx) return false

      const { world, systems } = ctx
      const { petSystem } = systems
      const sourceOwnerPetId = getSourceOwnerPetId(ctx)
      const creatorId = typeof addMarkCtx.creatorId === 'string' ? addMarkCtx.creatorId : undefined
      if (!creatorId || !sourceOwnerPetId) return false

      const sourcePet = petSystem.get(world, sourceOwnerPetId)
      const creatorPet = petSystem.get(world, creatorId)
      if (!sourcePet || !creatorPet) return false
      return sourcePet.ownerId === creatorPet.ownerId

    }

    case 'opponentAddMark': {
      // Check if source owner is NOT the addMark initiator
      const addMarkCtx = findContextInStack(ctx, 'add-mark')
      if (!addMarkCtx) return false

      const { world, systems } = ctx
      const { petSystem } = systems
      const sourceOwnerPetId = getSourceOwnerPetId(ctx)
      const creatorId = typeof addMarkCtx.creatorId === 'string' ? addMarkCtx.creatorId : undefined
      if (!creatorId || !sourceOwnerPetId) return false

      const sourcePet = petSystem.get(world, sourceOwnerPetId)
      const creatorPet = petSystem.get(world, creatorId)
      if (!sourcePet || !creatorPet) return false
      return sourcePet.ownerId !== creatorPet.ownerId
    }

    case 'selfBeAddMark': {
      // Check if source owner is the addMark target
      const addMarkCtx = findContextInStack(ctx, 'add-mark')
      if (!addMarkCtx) return false

      const { world, systems } = ctx
      const { petSystem } = systems
      const sourceOwnerPetId = getSourceOwnerPetId(ctx)
      const addMarkTargetId = typeof addMarkCtx.targetId === 'string' ? addMarkCtx.targetId : undefined
      if (!addMarkTargetId || !sourceOwnerPetId) return false

      const sourcePet = petSystem.get(world, sourceOwnerPetId)
      const targetPet = petSystem.get(world, addMarkTargetId)
      if (!sourcePet || !targetPet) return false
      return sourcePet.ownerId === targetPet.ownerId
    }

    case 'opponentBeAddMark': {
      // Check if source owner is NOT the addMark target
      const addMarkCtx = findContextInStack(ctx, 'add-mark')
      if (!addMarkCtx) return false

      const { world, systems } = ctx
      const { petSystem } = systems
      const sourceOwnerPetId = getSourceOwnerPetId(ctx)
      const addMarkTargetId = typeof addMarkCtx.targetId === 'string' ? addMarkCtx.targetId : undefined
      if (!addMarkTargetId || !sourceOwnerPetId) return false

      const sourcePet = petSystem.get(world, sourceOwnerPetId)
      const targetPet = petSystem.get(world, addMarkTargetId)
      if (!sourcePet || !targetPet) return false
      return sourcePet.ownerId !== targetPet.ownerId
    }

    case 'selfBeHeal': {
      // Check if source owner is the heal target
      const healCtx = findContextInStack(ctx, 'heal')
      if (!healCtx) return false

      const sourceOwnerPetId = getSourceOwnerPetId(ctx)
      if (!sourceOwnerPetId) return false
      return sourceOwnerPetId === healCtx.targetId
    }

    case 'selfSwitchIn': {
      // Check if source owner is the switch-in pet
      const switchCtx = findContextInStack(ctx, 'switch-pet')
      if (!switchCtx) return false

      const sourceOwnerPetId = getSourceOwnerPetId(ctx)
      if (!sourceOwnerPetId) return false
      return sourceOwnerPetId === switchCtx.switchInPetId
    }

    case 'selfSwitchOut': {
      // Check if source owner is the switch-out pet
      const switchCtx = findContextInStack(ctx, 'switch-pet')
      if (!switchCtx) return false

      const sourceOwnerPetId = getSourceOwnerPetId(ctx)
      if (!sourceOwnerPetId) return false
      return sourceOwnerPetId === switchCtx.switchOutPetId
    }

    case 'selfBeSkillTarget': {
      // Check if source owner is the skill's actualTarget
      const useSkillCtx = findContextInStack(ctx, 'use-skill')
      if (!useSkillCtx) return false

      const sourceOwnerPetId = getSourceOwnerPetId(ctx)
      if (!sourceOwnerPetId) return false
      return sourceOwnerPetId === useSkillCtx.actualTargetId
    }

    case 'selfHasMark': {
      // Check if source owner has a mark with the specified baseId
      const { world, systems } = ctx
      const { markSystem } = systems
      const sourceOwnerPetId = getSourceOwnerPetId(ctx)
      const baseId = resolveValue(ctx, cond.baseId) as string
      if (!sourceOwnerPetId) return false

      const mark = markSystem.findByBaseId(world, sourceOwnerPetId, baseId)
      return mark !== undefined
    }

    case 'opponentHasMark': {
      // Check if opponent active pet has a mark with the specified baseId
      const { world, systems } = ctx
      const { petSystem, playerSystem, markSystem } = systems
      const sourceOwnerPetId = getSourceOwnerPetId(ctx)
      const baseId = resolveValue(ctx, cond.baseId) as string
      if (!sourceOwnerPetId) return false

      const pet = petSystem.get(world, sourceOwnerPetId)
      if (pet?.ownerId) {
        const playerAId = world.state.playerAId
        const playerBId = world.state.playerBId
        if (!playerAId || !playerBId) return false

        const opponentId = pet.ownerId === playerAId ? playerBId as string : playerAId as string
        const opponentPet = playerSystem.getActivePet(world, opponentId)
        if (opponentPet) {
          const mark = markSystem.findByBaseId(world, opponentPet.id, baseId)
          return mark !== undefined
        }
      }
      return false
    }

    case 'continuousUseSkill': {
      // v1 parity:
      // source.owner must be the pet currently using a skill, then check
      // that pet.lastSkillUsedTimes with the requested strategy.
      const { world, systems } = ctx
      const { petSystem } = systems
      const useSkillCtx = findContextInStack(ctx, 'use-skill')
      if (!useSkillCtx) return false
      const sourceOwnerPetId = getSourceOwnerPetId(ctx)
      if (!sourceOwnerPetId || sourceOwnerPetId !== useSkillCtx.petId) return false

      const pet = petSystem.get(world, sourceOwnerPetId)
      if (!pet) return false

      const times = (resolveValue(ctx, cond.times) as number) ?? 2
      const baseHistory = toStringArray(pet.skillHistoryBaseIds)
      const currentBase = baseHistory[baseHistory.length - 1]
      if (!currentBase) return false
      let streak = 0
      for (let i = baseHistory.length - 1; i >= 0; i--) {
        if (baseHistory[i] !== currentBase) break
        streak++
      }
      const strategy = cond.strategy ?? ContinuousUseSkillStrategy.Continuous
      switch (strategy) {
        case ContinuousUseSkillStrategy.Periodic:
          return times > 0 && streak % times === 0
        case ContinuousUseSkillStrategy.Once:
          return streak === times
        case ContinuousUseSkillStrategy.Continuous:
        default:
          return streak >= times
      }
    }

    case 'isFirstSkillUsedThisTurn': {
      const useSkillCtx = findContextInStack(ctx, 'use-skill')
      if (!useSkillCtx) return false
      const turnData = findTurnDataForCurrentUseSkill(ctx)
      const executed = turnData?.executedSkillPetIds
      if (!Array.isArray(executed) || executed.length === 0) return false
      return executed[0] === useSkillCtx.petId
    }

    case 'isLastSkillUsedThisTurn': {
      const useSkillCtx = findContextInStack(ctx, 'use-skill')
      if (!useSkillCtx) return false
      const turnData = findTurnDataForCurrentUseSkill(ctx)
      const planned = turnData?.plannedSkillPetIds
      if (!Array.isArray(planned) || planned.length === 0) return false
      return planned[planned.length - 1] === useSkillCtx.petId
    }

    case 'statStageChange': {
      // v1 checks if current AddMarkContext is a stat-level mark and level sign.
      // v2 currently stores only baseMarkId in context; use stat_stage_* id convention.
      const addMarkCtx = findContextInStack(ctx, 'add-mark')
      if (!addMarkCtx) return false
      const baseMarkId = typeof addMarkCtx.baseMarkId === 'string' ? addMarkCtx.baseMarkId : undefined
      if (!baseMarkId || !baseMarkId.startsWith('stat_stage_')) return false

      const match = /^stat_stage_([^_]+)_(up|down)$/.exec(baseMarkId)
      if (!match) return false
      const stat = match[1]
      const direction = match[2]

      if (cond.stat) {
        const expectStat = resolveValue(ctx, cond.stat)
        const expectList = Array.isArray(expectStat) ? expectStat : [expectStat]
        if (!expectList.includes(stat)) return false
      }

      switch (cond.check ?? 'all') {
        case 'up':
          return direction === 'up'
        case 'down':
          return direction === 'down'
        case 'all':
          return true
        default:
          return false
      }
    }

    default: {
      const conditionType = (cond as { type?: unknown }).type
      const typeText = typeof conditionType === 'string' ? conditionType : String(conditionType)
      throw new Error(`[effect-interpreter] Unsupported condition type: ${typeText}`)
    }
  }
}

const DEFAULT_REGISTERED_CONDITION_TYPES: ConditionDSL['type'][] = [
  'skillSequence',
  'petIsActive',
  'selfUseSkill',
  'checkSelf',
  'opponentUseSkill',
  'selfBeDamaged',
  'opponentBeDamaged',
  'selfAddMark',
  'opponentAddMark',
  'selfBeAddMark',
  'opponentBeAddMark',
  'selfBeHeal',
  'continuousUseSkill',
  'statStageChange',
  'isFirstSkillUsedThisTurn',
  'isLastSkillUsedThisTurn',
  'selfSwitchIn',
  'selfSwitchOut',
  'selfBeSkillTarget',
  'selfHasMark',
  'opponentHasMark',
]

export function registerDefaultConditionHandlers(world: World): void {
  for (const type of DEFAULT_REGISTERED_CONDITION_TYPES) {
    registerConditionHandler(world, type, (ctx, condition) => {
      return evaluateDefaultRegisteredCondition(ctx, condition)
    })
  }
}

/**
 * Evaluate a ConditionDSL to a boolean result.
 * Common combinators stay built-in; non-common conditions are resolved by registry.
 */
export function evaluateCondition(
  ctx: InterpreterContext,
  condition: ConditionDSL | boolean | undefined | null,
): boolean
export function evaluateCondition(
  ctx: InterpreterContext,
  condition: ConditionDSL | boolean | undefined | null,
): boolean {
  if (isCommonCondition(condition)) {
    const commonResult = evaluateCommonCondition(condition, {
      evaluateCondition: nested => evaluateCondition(ctx, nested as ConditionDSL | boolean | undefined | null),
      resolveSelector: selector => resolveSelector(ctx, selector),
      evaluateEvaluator: (value, evaluator) => evaluateEvaluator(ctx, value, evaluator),
    })
    if (commonResult !== undefined) return commonResult
  }
  if (condition === undefined || condition === null || typeof condition === 'boolean') return true

  const handler = getConditionHandler(ctx.world, condition.type)
  if (handler) return handler(ctx, condition)
  throw new Error(`[effect-interpreter] Unsupported condition type: ${condition.type}`)
}

/**
 * Evaluate an EvaluatorDSL against a single value.
 */
export function evaluateEvaluator(
  ctx: InterpreterContext,
  value: unknown,
  evaluator: EvaluatorDSL | undefined | null,
): boolean
export function evaluateEvaluator(
  ctx: InterpreterContext,
  value: unknown,
  evaluator: EvaluatorDSL | undefined | null,
): boolean {
  if (!evaluator) return false
  return evaluateRuntimeEvaluator(value, evaluator as RuntimeEvaluator, {
    resolveValue: valueExpr => resolveValue(ctx, valueExpr as Value | null | undefined),
    randomPercent: percent => ctx.systems.rng.next() * 100 < percent,
  })
}
