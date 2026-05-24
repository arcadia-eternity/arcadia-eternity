// battle/src/v2/systems/skill.system.ts
// SkillSystem — class that manages Skill entities.

import {
  type WorldSystems,
  type WorldPlugins,
  System,
  createEntity,
  setComponent,
  getComponent,
  getComponentOrThrow,
  generateId,
} from '@arcadia-eternity/engine'
import { AttackTargetOpinion, IgnoreStageStrategy } from '@arcadia-eternity/const'
import type { BaseSkillData, SkillData } from '../schemas/skill.schema.js'
import type { UseSkillContextData } from '../schemas/context.schema.js'
import type { EntityAttributeDef } from './pet.system.js'
import type { BattleState } from '../types/battle-state.js'
import type { BattleWorld } from '../types/battle-world.js'
import type { SkillAttributes, SkillAttributeSystem } from '../types/battle-attributes.js'

export const SKILL = 'skill' as const

// ---------------------------------------------------------------------------
// Attribute declarations — single source of truth for extractor registry
// ---------------------------------------------------------------------------

export const skillAttributes: EntityAttributeDef[] = [
  { key: 'power', valueType: 'number', modifiable: true },
  { key: 'accuracy', valueType: 'number', modifiable: true },
  { key: 'rage', valueType: 'number', modifiable: true },
  { key: 'priority', valueType: 'number', modifiable: true },
  { key: 'category', valueType: 'string', modifiable: true },
  { key: 'element', valueType: 'string', modifiable: true },
  { key: 'target', valueType: 'string', modifiable: true },
  { key: 'multihit', valueType: 'object', modifiable: true },
  { key: 'sureHit', valueType: 'boolean', modifiable: true },
  { key: 'sureCrit', valueType: 'boolean', modifiable: true },
  { key: 'ignoreShield', valueType: 'boolean', modifiable: true },
  { key: 'tags', valueType: 'object', modifiable: true },
  { key: 'appeared', valueType: 'boolean', modifiable: true },
]

// ---------------------------------------------------------------------------
// SkillSystem
// ---------------------------------------------------------------------------

export class SkillSystem extends System<BattleState, WorldSystems, WorldPlugins, SkillAttributes> {
  constructor(attrSystem: SkillAttributeSystem) {
    super(attrSystem)
  }

  // -----------------------------------------------------------------------
  // Creation
  // -----------------------------------------------------------------------

  createFromBase(world: BattleWorld, baseSkill: BaseSkillData, ownerId?: string): SkillData {
    const id = generateId('skill')

    const skill: SkillData = {
      type: 'skill' as const,
      id,
      baseSkillId: baseSkill.id,
      ownerId,
      category: baseSkill.category,
      element: baseSkill.element,
      target: baseSkill.target,
      multihit: baseSkill.multihit,
      sureHit: baseSkill.sureHit,
      sureCrit: baseSkill.sureCrit,
      ignoreShield: baseSkill.ignoreShield,
      tags: [...baseSkill.tags],
      effectIds: [...baseSkill.effectIds],
      appeared: false,
    }

    createEntity(world, id, [SKILL])
    setComponent(world, id, SKILL, skill)

    this.attrSystem.registerAttribute(world, id, 'power', baseSkill.power)
    this.attrSystem.registerAttribute(world, id, 'accuracy', baseSkill.accuracy)
    this.attrSystem.registerAttribute(world, id, 'rage', baseSkill.rage)
    this.attrSystem.registerAttribute(world, id, 'priority', baseSkill.priority)
    this.attrSystem.registerAttribute(world, id, 'category', baseSkill.category)
    this.attrSystem.registerAttribute(world, id, 'element', baseSkill.element)
    this.attrSystem.registerAttribute(world, id, 'target', baseSkill.target)
    this.attrSystem.registerAttribute(world, id, 'multihit', baseSkill.multihit)
    this.attrSystem.registerAttribute(world, id, 'sureHit', baseSkill.sureHit)
    this.attrSystem.registerAttribute(world, id, 'sureCrit', baseSkill.sureCrit)
    this.attrSystem.registerAttribute(world, id, 'ignoreShield', baseSkill.ignoreShield)
    this.attrSystem.registerAttribute(world, id, 'tags', baseSkill.tags)
    this.attrSystem.registerAttribute(world, id, 'appeared', false)

    return skill
  }

  // -----------------------------------------------------------------------
  // Queries
  // -----------------------------------------------------------------------

  get(world: BattleWorld, skillId: string): SkillData | undefined {
    return getComponent(world, skillId, SKILL) as SkillData | undefined
  }

  getOrThrow(world: BattleWorld, skillId: string): SkillData {
    return getComponentOrThrow(world, skillId, SKILL) as SkillData
  }

  getPower(world: BattleWorld, skillId: string): number {
    return this.attrSystem.getValue(world, skillId, 'power') ?? 0
  }

  getAccuracy(world: BattleWorld, skillId: string): number {
    return this.attrSystem.getValue(world, skillId, 'accuracy') ?? 100
  }

  getRage(world: BattleWorld, skillId: string): number {
    return this.attrSystem.getValue(world, skillId, 'rage') ?? 0
  }

  getPriority(world: BattleWorld, skillId: string): number {
    return this.attrSystem.getValue(world, skillId, 'priority') ?? 0
  }

  getCategory(world: BattleWorld, skillId: string): SkillData['category'] {
    return this.attrSystem.getValue(world, skillId, 'category')
  }

  getElement(world: BattleWorld, skillId: string): SkillData['element'] {
    return this.attrSystem.getValue(world, skillId, 'element')
  }

  getTarget(world: BattleWorld, skillId: string): SkillData['target'] {
    const target = this.attrSystem.getValue(world, skillId, 'target')
    return target === AttackTargetOpinion.self ? AttackTargetOpinion.self : AttackTargetOpinion.opponent
  }

  getMultihit(world: BattleWorld, skillId: string): SkillData['multihit'] {
    return this.attrSystem.getValue(world, skillId, 'multihit')
  }

  getSureHit(world: BattleWorld, skillId: string): boolean {
    return this.attrSystem.getValue(world, skillId, 'sureHit')
  }

  getSureCrit(world: BattleWorld, skillId: string): boolean {
    return this.attrSystem.getValue(world, skillId, 'sureCrit')
  }

  getIgnoreShield(world: BattleWorld, skillId: string): boolean {
    return this.attrSystem.getValue(world, skillId, 'ignoreShield')
  }

  getIgnoreOpponentStageStrategy(world: BattleWorld, skillId: string): BaseSkillData['ignoreOpponentStageStrategy'] {
    const skill = this.get(world, skillId)
    if (!skill) return IgnoreStageStrategy.none
    const base = getComponent(world, skill.baseSkillId, 'baseSkill') as BaseSkillData | undefined
    return base?.ignoreOpponentStageStrategy ?? IgnoreStageStrategy.none
  }

  getTags(world: BattleWorld, skillId: string): string[] {
    return this.attrSystem.getValue(world, skillId, 'tags')
  }

  isAppeared(world: BattleWorld, skillId: string): boolean {
    return this.attrSystem.getValue(world, skillId, 'appeared')
  }

  setAppeared(world: BattleWorld, skillId: string, appeared: boolean): void {
    this.attrSystem.setBaseValue(world, skillId, 'appeared', appeared)
  }

  setOwner(world: BattleWorld, skillId: string, ownerId: string): void {
    this.getOrThrow(world, skillId).ownerId = ownerId
  }

  applyToUseSkillContext(
    world: BattleWorld,
    skillId: string,
    context: UseSkillContextData,
    options?: { getOpponentActivePetId?: (originPlayerId: string) => string | undefined },
  ): void {
    context.skillId = skillId
    context.power = this.getPower(world, skillId)
    context.rage = this.getRage(world, skillId)
    context.accuracy = this.getAccuracy(world, skillId)
    context.priority = this.getPriority(world, skillId)
    context.category = this.getCategory(world, skillId)
    context.element = this.getElement(world, skillId)
    context.multihit = this.getMultihit(world, skillId)
    context.ignoreShield = this.getIgnoreShield(world, skillId)
    context.ignoreStageStrategy = this.getIgnoreOpponentStageStrategy(world, skillId)

    const target = this.getTarget(world, skillId)
    context.selectTarget = target
    if (target === 'self') {
      context.actualTargetId = context.petId
    } else if (target === 'opponent' && options?.getOpponentActivePetId) {
      const opponentPetId = options.getOpponentActivePetId(context.originPlayerId)
      if (opponentPetId) context.actualTargetId = opponentPetId
    }

    if (this.getSureHit(world, skillId)) {
      context.hitResult = true
    }
  }
}
