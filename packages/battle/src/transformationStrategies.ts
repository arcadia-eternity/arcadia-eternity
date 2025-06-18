import {
  type TransformationStrategy,
  type TransformationState,
  EntityType,
  type PetEntity,
  type PetPrototype,
  type SkillEntity,
  type SkillPrototype,
  type MarkEntity,
  type MarkPrototype,
  EffectHandlingStrategy,
  type AttributeModifiersState,
  type PassiveEffectsState,
} from './transformation'
import { Pet } from './pet'
import { SkillInstance } from './skill'
import { type MarkInstance, MarkInstanceImpl } from './mark'
import type { Battle } from './battle'

/**
 * 精灵变身策略
 */
export class PetTransformationStrategy implements TransformationStrategy<PetEntity, PetPrototype, EntityType.Pet> {
  canTransform(entity: unknown): entity is PetEntity {
    return entity instanceof Pet
  }

  getEntityType(): EntityType.Pet {
    return EntityType.Pet
  }

  preserveState(entity: PetEntity): TransformationState<PetEntity> {
    const maxHp = entity.stat.maxHp
    return {
      entityId: entity.id,
      entityType: EntityType.Pet,
      timestamp: Date.now(),
      data: {
        currentHpRatio: maxHp > 0 ? entity.currentHp / maxHp : 1,
        marks: [...entity.marks],
        appeared: entity.appeared,
        lastSkill: entity.lastSkill,
        lastSkillUsedTimes: entity.lastSkillUsedTimes,
        isAlive: entity.isAlive,
        // 保存当前的属性修改器状态
        attributeModifiers: this.preserveAttributeModifiers(entity),
        // 保存被动效果状态
        passiveEffects: this.preservePassiveEffects(entity),
      },
    }
  }

  private preservePassiveEffects(entity: Pet): PassiveEffectsState {
    // 保存所有来自印记和技能的被动效果
    const passiveEffects: PassiveEffectsState = {
      markEffects: [],
      skillEffects: [],
    }

    // 保存印记的被动效果
    entity.marks.forEach(mark => {
      if (mark.isActive && mark.effects) {
        passiveEffects.markEffects.push({
          markId: mark.id,
          effects: mark.effects.map(effect => ({
            trigger: effect.trigger,
            // 保存效果的关键信息，但不保存函数引用
            effectData: this.serializeEffect(effect),
          })),
        })
      }
    })

    // 保存技能的被动效果（如果有的话）
    // 这里可以根据需要扩展

    return passiveEffects
  }

  private serializeEffect(effect: any): any {
    // 序列化效果对象，保存关键信息但避免循环引用
    return {
      id: effect.id || 'unknown',
      trigger: effect.trigger,
      // 可以根据需要添加更多字段
      metadata: effect.metadata || {},
    }
  }

  private preserveAttributeModifiers(entity: Pet): AttributeModifiersState {
    // 获取当前所有属性的修改器
    try {
      // 获取所有属性的当前值和基础值的差异
      const currentStats = entity.stat
      const baseStats = entity.calculateStats()

      return {
        statDifferences: {
          atk: currentStats.atk - baseStats.atk,
          def: currentStats.def - baseStats.def,
          spa: currentStats.spa - baseStats.spa,
          spd: currentStats.spd - baseStats.spd,
          spe: currentStats.spe - baseStats.spe,
          maxHp: currentStats.maxHp - baseStats.maxHp,
          critRate: currentStats.critRate - entity.baseCritRate,
          accuracy: currentStats.accuracy - entity.baseAccuracy,
          evasion: currentStats.evasion - 0,
        },
      }
    } catch (error) {
      console.warn('Failed to preserve attribute modifiers:', error)
      return {
        statDifferences: {
          atk: 0,
          def: 0,
          spa: 0,
          spd: 0,
          spe: 0,
          maxHp: 0,
          critRate: 0,
          accuracy: 0,
          evasion: 0,
        },
      }
    }
  }

  restoreState(entity: PetEntity, state: TransformationState<PetEntity>): void {
    if (!state?.data) return

    const data = state.data

    // 注意：HP在performTransformation中单独处理，这里不处理HP
    // if (data.currentHpRatio !== undefined) {
    //   const maxHp = entity.stat.maxHp
    //   entity.currentHp = Math.floor(maxHp * (data.currentHpRatio as number))
    // }

    if (data.marks) {
      // 保留原有的印记（变身不应该清除印记）
      entity.marks = data.marks as MarkInstance[]
    }
    if (data.appeared !== undefined) {
      entity.appeared = data.appeared as boolean
    }
    if (data.lastSkill !== undefined) {
      entity.lastSkill = data.lastSkill as SkillInstance | undefined
    }
    if (data.lastSkillUsedTimes !== undefined) {
      entity.lastSkillUsedTimes = data.lastSkillUsedTimes as number
    }
    if (data.isAlive !== undefined) {
      entity.isAlive = data.isAlive as boolean
    }

    // 恢复属性修改器状态
    if (data.attributeModifiers) {
      this.restoreAttributeModifiers(entity, data.attributeModifiers)
    }

    // 恢复被动效果状态
    if (data.passiveEffects) {
      this.restorePassiveEffects(entity, data.passiveEffects)
    }

    // 处理受保护的效果
    if (state.protectedEffects) {
      this.handleProtectedEffects(entity, state.protectedEffects)
    }
  }

  private restoreAttributeModifiers(entity: Pet, modifiers: AttributeModifiersState): void {
    if (!modifiers.statDifferences) return

    try {
      // 这里我们需要重新应用属性差异
      // 注意：这是一个简化的实现，实际情况可能需要更复杂的逻辑
      // 因为属性修改器可能来自多个源（印记、技能效果等）

      // 获取当前的基础属性
      const differences = modifiers.statDifferences

      // 应用保存的差异值
      // 这里我们通过直接修改属性系统来恢复状态
      // 实际实现中可能需要重新创建修改器

      // 注意：这是一个临时解决方案
      // 更好的方法是保存实际的修改器对象并重新应用它们
      console.log('Restoring attribute differences:', differences)

      // TODO: 实现实际的属性修改器恢复逻辑
      // 这里需要根据具体的AttributeSystem实现来恢复修改器
    } catch (error) {
      console.warn('Failed to restore attribute modifiers:', error)
    }
  }

  private restorePassiveEffects(entity: Pet, passiveEffects: PassiveEffectsState): void {
    if (!passiveEffects) return

    try {
      // 恢复印记的被动效果
      if (passiveEffects.markEffects) {
        passiveEffects.markEffects.forEach(markEffect => {
          // 查找对应的印记
          const mark = entity.marks.find(m => m.id === markEffect.markId)
          if (mark && mark.isActive) {
            // 确保印记的效果仍然有效
            // 这里我们假设印记的效果在变身后应该保持不变
            console.log('Preserving passive effects for mark:', markEffect.markId)

            // 如果需要，可以在这里重新激活或验证效果
            // 例如：重新注册效果监听器等
          }
        })
      }

      // 恢复技能的被动效果
      if (passiveEffects.skillEffects) {
        passiveEffects.skillEffects.forEach(skillEffect => {
          console.log('Preserving passive effects for skill:', skillEffect)
          // 实现技能被动效果的恢复逻辑
        })
      }

      console.log('Passive effects preserved during transformation')
    } catch (error) {
      console.warn('Failed to restore passive effects:', error)
    }
  }

  private handleProtectedEffects(entity: Pet, protectedEffects: any[]): void {
    if (!protectedEffects || protectedEffects.length === 0) return

    try {
      protectedEffects.forEach(effect => {
        if (effect.reason === 'transformation_cause') {
          // 确保导致变身的效果在变身后仍然有效
          console.log('Ensuring protected effect remains active:', effect.sourceId)

          if (effect.sourceType === 'mark') {
            // 查找对应的印记并确保其仍然有效
            const mark = entity.marks.find(m => m.id === effect.sourceId)
            if (mark) {
              // 确保印记保持活跃状态
              mark.isActive = true
              console.log('Protected mark effect preserved:', mark.id)
            }
          } else if (effect.sourceType === 'skill') {
            // 处理技能效果的保护
            console.log('Protected skill effect preserved:', effect.sourceId)
          }
        }
      })
    } catch (error) {
      console.warn('Failed to handle protected effects:', error)
    }
  }

  async performTransformation(
    entity: PetEntity,
    newBase: PetPrototype,
    preservedState: TransformationState<PetEntity>,
    effectHandlingStrategy: EffectHandlingStrategy,
  ): Promise<void> {
    // 更新base引用
    ;(entity as any).base = newBase

    // 更新精灵的基础属性
    entity.element = newBase.element

    // 重新计算属性但保留当前HP比例
    const newStats = entity.calculateStats()

    // 更新属性系统的基础值，而不重置modifier
    // 这样可以保留所有现有的modifier
    Object.entries(newStats).forEach(([key, value]) => {
      entity.attributeSystem.updateBaseValue(key, value)
    })

    // 恢复保留的状态（但不包括HP，我们稍后单独处理）
    this.restoreState(entity, preservedState)

    // 在restoreState之后处理特性和徽章的effect策略
    // 这样可以确保我们的marks修改不会被restoreState覆盖
    this.handleEffectStrategy(entity, newBase, effectHandlingStrategy)

    // 最后处理HP，确保使用正确的比例和新的maxHp
    const currentHpRatio = preservedState?.data?.currentHpRatio as number
    if (currentHpRatio !== undefined) {
      // 使用保存的HP比例
      const newCurrentHp = Math.floor(entity.stat.maxHp * currentHpRatio)
      entity.attributeSystem.setCurrentHp(newCurrentHp)
    }
    // 如果没有保存的HP比例，保持当前HP不变（restoreState可能已经处理了）
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
 * 技能变身策略
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

  preserveState(entity: SkillEntity): TransformationState<SkillEntity> {
    return {
      entityId: entity.id,
      entityType: EntityType.Skill,
      timestamp: Date.now(),
      data: {
        appeared: entity.appeared,
        owner: entity.owner,
      },
    }
  }

  restoreState(entity: SkillEntity, state: TransformationState<SkillEntity>): void {
    if (!state?.data) return

    const data = state.data

    if (data.appeared !== undefined) {
      entity.appeared = data.appeared as boolean
    }
    if (data.owner !== undefined) {
      entity.owner = data.owner as Pet | null
    }
  }

  async performTransformation(
    entity: SkillEntity,
    newBase: SkillPrototype,
    preservedState: TransformationState<SkillEntity>,
    effectHandlingStrategy: EffectHandlingStrategy,
  ): Promise<void> {
    // 更新base引用
    ;(entity as any).base = newBase

    // 更新技能属性（使用类型断言来绕过只读限制）
    ;(entity as any).category = newBase.category
    ;(entity as any).element = newBase.element
    entity.power = newBase.power
    entity.accuracy = newBase.accuracy
    entity.rage = newBase.rage
    entity.priority = newBase.priority
    ;(entity as any).target = newBase.target
    ;(entity as any).multihit = newBase.multihit
    ;(entity as any).sureHit = newBase.sureHit
    ;(entity as any).sureCrit = newBase.sureCrit
    ;(entity as any).ignoreShield = newBase.ignoreShield
    ;(entity as any).tags = [...newBase.tags]

    // 处理effects根据策略
    this.handleSkillEffects(entity, newBase, effectHandlingStrategy)

    // 更新属性系统
    entity.attributeSystem.initializeSkillAttributes(entity.power, entity.accuracy, entity.rage, entity.priority, false)

    // 恢复保留的状态
    this.restoreState(entity, preservedState)
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
 * 印记变身策略
 */
export class MarkTransformationStrategy implements TransformationStrategy<MarkEntity, MarkPrototype, EntityType.Mark> {
  canTransform(entity: unknown): entity is MarkEntity {
    return entity instanceof MarkInstanceImpl
  }

  getEntityType(): EntityType.Mark {
    return EntityType.Mark
  }

  preserveState(entity: MarkEntity): TransformationState<MarkEntity> {
    return {
      entityId: entity.id,
      entityType: EntityType.Mark,
      timestamp: Date.now(),
      data: {
        stack: (entity as MarkInstanceImpl).stack,
        duration: entity.duration,
        isActive: entity.isActive,
        owner: entity.owner,
      },
    }
  }

  restoreState(entity: MarkEntity, state: TransformationState<MarkEntity>): void {
    if (!state?.data) return

    const data = state.data
    const markEntity = entity as MarkInstanceImpl

    if (data.stack !== undefined) {
      markEntity.stack = data.stack as number
    }
    if (data.duration !== undefined) {
      entity.duration = data.duration as number
    }
    if (data.isActive !== undefined) {
      entity.isActive = data.isActive as boolean
    }
    if (data.owner !== undefined) {
      entity.owner = data.owner as Pet | Battle | null
    }
  }

  async performTransformation(
    entity: MarkEntity,
    newBase: MarkPrototype,
    preservedState: TransformationState<MarkEntity>,
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

    // 恢复保留的状态
    this.restoreState(entity, preservedState)
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
