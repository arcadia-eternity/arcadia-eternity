// battle/src/v2/systems/mark.system.ts
// MarkSystem — class that manages Mark entities.

import {
  type World,
  type AttributeSystem,
  createEntity,
  setComponent,
  getComponent,
  removeEntity,
  generateId,
} from '@arcadia-eternity/engine'
import type { BaseMarkData, MarkData, MarkConfigData } from '../schemas/mark.schema.js'
import type { PetData } from '../schemas/pet.schema.js'

export const MARK = 'mark' as const
const PET = 'pet' as const
export const BATTLE_OWNER_ID = 'battle' as const

// ---------------------------------------------------------------------------
// MarkSystem
// ---------------------------------------------------------------------------

export class MarkSystem {
  constructor(private attrSystem: AttributeSystem) {}

  // -----------------------------------------------------------------------
  // Creation
  // -----------------------------------------------------------------------

  createFromBase(
    world: World,
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
    const duration =
      overrides?.duration
      ?? config.duration
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

  attach(world: World, markId: string, ownerId: string, ownerType: 'pet' | 'battle'): void {
    const mark = this.getOrThrow(world, markId)
    mark.ownerId = ownerId
    mark.ownerType = ownerType

    if (ownerType === 'pet') {
      const pet = getComponent<PetData>(world, ownerId, PET)
      if (pet && !pet.markIds.includes(markId)) {
        pet.markIds.push(markId)
      }
    }
  }

  detach(world: World, markId: string): void {
    const mark = getComponent<MarkData>(world, markId, MARK)
    if (!mark) return

    if (mark.ownerId && mark.ownerType === 'pet') {
      const pet = getComponent<PetData>(world, mark.ownerId, PET)
      if (pet) {
        const idx = pet.markIds.indexOf(markId)
        if (idx !== -1) pet.markIds.splice(idx, 1)
      }
    }

    mark.ownerId = undefined
    mark.ownerType = undefined
  }

  destroy(world: World, markId: string): void {
    this.detach(world, markId)
    removeEntity(world, markId)
  }

  // -----------------------------------------------------------------------
  // Stack operations
  // -----------------------------------------------------------------------

  addStack(world: World, markId: string, amount: number): number {
    const config = this.getConfig(world, markId)
    const currentStack = this.getStack(world, markId)
    const newStack = Math.min(currentStack + amount, config.maxStacks)
    const actualAdded = newStack - currentStack
    this.setStack(world, markId, newStack)
    return actualAdded
  }

  consumeStack(world: World, markId: string, amount: number): number {
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

  decrementDuration(world: World, markId: string): number {
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

  setDuration(world: World, markId: string, duration: number): void {
    this.attrSystem.setBaseValue(world, markId, 'duration', duration)
  }

  setStack(world: World, markId: string, stack: number): void {
    this.attrSystem.setBaseValue(world, markId, 'stack', stack)
  }

  setActive(world: World, markId: string, active: boolean): void {
    this.attrSystem.setBaseValue(world, markId, 'isActive', active)
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  getStack(world: World, markId: string): number {
    return this.attrSystem.getValue(world, markId, 'stack') as number ?? 0
  }

  getDuration(world: World, markId: string): number {
    return this.attrSystem.getValue(world, markId, 'duration') as number ?? 0
  }

  isActive(world: World, markId: string): boolean {
    return (this.attrSystem.getValue(world, markId, 'isActive') as boolean | undefined) ?? false
  }

  getTags(world: World, markId: string): string[] {
    const tags = this.attrSystem.getValue(world, markId, 'tags')
    return Array.isArray(tags) ? (tags as string[]) : []
  }

  getConfig(world: World, markId: string): MarkConfigData {
    const config = this.attrSystem.getValue(world, markId, 'config')
    return config as MarkConfigData
  }

  getMarksOnEntity(world: World, entityId: string): MarkData[] {
    if (entityId === BATTLE_OWNER_ID) {
      return Object.keys(world.components.mark ?? {})
        .map(id => getComponent<MarkData>(world, id, MARK))
        .filter((m): m is MarkData =>
          m !== undefined
          && m.ownerType === 'battle'
          && m.ownerId === BATTLE_OWNER_ID
          && this.isActive(world, m.id),
        )
    }

    const pet = getComponent<PetData>(world, entityId, PET)
    if (!pet) return []
    return pet.markIds
      .map(id => getComponent<MarkData>(world, id, MARK))
      .filter((m): m is MarkData => m !== undefined && this.isActive(world, m.id))
  }

  findByBaseId(world: World, entityId: string, baseMarkId: string): MarkData | undefined {
    return this.getMarksOnEntity(world, entityId).find(m => m.baseMarkId === baseMarkId)
  }

  get(world: World, markId: string): MarkData | undefined {
    return getComponent<MarkData>(world, markId, MARK)
  }

  getOrThrow(world: World, markId: string): MarkData {
    const mark = getComponent<MarkData>(world, markId, MARK)
    if (!mark) throw new Error(`Mark '${markId}' not found`)
    return mark
  }

  /**
   * Get all shield marks on an entity (marks with isShield=true).
   */
  getShieldMarks(world: World, entityId: string): MarkData[] {
    return this.getMarksOnEntity(world, entityId).filter(m => this.getConfig(world, m.id).isShield)
  }

  /**
   * Find all marks on an entity that belong to a given mutex group.
   */
  findByMutexGroup(world: World, entityId: string, group: string): MarkData[] {
    return this.getMarksOnEntity(world, entityId).filter(m => this.getConfig(world, m.id).mutexGroup === group)
  }
}
