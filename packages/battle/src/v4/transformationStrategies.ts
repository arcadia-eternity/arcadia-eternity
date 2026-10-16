import {
  type TransformationStrategy,
  EntityType,
  type PetEntity,
  type PetPrototype,
  type SkillEntity,
  type SkillPrototype,
  type MarkEntity,
  type MarkPrototype,
  EffectHandlingStrategy,
} from './transformation'
import { Pet } from './pet'
import { SkillInstance } from './skill'
import { MarkInstanceImpl, type MarkInstance, type BaseMark } from './mark'

/**
 * 精灵变身策略 - 简化版本，只处理base值变更
 */
export class PetTransformationStrategy implements TransformationStrategy<PetEntity, PetPrototype, EntityType.Pet> {
  // Native marks can themselves cause forms. Suspend them, retaining their owner,
  // duration and source identity, so source expiry can still revert the form.
  private nativeMarks = new WeakMap<PetEntity, Map<string, MarkInstance>>()
  canTransform(entity: unknown): entity is PetEntity {
    return entity instanceof Pet
  }

  getEntityType(): EntityType.Pet {
    return EntityType.Pet
  }

  performTransformation(
    entity: PetEntity,
    newBase: PetPrototype,
    effectHandlingStrategy: EffectHandlingStrategy,
  ): void {
    // 更新base引用
    ;(entity as any).base = newBase

    // 更新精灵的基础属性
    entity.element = newBase.element

    // 重新计算属性并更新属性系统的基础值
    // 这样可以保留所有现有的modifier
    const newStats = entity.calculateStats()
    Object.entries(newStats).forEach(([key, value]) => {
      entity.attributeSystem.updateBaseValue(key, value)
    })

    this.handleEffectStrategy(entity, newBase, effectHandlingStrategy)
  }

  private handleEffectStrategy(entity: PetEntity, newBase: PetPrototype, strategy: EffectHandlingStrategy): void {
    let marks = this.nativeMarks.get(entity)
    if (!marks) {
      marks = new Map()
      for (const base of [entity.ability, entity.emblem]) {
        const instance = base && entity.marks.find(mark => mark.baseId === base.id)
        if (instance) marks.set(instance.baseId, instance)
      }
      this.nativeMarks.set(entity, marks)
    }
    if (strategy === EffectHandlingStrategy.Override) for (const mark of marks.values()) mark.isSuppressed = true
    const restoringOriginal = newBase === entity.originalSpecies
    const ability = restoringOriginal ? entity.ability : newBase.ability?.[0]
    const emblem = restoringOriginal ? entity.emblem : newBase.emblem?.[0]
    for (const base of [ability, emblem]) {
      if (!base) continue
      let mark = marks.get(base.id)
      if (!mark?.isActive || mark.owner !== entity) {
        mark = base.createInstance()
        if (entity.emitter) mark.setOwner(entity, entity.emitter)
        entity.marks.push(mark)
        marks.set(base.id, mark)
      }
      mark.isSuppressed = false
    }
    ;(entity as PetEntity & { currentAbility?: BaseMark }).currentAbility = ability
    ;(entity as PetEntity & { currentEmblem?: BaseMark }).currentEmblem = emblem
  }

  getOriginalBase(entity: PetEntity): PetPrototype | undefined {
    return entity.originalSpecies
  }
}

/**
 * 技能变身策略 - 简化版本，只处理base值变更
 */
export class SkillTransformationStrategy
  implements TransformationStrategy<SkillEntity, SkillPrototype, EntityType.Skill>
{
  canTransform(entity: unknown): entity is SkillEntity {
    return entity instanceof SkillInstance
  }

  getEntityType(): EntityType.Skill {
    return EntityType.Skill
  }

  performTransformation(
    entity: SkillEntity,
    newBase: SkillPrototype,
    effectHandlingStrategy: EffectHandlingStrategy,
  ): void {
    // 更新base引用
    ;(entity as any).base = newBase

    // 更新技能属性（使用类型断言来绕过只读限制）
    ;(entity as any).category = newBase.category
    ;(entity as any).element = newBase.element
    ;(entity as any).target = newBase.target
    ;(entity as any).multihit = newBase.multihit
    ;(entity as any).sureHit = newBase.sureHit
    ;(entity as any).sureCrit = newBase.sureCrit
    ;(entity as any).ignoreShield = newBase.ignoreShield
    ;(entity as any).tags = [...newBase.tags]

    // 处理effects根据策略
    this.handleSkillEffects(entity, newBase, effectHandlingStrategy)

    // 更新属性系统的基础值，保留所有modifier
    entity.attributeSystem.updateBaseValue('power', newBase.power)
    entity.attributeSystem.updateBaseValue('accuracy', newBase.accuracy)
    entity.attributeSystem.updateBaseValue('rage', newBase.rage)
    entity.attributeSystem.updateBaseValue('priority', newBase.priority)
  }

  /**
   * 处理技能effects的策略
   */
  private handleSkillEffects(
    entity: SkillEntity,
    newBase: SkillPrototype,
    effectHandlingStrategy: EffectHandlingStrategy,
  ): void {
    if (effectHandlingStrategy === EffectHandlingStrategy.Override) {
      // 覆盖策略：完全使用新base的effects
      ;(entity as any).effects = [...newBase.effects]
    } else if (effectHandlingStrategy === EffectHandlingStrategy.Preserve) {
      // 保留策略：合并原有effects和新base的effects
      const originalEffects = entity.effects || []
      const newEffects = newBase.effects || []

      // 创建一个Map来去重，以effect.id为key
      const effectMap = new Map()

      // 先添加原有的effects
      originalEffects.forEach(effect => {
        effectMap.set(effect.id, effect)
      })

      // 再添加新的effects，如果id相同则覆盖
      newEffects.forEach(effect => {
        effectMap.set(effect.id, effect)
      })
      ;(entity as any).effects = Array.from(effectMap.values())
    }
  }

  getOriginalBase(entity: SkillEntity): SkillPrototype | undefined {
    return entity.base
  }
}

/**
 * 印记变身策略 - 简化版本，只处理base值变更
 */
export class MarkTransformationStrategy implements TransformationStrategy<MarkEntity, MarkPrototype, EntityType.Mark> {
  canTransform(entity: unknown): entity is MarkEntity {
    return entity instanceof MarkInstanceImpl
  }

  getEntityType(): EntityType.Mark {
    return EntityType.Mark
  }

  performTransformation(
    entity: MarkEntity,
    newBase: MarkPrototype,
    effectHandlingStrategy: EffectHandlingStrategy,
  ): void {
    // 更新base引用
    ;(entity as any).base = newBase

    // 更新印记属性
    const markEntity = entity as MarkInstanceImpl
    markEntity.config = { ...newBase.config }
    ;(entity as any).tags = [...newBase.tags]

    // 处理effects根据策略
    this.handleMarkEffects(entity, newBase, effectHandlingStrategy)
  }

  /**
   * 处理印记effects的策略
   */
  private handleMarkEffects(
    entity: MarkEntity,
    newBase: MarkPrototype,
    effectHandlingStrategy: EffectHandlingStrategy,
  ): void {
    if (effectHandlingStrategy === EffectHandlingStrategy.Override) {
      // 覆盖策略：完全使用新base的effects
      ;(entity as any).effects = [...newBase.effects]
    } else if (effectHandlingStrategy === EffectHandlingStrategy.Preserve) {
      // 保留策略：合并原有effects和新base的effects
      const originalEffects = entity.effects || []
      const newEffects = newBase.effects || []

      // 创建一个Map来去重，以effect.id为key
      const effectMap = new Map()

      // 先添加原有的effects
      originalEffects.forEach(effect => {
        effectMap.set(effect.id, effect)
      })

      // 再添加新的effects，如果id相同则覆盖
      newEffects.forEach(effect => {
        effectMap.set(effect.id, effect)
      })
      ;(entity as any).effects = Array.from(effectMap.values())
    }
  }

  getOriginalBase(entity: MarkEntity): MarkPrototype | undefined {
    return entity.base
  }
}

/**
 * 默认变身策略工厂
 */
export class DefaultTransformationStrategies {
  static createPetStrategy(): PetTransformationStrategy {
    return new PetTransformationStrategy()
  }

  static createSkillStrategy(): SkillTransformationStrategy {
    return new SkillTransformationStrategy()
  }

  static createMarkStrategy(): MarkTransformationStrategy {
    return new MarkTransformationStrategy()
  }

  static getAllStrategies(): Array<{ type: string; strategy: any }> {
    return [
      { type: 'pet', strategy: this.createPetStrategy() },
      { type: 'skill', strategy: this.createSkillStrategy() },
      { type: 'mark', strategy: this.createMarkStrategy() },
    ]
  }
}
