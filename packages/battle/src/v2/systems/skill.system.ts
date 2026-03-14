// battle/src/v2/systems/skill.system.ts
// SkillSystem — class that manages Skill entities.

import {
  type World,
  type AttributeSystem,
  createEntity,
  setComponent,
  getComponent,
  getComponentOrThrow,
  generateId,
} from '@arcadia-eternity/engine'
import { AttackTargetOpinion, IgnoreStageStrategy } from '@arcadia-eternity/const'
import type { BaseSkillData, SkillData } from '../schemas/skill.schema.js'
import type { UseSkillContextData } from '../schemas/context.schema.js'

export const SKILL = 'skill' as const

// ---------------------------------------------------------------------------
// SkillSystem
// ---------------------------------------------------------------------------

export class SkillSystem {
  constructor(private attrSystem: AttributeSystem) {}

  // -----------------------------------------------------------------------
  // Creation
  // -----------------------------------------------------------------------

  createFromBase(world: World, baseSkill: BaseSkillData, ownerId?: string): SkillData {
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

  get(world: World, skillId: string): SkillData | undefined {
    return getComponent<SkillData>(world, skillId, SKILL)
  }

  getOrThrow(world: World, skillId: string): SkillData {
    return getComponentOrThrow<SkillData>(world, skillId, SKILL)
  }

  getPower(world: World, skillId: string): number {
    return this.attrSystem.getValue(world, skillId, 'power') as number ?? 0
  }

  getAccuracy(world: World, skillId: string): number {
    return this.attrSystem.getValue(world, skillId, 'accuracy') as number ?? 100
  }

  getRage(world: World, skillId: string): number {
    return this.attrSystem.getValue(world, skillId, 'rage') as number ?? 0
  }

  getPriority(world: World, skillId: string): number {
    return this.attrSystem.getValue(world, skillId, 'priority') as number ?? 0
  }

  getCategory(world: World, skillId: string): SkillData['category'] {
    return this.attrSystem.getValue(world, skillId, 'category') as SkillData['category']
  }

  getElement(world: World, skillId: string): SkillData['element'] {
    return this.attrSystem.getValue(world, skillId, 'element') as SkillData['element']
  }

  getTarget(world: World, skillId: string): SkillData['target'] {
    const target = this.attrSystem.getValue(world, skillId, 'target')
    return target === AttackTargetOpinion.self ? AttackTargetOpinion.self : AttackTargetOpinion.opponent
  }

  getMultihit(world: World, skillId: string): SkillData['multihit'] {
    return this.attrSystem.getValue(world, skillId, 'multihit') as SkillData['multihit']
  }

  getSureHit(world: World, skillId: string): boolean {
    return this.attrSystem.getValue(world, skillId, 'sureHit') as boolean
  }

  getSureCrit(world: World, skillId: string): boolean {
    return this.attrSystem.getValue(world, skillId, 'sureCrit') as boolean
  }

  getIgnoreShield(world: World, skillId: string): boolean {
    return this.attrSystem.getValue(world, skillId, 'ignoreShield') as boolean
  }

  getIgnoreOpponentStageStrategy(world: World, skillId: string): BaseSkillData['ignoreOpponentStageStrategy'] {
    const skill = this.get(world, skillId)
    if (!skill) return IgnoreStageStrategy.none
    const base = getComponent<BaseSkillData>(world, skill.baseSkillId, 'baseSkill')
    return base?.ignoreOpponentStageStrategy ?? IgnoreStageStrategy.none
  }

  getTags(world: World, skillId: string): string[] {
    return this.attrSystem.getValue(world, skillId, 'tags') as string[]
  }

  isAppeared(world: World, skillId: string): boolean {
    return this.attrSystem.getValue(world, skillId, 'appeared') as boolean
  }

  setAppeared(world: World, skillId: string, appeared: boolean): void {
    this.attrSystem.setBaseValue(world, skillId, 'appeared', appeared)
  }

  setOwner(world: World, skillId: string, ownerId: string): void {
    this.getOrThrow(world, skillId).ownerId = ownerId
  }

  applyToUseSkillContext(
    world: World,
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
