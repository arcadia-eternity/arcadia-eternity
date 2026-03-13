import type { World } from '@arcadia-eternity/engine'
import { battleExtractorRegistry } from '../extractor-registry.js'
import type { BattleSystems } from './context.js'
import type { EntityKind } from '@arcadia-eternity/schema'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getByPath(target: unknown, path: string): unknown {
  if (!isRecord(target)) return undefined
  const parts = path.split('.')
  let current: unknown = target
  for (const part of parts) {
    if (!isRecord(current) || !(part in current)) return undefined
    current = current[part]
  }
  return current
}

function reportViolation(_world: World, message: string): void {
  throw new Error(message)
}

function inferEntityKind(world: World, systems: BattleSystems, value: unknown): EntityKind | undefined {
  if (typeof value === 'string') {
    if (systems.petSystem.get(world, value)) return 'pet'
    if (systems.skillSystem.get(world, value)) return 'skill'
    if (systems.markSystem.get(world, value)) return 'mark'
    if (systems.playerSystem.get(world, value)) return 'player'
    return undefined
  }
  if (!isRecord(value) || typeof value.type !== 'string') return undefined
  switch (value.type) {
    case 'use-skill':
      return 'useSkillContext'
    case 'damage':
      return 'damageContext'
    case 'heal':
      return 'healContext'
    case 'rage':
      return 'rageContext'
    case 'add-mark':
      return 'addMarkContext'
    case 'switch-pet':
      return 'switchPetContext'
    case 'turn':
      return 'turnContext'
    case 'stack':
      return 'stackContext'
    case 'consumeStack':
      return 'consumeStackContext'
    default:
      return undefined
  }
}

function ensureAllowed(owner: EntityKind | undefined, kind: 'attribute' | 'field' | 'relation', key: string, world: World): void {
  if (!owner) return
  if (kind === 'attribute') {
    const ok = battleExtractorRegistry.attributes.some(a => a.key === key && a.owners.includes(owner))
    if (!ok) reportViolation(world, `attribute '${key}' is not declared for owner '${owner}'`)
    return
  }
  if (kind === 'field') {
    const ok = battleExtractorRegistry.fields.some(f => f.path === key && f.owners.includes(owner))
    if (!ok) reportViolation(world, `field '${key}' is not declared for owner '${owner}'`)
    return
  }
  const ok = battleExtractorRegistry.relations.some(r => r.key === key && r.owners.includes(owner))
  if (!ok) reportViolation(world, `relation '${key}' is not declared for owner '${owner}'`)
}

function isAllowedAttributeForOwner(owner: EntityKind | undefined, key: string): boolean {
  if (!owner) return true
  return battleExtractorRegistry.attributes.some(a => a.key === key && a.owners.includes(owner))
}

function isModifiableAttributeForOwner(owner: EntityKind | undefined, key: string): boolean {
  if (!owner) return true
  const found = battleExtractorRegistry.attributes.find(a => a.key === key && a.owners.includes(owner))
  if (!found) return false
  return found.modifiable === true
}

function resolveRelation(world: World, systems: BattleSystems, entity: unknown, key: string): unknown[] {
  if (typeof entity !== 'string') {
    const value = getByPath(entity, key)
    if (Array.isArray(value)) return value
    return value !== undefined ? [value] : []
  }

  switch (key) {
    case 'owner': {
      const pet = systems.petSystem.get(world, entity)
      if (pet?.ownerId) return [pet.ownerId]
      const skill = systems.skillSystem.get(world, entity)
      if (skill?.ownerId) return [skill.ownerId]
      const mark = systems.markSystem.get(world, entity)
      if (mark?.ownerId) return [mark.ownerId]
      return []
    }
    case 'skills': {
      const pet = systems.petSystem.get(world, entity)
      return pet ? pet.skillIds : []
    }
    case 'marks': {
      return systems.markSystem.getMarksOnEntity(world, entity).map(m => m.id)
    }
    case 'activePet': {
      const player = systems.playerSystem.get(world, entity)
      if (!player) return []
      const pet = systems.playerSystem.getActivePet(world, entity)
      return pet ? [pet.id] : []
    }
    default:
      return []
  }
}

export function resolveExtractorByKind(
  world: World,
  systems: BattleSystems,
  entity: unknown,
  kind: 'attribute' | 'field' | 'relation',
  key: string,
): unknown[] {
  if (!key) return []
  const owner = inferEntityKind(world, systems, entity)
  ensureAllowed(owner, kind, key, world)

  if (kind === 'attribute') {
    if (typeof entity === 'string') {
      const value = systems.attrSystem.getValue(world, entity, key)
      return value !== undefined ? [value] : []
    }
    const value = getByPath(entity, key)
    return value !== undefined ? [value] : []
  }

  if (kind === 'field') {
    if (typeof entity === 'string') {
      const pet = systems.petSystem.get(world, entity)
      if (pet) {
        const value = getByPath(pet, key)
        return value !== undefined ? [value] : []
      }
      const skill = systems.skillSystem.get(world, entity)
      if (skill) {
        const value = getByPath(skill, key)
        return value !== undefined ? [value] : []
      }
      const mark = systems.markSystem.get(world, entity)
      if (mark) {
        const value = getByPath(mark, key)
        return value !== undefined ? [value] : []
      }
      const player = systems.playerSystem.get(world, entity)
      if (player) {
        const value = getByPath(player, key)
        return value !== undefined ? [value] : []
      }
      return []
    }
    const value = getByPath(entity, key)
    return value !== undefined ? [value] : []
  }

  return resolveRelation(world, systems, entity, key)
}

export function ensureAttributeWriteAllowed(
  world: World,
  systems: BattleSystems,
  entity: unknown,
  key: string,
): boolean {
  const owner = inferEntityKind(world, systems, entity)
  if (isAllowedAttributeForOwner(owner, key) && isModifiableAttributeForOwner(owner, key)) return true
  if (!isAllowedAttributeForOwner(owner, key)) {
    reportViolation(world, `attribute '${key}' is not declared for write owner '${owner ?? 'unknown'}'`)
    return false
  }
  reportViolation(world, `attribute '${key}' is readonly for owner '${owner ?? 'unknown'}'`)
  return false
}
