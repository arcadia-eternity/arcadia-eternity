// battle/src/v2/systems/interpreter/selector.ts
// Selector resolution for effect DSL.
// Selectors return entity IDs (strings), not class instances.

import type { InterpreterContext } from './context.js'
import type { SelectorDSL, SelectorChain, ExtractorDSL, Value } from '@arcadia-eternity/schema'
import {
  applyCommonSelectorChain,
  type CommonSelectorChainStep,
  type World,
  getConfigValue,
  getComponent,
  queryByComponent,
  resolveRuntimeSelector,
} from '@arcadia-eternity/engine'
import { evaluateEvaluator, evaluateCondition } from './conditions.js'
import { resolveValue } from './value.js'
import { isConditionDsl, isEvaluatorDsl, isExtractorDsl, isRecord } from './type-guards.js'
import { resolveExtractorByKind } from './extractor-runtime.js'
import { BATTLE_OWNER_ID } from '../mark.system.js'
import {
  getSelectorBaseHandler,
  getSelectorChainHandler,
  registerSelectorBaseHandler,
  registerSelectorChainHandler,
} from './selector-registry.js'

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined
}

/**
 * Resolve a SelectorDSL to an array of entity IDs.
 *
 * Base selectors return entity IDs based on fireCtx:
 * - self: source entity's owner pet ID
 * - opponent: opponent's active pet ID
 * - target: actualTargetId from context
 * - selfPlayer: source entity's owner player ID
 * - opponentPlayer: opponent player ID
 * - selfTeam: source owner's full team pet IDs
 * - opponentTeam: opponent's full team pet IDs
 * - selfMarks: marks on source owner
 * - opponentMarks: marks on opponent active pet
 * - selfSkills: source owner's skill IDs
 * - useSkillContext/damageContext/etc: context entity ID (via fireCtx.contextId)
 * - mark: current mark entity ID (when source is mark)
 * - skill: current skill entity ID (when source is skill)
 * - battle: special battle owner ID
 *
 * Chain steps apply transformations to the result array.
 */
export function resolveSelector(ctx: InterpreterContext, selector: SelectorDSL | undefined): unknown[]
export function resolveSelector(ctx: InterpreterContext, selector: SelectorDSL | undefined): unknown[] {
  return resolveRuntimeSelector(selector, {
    resolveBase: base => resolveBaseSelector(ctx, base),
    applyChain: (results, chain) => applyChain(ctx, results, chain as SelectorChain[]),
    evaluateCondition: condition => isConditionDsl(condition) && evaluateCondition(ctx, condition),
    resolveValue: value => resolveValue(ctx, value as Value | null | undefined),
  })
}

/**
 * Resolve a base selector key to entity IDs.
 */
function resolveDefaultRegisteredBaseSelector(ctx: InterpreterContext, key: string): unknown[] {
  const { world, fireCtx, systems } = ctx
  const { petSystem, playerSystem, markSystem, skillSystem } = systems

  const sourceId = fireCtx.sourceEntityId

  // Helper: get opponent player ID
  const getOpponentPlayerId = (ownerId: string): string | undefined => {
    const playerAId = world.state.playerAId
    const playerBId = world.state.playerBId
    if (!playerAId || !playerBId) return undefined
    return ownerId === playerAId ? (playerBId as string) : (playerAId as string)
  }

  const getActivePetByPlayerId = (playerId: string): ReturnType<typeof petSystem.get> | undefined => {
    const player = playerSystem.get(world, playerId)
    if (!player?.activePetId) return undefined
    return petSystem.get(world, player.activePetId)
  }

  const resolveSourceOwnerPet = (): ReturnType<typeof petSystem.get> | undefined => {
    const sourcePet = petSystem.get(world, sourceId)
    if (sourcePet) return sourcePet
    const sourceSkill = skillSystem.get(world, sourceId)
    if (sourceSkill?.ownerId) return petSystem.get(world, sourceSkill.ownerId)
    const sourceMark = markSystem.get(world, sourceId)
    if (sourceMark?.ownerId) return petSystem.get(world, sourceMark.ownerId)
    return undefined
  }

  switch (key) {
    case 'self': {
      // Source entity's owner pet
      const ownerPet = resolveSourceOwnerPet()
      if (ownerPet) return [ownerPet.id]
      return []
    }

    case 'opponent': {
      // Opponent's active pet
      const ownerPet = resolveSourceOwnerPet()
      if (ownerPet?.ownerId) {
        const opponentId = getOpponentPlayerId(ownerPet.ownerId)
        if (opponentId) {
          const opponentPet = getActivePetByPlayerId(opponentId)
          return opponentPet ? [opponentPet.id] : []
        }
      }
      return []
    }

    case 'target': {
      // actualTargetId from context
      const context = asRecord(fireCtx.context)
      const actualTargetId = typeof context?.actualTargetId === 'string' ? context.actualTargetId : undefined
      const targetId = typeof context?.targetId === 'string' ? context.targetId : undefined
      if (actualTargetId) return [actualTargetId]
      if (targetId) return [targetId]
      return []
    }

    case 'selfPlayer': {
      // Source entity's owner player ID
      const ownerPet = resolveSourceOwnerPet()
      if (ownerPet?.ownerId) return [ownerPet.ownerId]
      return []
    }

    case 'opponentPlayer': {
      // Opponent player ID
      const ownerPet = resolveSourceOwnerPet()
      if (ownerPet?.ownerId) {
        const opponentId = getOpponentPlayerId(ownerPet.ownerId)
        return opponentId ? [opponentId] : []
      }
      return []
    }

    case 'selfTeam': {
      // Source owner's full team
      const ownerPet = resolveSourceOwnerPet()
      if (ownerPet?.ownerId) {
        const player = playerSystem.get(world, ownerPet.ownerId)
        return player ? player.battleTeamPetIds : []
      }
      return []
    }

    case 'opponentTeam': {
      // Opponent's full team
      const ownerPet = resolveSourceOwnerPet()
      if (ownerPet?.ownerId) {
        const opponentId = getOpponentPlayerId(ownerPet.ownerId)
        if (opponentId) {
          const opponentPlayer = playerSystem.get(world, opponentId)
          return opponentPlayer ? opponentPlayer.battleTeamPetIds : []
        }
      }
      return []
    }

    case 'selfMarks': {
      // Marks on source owner
      const ownerPet = resolveSourceOwnerPet()
      if (ownerPet) {
        return markSystem.getMarksOnEntity(world, ownerPet.id).map(m => m.id)
      }
      return []
    }

    case 'opponentMarks': {
      // Marks on opponent active pet
      const ownerPet = resolveSourceOwnerPet()
      if (ownerPet?.ownerId) {
        const opponentId = getOpponentPlayerId(ownerPet.ownerId)
        if (opponentId) {
          const opponentPet = getActivePetByPlayerId(opponentId)
          if (opponentPet) {
            return markSystem.getMarksOnEntity(world, opponentPet.id).map(m => m.id)
          }
        }
      }
      return []
    }

    case 'selfSkills': {
      // Source owner's skill IDs
      const ownerPet = resolveSourceOwnerPet()
      if (ownerPet) return ownerPet.skillIds
      return []
    }

    case 'selfAvailableSkills': {
      const ownerPet = resolveSourceOwnerPet()
      if (!ownerPet) return []
      const ownerPlayer = ownerPet.ownerId ? playerSystem.get(world, ownerPet.ownerId) : undefined
      const currentRage = ownerPlayer ? playerSystem.getRage(world, ownerPlayer.id) : 0
      return ownerPet.skillIds.filter(skillId => skillSystem.getRage(world, skillId) <= currentRage)
    }

    case 'opponentAvailableSkills': {
      const ownerPet = resolveSourceOwnerPet()
      if (!ownerPet?.ownerId) return []
      const opponentId = getOpponentPlayerId(ownerPet.ownerId)
      if (!opponentId) return []
      const opponentPet = getActivePetByPlayerId(opponentId)
      if (!opponentPet) return []
      const currentRage = playerSystem.getRage(world, opponentId)
      return opponentPet.skillIds.filter(skillId => skillSystem.getRage(world, skillId) <= currentRage)
    }

    case 'opponentSkills': {
      const ownerPet = resolveSourceOwnerPet()
      if (!ownerPet?.ownerId) return []
      const opponentId = getOpponentPlayerId(ownerPet.ownerId)
      if (!opponentId) return []
      const opponentPet = getActivePetByPlayerId(opponentId)
      return opponentPet ? opponentPet.skillIds : []
    }

    case 'dataMarks': {
      // Return all base mark IDs loaded into world components.
      return queryByComponent(world, 'baseMark')
    }

    case 'useSkillContext': {
      return resolveContextSelector(world, fireCtx, 'use-skill', ['useSkillContext'])
    }

    case 'damageContext': {
      return resolveContextSelector(world, fireCtx, 'damage', ['damageContext'])
    }

    case 'healContext': {
      return resolveContextSelector(world, fireCtx, 'heal', ['healContext'])
    }

    case 'rageContext': {
      return resolveContextSelector(world, fireCtx, 'rage', ['rageContext'])
    }

    case 'addMarkContext': {
      return resolveContextSelector(world, fireCtx, 'add-mark', ['addMarkContext'])
    }

    case 'switchPetContext': {
      return resolveContextSelector(world, fireCtx, 'switch-pet', ['switchPetContext'])
    }

    case 'turnContext': {
      return resolveContextSelector(world, fireCtx, 'turn', ['turnContext'])
    }

    case 'stackContext': {
      return resolveContextSelector(world, fireCtx, 'stack', ['stackContext'])
    }

    case 'consumeStackContext': {
      return resolveContextSelector(world, fireCtx, 'consumeStack', ['consumeStackContext'])
    }

    case 'effectContext': {
      // Return the fireCtx itself (the EffectFireContext)
      return [fireCtx]
    }

    case 'currentPhase': {
      // Return the top of the phase stack
      const stack = world.phaseStack
      if (stack.length > 0) {
        const phase = stack[stack.length - 1]
        const data = asRecord(phase.data)
        const nestedContext = asRecord(data?.context)
        return nestedContext ? [nestedContext] : data ? [data] : []
      }
      return []
    }

    case 'allPhases': {
      // Return all phase contexts from the stack
      return world.phaseStack
        .map(phase => {
          const data = asRecord(phase.data)
          return asRecord(data?.context) ?? data
        })
        .filter(Boolean)
    }

    case 'mark': {
      // Current mark entity ID (when source is mark)
      const mark = markSystem.get(world, sourceId)
      return mark ? [mark.id] : []
    }

    case 'skill': {
      // Current skill entity ID (when source is skill)
      const skill = skillSystem.get(world, sourceId)
      return skill ? [skill.id] : []
    }

    case 'battle': {
      // Special battle owner ID for global marks/effects.
      return [BATTLE_OWNER_ID]
    }

    default:
      return []
  }
}

const DEFAULT_BASE_SELECTOR_KEYS = [
  'self',
  'opponent',
  'target',
  'selfPlayer',
  'opponentPlayer',
  'selfTeam',
  'opponentTeam',
  'selfMarks',
  'opponentMarks',
  'selfSkills',
  'selfAvailableSkills',
  'opponentAvailableSkills',
  'opponentSkills',
  'dataMarks',
  'useSkillContext',
  'damageContext',
  'healContext',
  'rageContext',
  'addMarkContext',
  'switchPetContext',
  'turnContext',
  'stackContext',
  'consumeStackContext',
  'effectContext',
  'currentPhase',
  'allPhases',
  'mark',
  'skill',
  'battle',
] as const

const DEFAULT_CHAIN_STEP_TYPES = [
  'selectPath',
  'selectObservable',
  'selectAttribute$',
  'asStatLevelMark',
  'sampleBetween',
  'selectProp',
] as const

function resolveBaseSelector(ctx: InterpreterContext, key: string): unknown[] {
  const handler = getSelectorBaseHandler(ctx.world, key)
  if (!handler) return []
  return handler(ctx, key)
}

export function registerDefaultSelectorHandlers(world: World): void {
  for (const base of DEFAULT_BASE_SELECTOR_KEYS) {
    registerSelectorBaseHandler(world, base, (ctx, key) => resolveDefaultRegisteredBaseSelector(ctx, key))
  }
  for (const stepType of DEFAULT_CHAIN_STEP_TYPES) {
    registerSelectorChainHandler(world, stepType, (ctx, current, step) => applyDefaultRegisteredChainStep(ctx, current, step))
  }
}

/**
 * Resolve context from fireCtx, preferring explicit context fields first.
 */
function resolveContextSelector(
  world: InterpreterContext['world'],
  fireCtx: InterpreterContext['fireCtx'],
  contextType: string,
  fieldNames: string[],
): unknown[] {
  for (const fieldName of fieldNames) {
    const value = fireCtx?.[fieldName]
    if (value && typeof value === 'object') {
      const typed = value as { type?: unknown }
      if (typed.type === contextType || typed.type === undefined) {
        return [value]
      }
    }
  }
  return findContextFromStack(world, fireCtx, contextType)
}

/**
 * Find a context from the phase stack by type.
 * Searches from bottom to top (most recent first).
 */
function findContextFromStack(
  world: InterpreterContext['world'],
  fireCtx: InterpreterContext['fireCtx'],
  contextType: string,
): unknown[] {
  // First check if fireCtx.context matches
  const currentContext = asRecord(fireCtx.context)
  if (currentContext && currentContext.type === contextType) {
    return [currentContext]
  }

  // Search phase stack from top to bottom (most recent first)
  const stack = world.phaseStack
  for (let i = stack.length - 1; i >= 0; i--) {
    const phase = stack[i]
    const data = asRecord(phase.data)
    const context = asRecord(data?.context)
    if (context && context.type === contextType) {
      return [context]
    }
  }

  return []
}

/**
 * Apply a chain of transformations to a result array.
 * Exported for use by value.ts.
 */
function resolveVirtualContextValue(
  ctx: InterpreterContext,
  obj: Record<string, unknown>,
  key: string,
): unknown {
  if (key === 'effect') {
    const effectObject = obj.effect
    if (typeof effectObject === 'object' && effectObject !== null) return effectObject
    const effectId = typeof obj.effectId === 'string' ? obj.effectId : undefined
    if (effectId) return { id: effectId }
  }
  if (obj.type === 'skill' && key === 'base') {
    const baseSkillId = typeof obj.baseSkillId === 'string' ? obj.baseSkillId : undefined
    if (!baseSkillId) return undefined
    return getComponent(ctx.world, baseSkillId, 'baseSkill') ?? { id: baseSkillId }
  }
  if (obj.type === 'mark' && key === 'base') {
    const baseMarkId = typeof obj.baseMarkId === 'string' ? obj.baseMarkId : undefined
    if (!baseMarkId) return undefined
    return getComponent(ctx.world, baseMarkId, 'baseMark') ?? { id: baseMarkId }
  }
  if (obj.type === 'pet' && key === 'lastSkill') {
    const lastSkillId = typeof obj.lastSkillId === 'string' ? obj.lastSkillId : undefined
    if (!lastSkillId) return undefined
    return ctx.systems.skillSystem.get(ctx.world, lastSkillId) ?? { id: lastSkillId }
  }

  const contextType = typeof obj.type === 'string' ? obj.type : undefined
  if (!contextType) return undefined

  switch (contextType) {
    case 'use-skill': {
      if (key === 'skill') {
        const skillId = typeof obj.skillId === 'string' ? obj.skillId : undefined
        if (!skillId) return undefined
        return ctx.systems.skillSystem.get(ctx.world, skillId) ?? { id: skillId }
      }
      if (key === 'pet') {
        const petId = typeof obj.petId === 'string' ? obj.petId : undefined
        if (!petId) return undefined
        return ctx.systems.petSystem.get(ctx.world, petId) ?? { id: petId }
      }
      if (key === 'source') return obj.petId
      if (key === 'target') return obj.actualTargetId ?? obj.selectTarget
      return undefined
    }
    case 'damage':
    case 'heal':
      if (key === 'source') return obj.sourceId
      if (key === 'target') return obj.targetId
      return undefined
    case 'add-mark':
      if (key === 'target') return obj.targetId
      if (key === 'creator') return obj.creatorId
      if (key === 'mark') {
        const baseMarkId = typeof obj.baseMarkId === 'string' ? obj.baseMarkId : undefined
        return baseMarkId ? { id: baseMarkId } : undefined
      }
      return undefined
    case 'consumeStack': {
      if (key !== 'mark') return undefined
      const markId = typeof obj.markId === 'string' ? obj.markId : undefined
      if (!markId) return undefined
      const mark = ctx.systems.markSystem.get(ctx.world, markId)
      if (!mark) return { id: markId }
      return { ...mark, base: { id: mark.baseMarkId } }
    }
    case 'switch-pet':
      if (key === 'switchInPet' || key === 'switchIn') return obj.switchInPetId
      if (key === 'switchOut') return obj.switchOutPetId
      return undefined
    default:
      return undefined
  }
}

function resolvePathWithContextAliases(
  ctx: InterpreterContext,
  target: unknown,
  path: string,
): unknown {
  if (typeof target !== 'object' || target === null) return undefined
  const parts = path.split('.')
  let currentValue: unknown = target
  for (const part of parts) {
    if (typeof currentValue !== 'object' || currentValue === null) return undefined
    const obj = currentValue as Record<string, unknown>
    if (part in obj) {
      currentValue = obj[part]
      continue
    }
    const virtualValue = resolveVirtualContextValue(ctx, obj, part)
    if (virtualValue !== undefined) {
      currentValue = virtualValue
      continue
    }
    const contextType = typeof obj.type === 'string' ? obj.type : undefined
    const alias = contextType ? getContextPathAlias(contextType, part) : undefined
    if (!alias || !(alias in obj)) return undefined
    currentValue = obj[alias]
  }
  return currentValue
}

function applyDefaultRegisteredChainStep(
  ctx: InterpreterContext,
  current: unknown[],
  step: SelectorChain,
): unknown[] {
  switch (step.type) {
    case 'selectPath': {
      const path = step.arg
      return current
        .flatMap(item => {
          const resolved = resolvePathWithContextAliases(ctx, item, path)
          if (resolved !== undefined) return [resolved]
          if (typeof item === 'string') return applyExtractor(ctx, item, path)
          return []
        })
        .filter(v => v !== undefined)
    }
    case 'selectObservable': {
      const path = step.arg
      return current
        .map(item => {
          if (typeof item === 'object' && item !== null) {
            const obj = item as Record<string, unknown>
            return obj[path]
          }
          return undefined
        })
        .filter(v => v !== undefined)
    }
    case 'selectAttribute$': {
      const key = step.arg
      const { attrSystem } = ctx.systems
      return current
        .map(item => {
          if (typeof item === 'string') return attrSystem.getValue(ctx.world, item, key)
          if (typeof item === 'object' && item !== null) {
            const obj = item as Record<string, unknown>
            return obj[key]
          }
          return undefined
        })
        .filter(v => v !== undefined)
    }
    case 'asStatLevelMark': {
      const { markSystem } = ctx.systems
      return current.filter(item => {
        if (typeof item === 'string') return markSystem.getTags(ctx.world, item).includes('statStage')
        if (typeof item === 'object' && item !== null) {
          const obj = item as Record<string, unknown>
          const id = typeof obj.id === 'string' ? obj.id : ''
          return /^stat_stage_.+_(up|down)$/.test(id)
        }
        return false
      })
    }
    case 'sampleBetween': {
      if (current.length < 2) return current
      const firstVal = current[0]
      const secondVal = current[1]
      if (typeof firstVal !== 'number' || typeof secondVal !== 'number' || firstVal > secondVal) {
        return []
      }
      return [ctx.systems.rng.nextInt(firstVal, secondVal + 1)]
    }
    case 'selectProp': {
      const key = step.arg
      return current
        .map(item => {
          if (typeof item === 'string') {
            const pet = ctx.systems.petSystem.get(ctx.world, item) as unknown as Record<string, unknown> | undefined
            if (pet) return { object: pet, key }
            const skill = ctx.systems.skillSystem.get(ctx.world, item) as unknown as Record<string, unknown> | undefined
            if (skill) return { object: skill, key }
            const mark = ctx.systems.markSystem.get(ctx.world, item) as unknown as Record<string, unknown> | undefined
            if (mark) return { object: mark, key }
            const player = ctx.systems.playerSystem.get(ctx.world, item) as unknown as Record<string, unknown> | undefined
            if (player) return { object: player, key }
            return undefined
          }
          if (typeof item === 'object' && item !== null) {
            return { object: item as Record<string, unknown>, key }
          }
          return undefined
        })
        .filter(v => v !== undefined)
    }
    default:
      return current
  }
}

export function applyChain(ctx: InterpreterContext, results: unknown[], chain: SelectorChain[]): unknown[] {
  let current = results
  for (const step of chain) {
    const registered = getSelectorChainHandler(ctx.world, step.type)
    if (registered) {
      current = registered(ctx, current, step)
      continue
    }
    current = applyCommonSelectorChain(current, [step as CommonSelectorChainStep], {
      resolveValue: value => resolveValue(ctx, value as Value | null | undefined),
      resolveSelector: selector => resolveSelector(ctx, selector as SelectorDSL),
      evaluateCondition: condition => isConditionDsl(condition) && evaluateCondition(ctx, condition),
      evaluateEvaluator: (value, evaluator) =>
        isEvaluatorDsl(evaluator) && evaluateEvaluator(ctx, value, evaluator),
      applyExtractor: (item, extractor) => applyExtractor(ctx, item, extractor),
      shuffle: items => ctx.systems.rng.shuffle(items),
      getConfigValue: key => getConfigValue(ctx.world.configStore, key),
    })
  }
  return current
}

function getContextPathAlias(contextType: string, key: string): string | undefined {
  switch (contextType) {
    case 'use-skill':
      if (key === 'skill') return 'skillId'
      if (key === 'pet') return 'petId'
      if (key === 'source') return 'petId'
      if (key === 'target') return 'actualTargetId'
      return undefined
    case 'damage':
    case 'heal':
      if (key === 'source') return 'sourceId'
      if (key === 'target') return 'targetId'
      return undefined
    case 'add-mark':
      if (key === 'target') return 'targetId'
      if (key === 'creator') return 'creatorId'
      return undefined
    case 'switch-pet':
      if (key === 'switchIn') return 'switchInPetId'
      if (key === 'switchOut') return 'switchOutPetId'
      return undefined
    default:
      return undefined
  }
}

/**
 * Apply an extractor to an entity ID, returning extracted values.
 */
function applyExtractor(ctx: InterpreterContext, entityId: unknown, extractor: unknown): unknown[] {
  const { world, systems } = ctx
  const { petSystem, playerSystem, markSystem, skillSystem } = systems

  if (!isExtractorDsl(extractor)) return []
  const extractorObject = typeof extractor === 'object' && extractor !== null
    ? (extractor as Record<string, unknown>)
    : undefined
  const extractorType = typeof extractorObject?.type === 'string' ? extractorObject.type : undefined
  const extractorKey = (() => {
    if (typeof extractor === 'string') return extractor
    if (extractorType === 'attribute' || extractorType === 'relation') {
      return typeof extractorObject?.key === 'string' ? extractorObject.key : ''
    }
    if (extractorType === 'field') {
      return typeof extractorObject?.path === 'string' ? extractorObject.path : ''
    }
    return typeof extractorObject?.arg === 'string' ? extractorObject.arg : ''
  })()
  const isStringEntity = typeof entityId === 'string'
  const isObjectEntity = typeof entityId === 'object' && entityId !== null

  const getByPath = (target: unknown, path: string): unknown => {
    if (typeof target !== 'object' || target === null) return undefined
    const parts = path.split('.')
    let current: unknown = target
    for (const part of parts) {
      if (typeof current !== 'object' || current === null) return undefined
      const obj = current as Record<string, unknown>
      if (part in obj) {
        current = obj[part]
        continue
      }
      return undefined
    }
    return current
  }

  const resolveEntityObject = (id: string): unknown => {
    const pet = petSystem.get(world, id)
    if (pet) return pet
    const skill = skillSystem.get(world, id)
    if (skill) return skill
    const mark = markSystem.get(world, id)
    if (mark) return mark
    const player = playerSystem.get(world, id)
    if (player) return player
    return undefined
  }

  if (extractorType === 'attribute') {
    return resolveExtractorByKind(world, systems, entityId, 'attribute', extractorKey)
  }

  // Explicit relation extractor: relation key is resolved by built-in relation branches below.
  // (owner/marks/skills/activePet/...)
  if (extractorType === 'relation') {
    return resolveExtractorByKind(world, systems, entityId, 'relation', extractorKey)
  }

  // Explicit field extractor: read raw object/component field path directly.
  if (extractorType === 'field') {
    return resolveExtractorByKind(world, systems, entityId, 'field', extractorKey)
  }

  switch (extractorKey) {
    case 'currentTurn': {
      if (isStringEntity && entityId === BATTLE_OWNER_ID) {
        const turn = world.state.currentTurn
        return turn !== undefined ? [turn] : []
      }
      if (!isStringEntity) {
        const value = isObjectEntity ? getByPath(entityId, 'currentTurn') : undefined
        return value !== undefined ? [value] : []
      }
      return []
    }

    case 'currentHp': {
      if (!isStringEntity) return []
      const pet = petSystem.get(world, entityId)
      return pet ? [petSystem.getCurrentHp(world, entityId)] : []
    }

    case 'maxHp': {
      if (!isStringEntity) return []
      const maxHp = petSystem.getStatValue(world, entityId, 'maxHp')
      return [maxHp]
    }

    case 'rage': {
      if (!isStringEntity) return []
      const player = playerSystem.get(world, entityId)
      return player ? [playerSystem.getRage(world, entityId)] : []
    }

    case 'owner': {
      if (!isStringEntity) return []
      const pet = petSystem.get(world, entityId)
      if (pet && pet.ownerId) return [pet.ownerId]
      const mark = markSystem.get(world, entityId)
      if (mark && mark.ownerId) return [mark.ownerId]
      return []
    }

    case 'level': {
      if (!isStringEntity) {
        const value = isObjectEntity ? getByPath(entityId, 'level') : undefined
        return value !== undefined ? [value] : []
      }
      const pet = petSystem.get(world, entityId)
      return pet ? [petSystem.getLevel(world, entityId)] : []
    }

    case 'gender': {
      if (!isStringEntity) {
        const value = isObjectEntity ? getByPath(entityId, 'gender') : undefined
        return value !== undefined ? [value] : []
      }
      const pet = petSystem.get(world, entityId)
      return pet ? [petSystem.getGender(world, entityId)] : []
    }

    case 'marks': {
      if (!isStringEntity) return []
      return markSystem.getMarksOnEntity(world, entityId).map(m => m.id)
    }

    case 'stats': {
      if (!isStringEntity) return []
      // Return all stats as an object
      const pet = petSystem.get(world, entityId)
      if (pet) {
        return [
          {
            maxHp: petSystem.getStatValue(world, entityId, 'maxHp'),
            atk: petSystem.getStatValue(world, entityId, 'atk'),
            def: petSystem.getStatValue(world, entityId, 'def'),
            spa: petSystem.getStatValue(world, entityId, 'spa'),
            spd: petSystem.getStatValue(world, entityId, 'spd'),
            spe: petSystem.getStatValue(world, entityId, 'spe'),
            accuracy: petSystem.getStatValue(world, entityId, 'accuracy'),
            evasion: petSystem.getStatValue(world, entityId, 'evasion'),
            critRate: petSystem.getStatValue(world, entityId, 'critRate'),
            ragePerTurn: petSystem.getStatValue(world, entityId, 'ragePerTurn'),
          },
        ]
      }
      return []
    }

    case 'stack': {
      if (!isStringEntity) {
        const value = isObjectEntity ? getByPath(entityId, 'stack') : undefined
        return value !== undefined ? [value] : []
      }
      const mark = markSystem.get(world, entityId)
      return mark ? [markSystem.getStack(world, entityId)] : []
    }

    case 'duration': {
      if (!isStringEntity) {
        const value = isObjectEntity ? getByPath(entityId, 'duration') : undefined
        return value !== undefined ? [value] : []
      }
      const mark = markSystem.get(world, entityId)
      return mark ? [markSystem.getDuration(world, entityId)] : []
    }

    case 'power': {
      if (!isStringEntity) return []
      const power = skillSystem.getPower(world, entityId)
      return [power]
    }

    case 'priority': {
      if (!isStringEntity) return []
      const priority = skillSystem.getPriority(world, entityId)
      return [priority]
    }

    case 'rageCost': {
      if (!isStringEntity) return []
      const rage = skillSystem.getRage(world, entityId)
      return [rage]
    }

    case 'id': {
      if (isStringEntity) return [entityId]
      const value = isObjectEntity ? getByPath(entityId, 'id') : undefined
      return value !== undefined ? [value] : []
    }

    case 'baseId': {
      if (!isStringEntity) {
        const markBaseId = isObjectEntity ? getByPath(entityId, 'baseMarkId') : undefined
        if (markBaseId !== undefined) return [markBaseId]
        const skillBaseId = isObjectEntity ? getByPath(entityId, 'baseSkillId') : undefined
        if (skillBaseId !== undefined) return [skillBaseId]
        const baseId = isObjectEntity ? getByPath(entityId, 'baseId') : undefined
        return baseId !== undefined ? [baseId] : []
      }
      const mark = markSystem.get(world, entityId)
      if (mark) return [mark.baseMarkId]

      // Try skill
      const skillData = skillSystem.get(world, entityId)
      if (skillData?.baseSkillId) return [skillData.baseSkillId]

      const baseMark = getComponent<{ id?: string }>(world, entityId, 'baseMark')
      if (baseMark?.id) return [baseMark.id]

      const baseSkill = getComponent<{ id?: string }>(world, entityId, 'baseSkill')
      if (baseSkill?.id) return [baseSkill.id]

      return []
    }

    case 'tags': {
      if (!isStringEntity) {
        const value = isObjectEntity ? getByPath(entityId, 'tags') : undefined
        return value !== undefined ? [value] : []
      }
      const mark = markSystem.get(world, entityId)
      if (mark) return [markSystem.getTags(world, entityId)]
      const skill = skillSystem.get(world, entityId)
      if (skill) return [skillSystem.getTags(world, entityId)]

      const baseMark = getComponent<{ tags?: unknown }>(world, entityId, 'baseMark')
      if (baseMark && Array.isArray(baseMark.tags)) return [baseMark.tags]

      const baseSkill = getComponent<{ tags?: unknown }>(world, entityId, 'baseSkill')
      if (baseSkill && Array.isArray(baseSkill.tags)) return [baseSkill.tags]

      return []
    }

    case 'activePet': {
      if (!isStringEntity) return []
      const player = playerSystem.get(world, entityId)
      if (player) {
        const activePet = playerSystem.getActivePet(world, entityId)
        return activePet ? [activePet.id] : []
      }
      return []
    }

    case 'skills': {
      if (!isStringEntity) {
        const value = isObjectEntity ? getByPath(entityId, 'skills') : undefined
        return Array.isArray(value) ? value : value !== undefined ? [value] : []
      }
      const pet = petSystem.get(world, entityId)
      return pet ? pet.skillIds : []
    }

    default:
      if (isStringEntity && entityId === BATTLE_OWNER_ID) {
        const value = getByPath(world.state, extractorKey)
        return value !== undefined ? [value] : []
      }
      if (isStringEntity) {
        const entity = resolveEntityObject(entityId)
        const value = entity !== undefined ? getByPath(entity, extractorKey) : undefined
        return value !== undefined ? [value] : []
      }
      if (!isObjectEntity) return []
      const value = getByPath(entityId, extractorKey)
      return value !== undefined ? [value] : []
  }
}
