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
import { MarkInstanceImpl } from './mark'

/**
 * 精灵变身策略 - 简化版本，只处理base值变更
 */
export class PetTransformationStrategy implements TransformationStrategy<PetEntity, PetPrototype, EntityType.Pet> {
  canTransform(entity: unknown): entity is PetEntity {
    return entity instanceof Pet
  }

  getEntityType(): EntityType.Pet {
    return EntityType.Pet
  }

  async performTransformation(
    entity: PetEntity,
    newBase: PetPrototype,
    effectHandlingStrategy: EffectHandlingStrategy,
  ): Promise<void> {
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

    // 处理特性和徽章的effect策略
    this.handleEffectStrategy(entity, newBase, effectHandlingStrategy)
  }

  /**
   * 处理变形时的effect策略
   */
  private handleEffectStrategy(
    entity: PetEntity,
    newBase: PetPrototype,
    effectHandlingStrategy: EffectHandlingStrategy,
  ): void {
    if (effectHandlingStrategy === EffectHandlingStrategy.Override) {
      // 覆盖策略：移除原有的特性和徽章印记，然后添加新的
      this.removeAbilityAndEmblemMarks(entity)
      this.addNewAbilityAndEmblemMarks(entity, newBase)
    } else if (effectHandlingStrategy === EffectHandlingStrategy.Preserve) {
      // 保留策略：保持原有的特性和徽章印记，同时添加新的（如果不冲突）
      this.addNewAbilityAndEmblemMarks(entity, newBase, true)
    }
  }

  /**
   * 移除精灵身上来自特性和徽章的印记
   */
  private removeAbilityAndEmblemMarks(entity: PetEntity): void {
    // 移除来自特性的印记
    if (entity.ability) {
      const abilityMarkId = entity.ability.id
      entity.marks = entity.marks.filter(mark => mark.base.id !== abilityMarkId)
    }

    // 移除来自徽章的印记
    if (entity.emblem) {
      const emblemMarkId = entity.emblem.id
      entity.marks = entity.marks.filter(mark => mark.base.id !== emblemMarkId)
    }
  }

  /**
   * 添加新base的特性和徽章印记
   */
  private addNewAbilityAndEmblemMarks(
    entity: PetEntity,
    newBase: PetPrototype,
    preserveExisting: boolean = false,
  ): void {
    // 添加新的特性印记
    if (newBase.ability && newBase.ability.length > 0) {
      const newAbility = newBase.ability[0] // 通常取第一个特性

      // 检查是否已经存在相同的特性印记（在preserve模式下）
      const existingAbilityMark = preserveExisting
        ? entity.marks.find(mark => mark.base.id === newAbility.id)
        : undefined

      if (!existingAbilityMark) {
        const abilityMark = newAbility.createInstance()
        if (entity.emitter) {
          abilityMark.setOwner(entity, entity.emitter)
        }
        entity.marks.push(abilityMark)

        // 更新Pet的当前特性引用（用于变身期间）
        ;(entity as any).currentAbility = newAbility
      }
    }

    // 添加新的徽章印记
    if (newBase.emblem && newBase.emblem.length > 0) {
      const newEmblem = newBase.emblem[0] // 通常取第一个徽章

      // 检查是否已经存在相同的徽章印记（在preserve模式下）
      const existingEmblemMark = preserveExisting ? entity.marks.find(mark => mark.base.id === newEmblem.id) : undefined

      if (!existingEmblemMark) {
        const emblemMark = newEmblem.createInstance()
        if (entity.emitter) {
          emblemMark.setOwner(entity, entity.emitter)
        }
        entity.marks.push(emblemMark)

        // 更新Pet的当前徽章引用（用于变身期间）
        ;(entity as any).currentEmblem = newEmblem
      }
    }
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

  async performTransformation(
    entity: SkillEntity,
    newBase: SkillPrototype,
    effectHandlingStrategy: EffectHandlingStrategy,
  ): Promise<void> {
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

  async performTransformation(
    entity: MarkEntity,
    newBase: MarkPrototype,
    effectHandlingStrategy: EffectHandlingStrategy,
  ): Promise<void> {
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
