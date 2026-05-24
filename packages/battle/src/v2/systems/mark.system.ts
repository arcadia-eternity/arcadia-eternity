// battle/src/v2/systems/mark.system.ts
// MarkSystem — class that manages Mark entities.

import {
  type WorldSystems,
  type WorldPlugins,
  System,
  createEntity,
  setComponent,
  getComponent,
  removeEntity,
  generateId,
} from '@arcadia-eternity/engine'
import type { BaseMarkData, MarkData, MarkConfigData } from '../schemas/mark.schema.js'
import type { PetData } from '../schemas/pet.schema.js'
import type { EntityAttributeDef } from './pet.system.js'
import type { BattleState } from '../types/battle-state.js'
import type { BattleWorld } from '../types/battle-world.js'
import type { MarkAttributes, MarkAttributeSystem } from '../types/battle-attributes.js'

export const MARK = 'mark' as const
const PET = 'pet' as const
export const BATTLE_OWNER_ID = 'battle' as const

// ---------------------------------------------------------------------------
// Attribute declarations — single source of truth for extractor registry
// ---------------------------------------------------------------------------

export const markAttributes: EntityAttributeDef[] = [
  { key: 'duration', valueType: 'number', modifiable: true },
  { key: 'stack', valueType: 'number', modifiable: true },
  { key: 'isActive', valueType: 'boolean', modifiable: true },
  { key: 'tags', valueType: 'object', modifiable: true },
  { key: 'config', valueType: 'object', modifiable: true },
]

// ---------------------------------------------------------------------------
// MarkSystem
// ---------------------------------------------------------------------------

export class MarkSystem extends System<BattleState, WorldSystems, WorldPlugins, MarkAttributes> {
  constructor(attrSystem: MarkAttributeSystem) {
    super(attrSystem)
  }

  // -----------------------------------------------------------------------
  // Creation
  // -----------------------------------------------------------------------

  createFromBase(
    world: BattleWorld,
    baseMark: BaseMarkData,
    overrides?: {
      duration?: number
      stack?: number
      config?: Partial<MarkConfigData>
      creatorId?: string
    },
  ): MarkData {
    const id = generateId('mark')
    const config = { ...baseMark.config, ...overrides?.config }
    const duration = overrides?.duration ?? config.duration
    const normalizedDuration = config.persistent ? -1 : duration

    const mark: MarkData = {
      type: 'mark' as const,
      id,
      baseMarkId: baseMark.id,
      stack: overrides?.stack ?? config.maxStacks ?? 1,
      duration: normalizedDuration,
      isActive: true,
      config,
      tags: [...baseMark.tags],
      effectIds: [...baseMark.effectIds],
      creatorId: overrides?.creatorId,
    }

    createEntity(world, id, [MARK])
    setComponent(world, id, MARK, mark)

    this.attrSystem.registerAttribute(world, id, 'duration', mark.duration)
    this.attrSystem.registerAttribute(world, id, 'stack', mark.stack)
    this.attrSystem.registerAttribute(world, id, 'isActive', true)
    this.attrSystem.registerAttribute(world, id, 'tags', [...mark.tags])
    this.attrSystem.registerAttribute(world, id, 'config', { ...mark.config })

    return mark
  }

  // -----------------------------------------------------------------------
  // Attachment
  // -----------------------------------------------------------------------

  attach(world: BattleWorld, markId: string, ownerId: string, ownerType: 'pet' | 'battle'): void {
    const mark = this.getOrThrow(world, markId)
    mark.ownerId = ownerId
    mark.ownerType = ownerType

    if (ownerType === 'pet') {
      const pet = getComponent(world, ownerId, PET) as PetData | undefined
      if (pet && !pet.markIds.includes(markId)) {
        pet.markIds.push(markId)
      }
    }
  }

  detach(world: BattleWorld, markId: string): void {
    const mark = getComponent(world, markId, MARK) as MarkData | undefined
    if (!mark) return

    if (mark.ownerId && mark.ownerType === 'pet') {
      const pet = getComponent(world, mark.ownerId, PET) as PetData | undefined
      if (pet) {
        const idx = pet.markIds.indexOf(markId)
        if (idx !== -1) pet.markIds.splice(idx, 1)
      }
    }

    mark.ownerId = undefined
    mark.ownerType = undefined
  }

  destroy(world: BattleWorld, markId: string): void {
    this.detach(world, markId)
    removeEntity(world, markId)
  }

  // -----------------------------------------------------------------------
  // Stack operations
  // -----------------------------------------------------------------------

  addStack(world: BattleWorld, markId: string, amount: number): number {
    const config = this.getConfig(world, markId)
    const currentStack = this.getStack(world, markId)
    const newStack = Math.min(currentStack + amount, config.maxStacks)
    const actualAdded = newStack - currentStack
    this.setStack(world, markId, newStack)
    return actualAdded
  }

  consumeStack(world: BattleWorld, markId: string, amount: number): number {
    const config = this.getConfig(world, markId)
    const currentStack = this.getStack(world, markId)
    const actual = Math.min(amount, currentStack)
    const nextStack = currentStack - actual
    this.setStack(world, markId, nextStack)

    if (nextStack <= 0 && config.destroyable) {
      this.setActive(world, markId, false)
    }
    return actual
  }

  // -----------------------------------------------------------------------
  // Duration
  // -----------------------------------------------------------------------

  decrementDuration(world: BattleWorld, markId: string): number {
    const config = this.getConfig(world, markId)
    // v1 semantics: persistent marks do not tick down.
    if (config.persistent) return this.getDuration(world, markId)

    const nextDuration = Math.max(0, this.getDuration(world, markId) - 1)
    this.setDuration(world, markId, nextDuration)

    if (nextDuration <= 0) {
      this.setActive(world, markId, false)
    }
    return nextDuration
  }

  setDuration(world: BattleWorld, markId: string, duration: number): void {
    this.attrSystem.setBaseValue(world, markId, 'duration', duration)
  }

  setStack(world: BattleWorld, markId: string, stack: number): void {
    this.attrSystem.setBaseValue(world, markId, 'stack', stack)
  }

  setActive(world: BattleWorld, markId: string, active: boolean): void {
    this.attrSystem.setBaseValue(world, markId, 'isActive', active)
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  getStack(world: BattleWorld, markId: string): number {
    return this.attrSystem.getValue(world, markId, 'stack') ?? 0
  }

  getDuration(world: BattleWorld, markId: string): number {
    return this.attrSystem.getValue(world, markId, 'duration') ?? 0
  }

  isActive(world: BattleWorld, markId: string): boolean {
    return this.attrSystem.getValue(world, markId, 'isActive') ?? false
  }

  getTags(world: BattleWorld, markId: string): string[] {
    const tags = this.attrSystem.getValue(world, markId, 'tags')
    return Array.isArray(tags) ? tags : []
  }

  getConfig(world: BattleWorld, markId: string): MarkConfigData {
    return this.attrSystem.getValue(world, markId, 'config')
  }

  getMarksOnEntity(world: BattleWorld, entityId: string): MarkData[] {
    if (entityId === BATTLE_OWNER_ID) {
      return Object.keys(world.components.mark ?? {})
        .map(id => getComponent(world, id, MARK) as MarkData | undefined)
        .filter(
          (m): m is MarkData =>
            m !== undefined && m.ownerType === 'battle' && m.ownerId === BATTLE_OWNER_ID && this.isActive(world, m.id),
        )
    }

    const pet = getComponent(world, entityId, PET) as PetData | undefined
    if (!pet) return []
    return pet.markIds
      .map(id => getComponent(world, id, MARK) as MarkData | undefined)
      .filter((m): m is MarkData => m !== undefined && this.isActive(world, m.id))
  }

  findByBaseId(world: BattleWorld, entityId: string, baseMarkId: string): MarkData | undefined {
    return this.getMarksOnEntity(world, entityId).find(m => m.baseMarkId === baseMarkId)
  }

  get(world: BattleWorld, markId: string): MarkData | undefined {
    return getComponent(world, markId, MARK) as MarkData | undefined
  }

  getOrThrow(world: BattleWorld, markId: string): MarkData {
    const mark = getComponent(world, markId, MARK) as MarkData | undefined
    if (!mark) throw new Error(`Mark '${markId}' not found`)
    return mark
  }

  /**
   * Get all shield marks on an entity (marks with isShield=true).
   */
  getShieldMarks(world: BattleWorld, entityId: string): MarkData[] {
    return this.getMarksOnEntity(world, entityId).filter(m => this.getConfig(world, m.id).isShield)
  }

  /**
   * Find all marks on an entity that belong to a given mutex group.
   */
  findByMutexGroup(world: BattleWorld, entityId: string, group: string): MarkData[] {
    return this.getMarksOnEntity(world, entityId).filter(m => this.getConfig(world, m.id).mutexGroup === group)
  }
}
