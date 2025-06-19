import { BattleMessageType, EffectTrigger } from '@arcadia-eternity/const'
import { nanoid } from 'nanoid'
import { Battle } from './battle'
import { TransformContext } from './context'
import { type Prototype, type Instance } from './entity'
import {
  PetTransformationStrategy,
  SkillTransformationStrategy,
  MarkTransformationStrategy,
} from './transformationStrategies'
import { Pet, type Species } from './pet'
import { SkillInstance, type BaseSkill } from './skill'
import { type MarkInstance, MarkInstanceImpl, type BaseMark } from './mark'
import type { Effect } from './effect'

// 实体类型枚举
export const enum EntityType {
  Pet = 'pet',
  Skill = 'skill',
  Mark = 'mark',
}

// Effect处理策略枚举
export const enum EffectHandlingStrategy {
  Override = 'override', // 覆盖原有effects，使用新base的effects
  Preserve = 'preserve', // 保留原有effects，与新base的effects合并
}

// 简化的变身策略接口
export interface TransformationStrategy<
  TEntity extends Transformable,
  TPrototype extends Prototype,
  TEntityType extends EntityType,
> {
  canTransform(entity: unknown): entity is TEntity
  getEntityType(): TEntityType
  performTransformation(entity: TEntity, newBase: TPrototype, effectHandlingStrategy: EffectHandlingStrategy): void
  getOriginalBase(entity: TEntity): TPrototype | undefined
}

// 简化的变身状态类型 - 只保存必要的基础信息
export interface TransformationState {
  readonly entityId: string
  readonly entityType: EntityType
  readonly timestamp: number
  readonly currentHpRatio?: number // 仅对Pet有效，保存HP比例
}

// 强类型的变身接口
export interface Transformable extends Instance {
  base: Prototype
}

// 具体的实体类型定义
export type PetEntity = Pet
export type SkillEntity = SkillInstance
export type MarkEntity = MarkInstance

// 具体的原型类型定义
export type PetPrototype = Species
export type SkillPrototype = BaseSkill
export type MarkPrototype = BaseMark

// 联合类型
export type TransformableEntity = PetEntity | SkillEntity | MarkEntity
export type TransformablePrototype = PetPrototype | SkillPrototype | MarkPrototype

// 类型映射
export interface EntityTypeMap {
  [EntityType.Pet]: {
    entity: PetEntity
    prototype: PetPrototype
    strategy: TransformationStrategy<PetEntity, PetPrototype, EntityType.Pet>
  }
  [EntityType.Skill]: {
    entity: SkillEntity
    prototype: SkillPrototype
    strategy: TransformationStrategy<SkillEntity, SkillPrototype, EntityType.Skill>
  }
  [EntityType.Mark]: {
    entity: MarkEntity
    prototype: MarkPrototype
    strategy: TransformationStrategy<MarkEntity, MarkPrototype, EntityType.Mark>
  }
}

// 简化的变身记录类型
export interface TransformationRecord<
  TEntity extends TransformableEntity = TransformableEntity,
  TPrototype extends TransformablePrototype = TransformablePrototype,
> {
  readonly id: string
  readonly target: TEntity
  readonly targetType: EntityType
  readonly originalBase: TPrototype
  readonly currentBase: TPrototype
  readonly transformType: 'temporary' | 'permanent'
  readonly priority: number
  readonly causedBy?: MarkInstance | SkillInstance | Effect<EffectTrigger>
  readonly isActive: boolean
  readonly createdAt: number
  readonly currentHpRatio?: number // 仅对Pet有效，保存HP比例
  readonly permanentStrategy?: 'preserve_temporary' | 'clear_temporary'
  readonly effectHandlingStrategy: EffectHandlingStrategy
}

// 策略联合类型
export type AnyTransformationStrategy =
  | TransformationStrategy<PetEntity, PetPrototype, EntityType.Pet>
  | TransformationStrategy<SkillEntity, SkillPrototype, EntityType.Skill>
  | TransformationStrategy<MarkEntity, MarkPrototype, EntityType.Mark>

// 变身策略注册表
export class TransformationStrategyRegistry {
  private strategies = new Map<EntityType, AnyTransformationStrategy>()

  register<T extends EntityType>(entityType: T, strategy: EntityTypeMap[T]['strategy']): void {
    this.strategies.set(entityType, strategy as AnyTransformationStrategy)
  }

  getStrategy<TEntity extends TransformableEntity>(entity: TEntity): AnyTransformationStrategy | undefined {
    for (const [, strategy] of this.strategies) {
      if (strategy.canTransform(entity)) {
        return strategy
      }
    }
    return undefined
  }

  getStrategyByType<T extends EntityType>(entityType: T): EntityTypeMap[T]['strategy'] | undefined {
    return this.strategies.get(entityType) as EntityTypeMap[T]['strategy'] | undefined
  }

  getAllStrategies(): AnyTransformationStrategy[] {
    return Array.from(this.strategies.values())
  }
}

/**
 * 变身系统核心类
 * 管理所有实体的变身状态，包括临时变身和永久变身
 */
export class TransformationSystem {
  private transformations = new Map<string, TransformationRecord[]>() // targetId -> transformations
  private temporaryTransformStack = new Map<string, TransformationRecord[]>() // targetId -> stack
  private permanentTransforms = new Map<string, TransformationRecord>() // targetId -> permanent transform
  private strategyRegistry = new TransformationStrategyRegistry()

  constructor(private battle: Battle) {
    this.initializeDefaultStrategies()
  }

  /**
   * 初始化默认的变身策略
   */
  private initializeDefaultStrategies(): void {
    // 直接注册默认策略
    this.registerStrategy(EntityType.Pet, new PetTransformationStrategy())
    this.registerStrategy(EntityType.Skill, new SkillTransformationStrategy())
    this.registerStrategy(EntityType.Mark, new MarkTransformationStrategy())
  }

  /**
   * 注册变身策略
   */
  registerStrategy<T extends EntityType>(entityType: T, strategy: EntityTypeMap[T]['strategy']): void {
    this.strategyRegistry.register(entityType, strategy)
  }

  /**
   * 应用变身效果 - 类型安全的重载方法
   */
  applyTransformation<T extends EntityType>(
    target: EntityTypeMap[T]['entity'],
    newBase: EntityTypeMap[T]['prototype'],
    transformType: 'temporary' | 'permanent',
    priority?: number,
    causedBy?: MarkInstance | SkillInstance | Effect<EffectTrigger>,
    permanentStrategy?: 'preserve_temporary' | 'clear_temporary',
    effectHandlingStrategy?: EffectHandlingStrategy,
  ): boolean

  /**
   * 应用变身效果 - 通用方法
   */
  applyTransformation(
    target: TransformableEntity,
    newBase: TransformablePrototype,
    transformType: 'temporary' | 'permanent',
    priority?: number,
    causedBy?: MarkInstance | SkillInstance | Effect<EffectTrigger>,
    permanentStrategy?: 'preserve_temporary' | 'clear_temporary',
    effectHandlingStrategy?: EffectHandlingStrategy,
  ): boolean

  applyTransformation(
    target: TransformableEntity,
    newBase: TransformablePrototype,
    transformType: 'temporary' | 'permanent',
    priority: number = 0,
    causedBy?: MarkInstance | SkillInstance | Effect<EffectTrigger>,
    permanentStrategy: 'preserve_temporary' | 'clear_temporary' = 'clear_temporary',
    effectHandlingStrategy: EffectHandlingStrategy = EffectHandlingStrategy.Preserve,
  ): boolean {
    return this.applyTransformationInternal(
      target,
      newBase,
      transformType,
      priority,
      causedBy,
      permanentStrategy,
      effectHandlingStrategy,
    )
  }

  /**
   * 内部实现方法
   */
  private applyTransformationInternal(
    target: TransformableEntity,
    newBase: TransformablePrototype,
    transformType: 'temporary' | 'permanent',
    priority: number,
    causedBy?: MarkInstance | SkillInstance | Effect<EffectTrigger>,
    permanentStrategy: 'preserve_temporary' | 'clear_temporary' = 'clear_temporary',
    effectHandlingStrategy: EffectHandlingStrategy = EffectHandlingStrategy.Preserve,
  ): boolean {
    // 获取适合的变身策略
    const strategy = this.strategyRegistry.getStrategy(target)
    if (!strategy) {
      console.warn('No transformation strategy found for target:', target)
      return false
    }

    const targetType = strategy.getEntityType()

    // 获取真正的原始base - 如果已经有变身记录，使用第一个记录的originalBase
    const existingTransformations = this.transformations.get(target.id)
    const originalBase =
      existingTransformations && existingTransformations.length > 0
        ? existingTransformations[0].originalBase
        : target.base

    // 创建变身上下文
    const context = new TransformContext(
      this.battle,
      target as Pet, // TransformContext 需要具体类型，这里使用类型断言
      targetType as 'pet',
      originalBase,
      newBase,
      transformType,
      priority,
      causedBy,
    )

    // 触发变身前效果
    this.battle.applyEffects(context, EffectTrigger.BeforeTransform)

    if (!context.available) {
      return false
    }

    // 保存当前HP比例（仅对Pet有效）
    let currentHpRatio: number | undefined
    if (target instanceof Pet) {
      const maxHp = target.stat.maxHp
      currentHpRatio = maxHp > 0 ? target.currentHp / maxHp : 1
    }

    // 创建变身记录
    const record: TransformationRecord = {
      id: nanoid(),
      target,
      targetType,
      originalBase,
      currentBase: newBase,
      transformType,
      priority,
      causedBy,
      isActive: true,
      createdAt: Date.now(),
      currentHpRatio,
      permanentStrategy: transformType === 'permanent' ? permanentStrategy : undefined,
      effectHandlingStrategy,
    }

    if (transformType === 'temporary') {
      this.applyTemporaryTransformation(record)
    } else {
      this.applyPermanentTransformation(record, strategy)
    }

    // 触发变身后效果
    this.battle.applyEffects(context, EffectTrigger.AfterTransform)

    // 发送变身消息
    this.battle.emitMessage(BattleMessageType.Transform, {
      target: target.id,
      targetType,
      fromBase: originalBase.id,
      toBase: newBase.id,
      transformType,
      priority,
      causedBy: causedBy?.id,
    })

    return true
  }

  /**
   * 类型安全的变身执行方法
   */
  private performTransformationTypeSafe(
    target: TransformableEntity,
    newBase: TransformablePrototype,
    strategy: AnyTransformationStrategy,
    effectHandlingStrategy: EffectHandlingStrategy,
    currentHpRatio?: number,
  ): void {
    if (target instanceof Pet) {
      const petStrategy = strategy as TransformationStrategy<PetEntity, PetPrototype, EntityType.Pet>
      petStrategy.performTransformation(target, newBase as PetPrototype, effectHandlingStrategy)
      // 恢复HP比例
      if (currentHpRatio !== undefined) {
        const newCurrentHp = Math.floor(target.stat.maxHp * currentHpRatio)
        target.attributeSystem.setCurrentHp(newCurrentHp)
      }
    } else if (target instanceof SkillInstance) {
      const skillStrategy = strategy as TransformationStrategy<SkillEntity, SkillPrototype, EntityType.Skill>
      skillStrategy.performTransformation(target, newBase as SkillPrototype, effectHandlingStrategy)
    } else if (target instanceof MarkInstanceImpl) {
      const markStrategy = strategy as TransformationStrategy<MarkEntity, MarkPrototype, EntityType.Mark>
      markStrategy.performTransformation(target, newBase as MarkPrototype, effectHandlingStrategy)
    } else {
      throw new Error(`Unsupported entity type for transformation: ${target.constructor.name}`)
    }
  }

  /**
   * 应用临时变身
   */
  private applyTemporaryTransformation(record: TransformationRecord): void {
    const targetId = record.target.id

    // 获取或创建变身栈
    if (!this.temporaryTransformStack.has(targetId)) {
      this.temporaryTransformStack.set(targetId, [])
    }

    const stack = this.temporaryTransformStack.get(targetId)!

    // 如果有causedBy，先移除由同一个source引起的旧变身
    if (record.causedBy) {
      const existingIndex = stack.findIndex(t => t.causedBy === record.causedBy)
      if (existingIndex !== -1) {
        const removedRecord = stack.splice(existingIndex, 1)[0]
        // 同时从transformations记录中移除
        const transformations = this.transformations.get(targetId)
        if (transformations) {
          const recordIndex = transformations.findIndex(t => t.id === removedRecord.id)
          if (recordIndex !== -1) {
            transformations.splice(recordIndex, 1)
          }
        }
        console.log(
          `[Transformation] Replaced existing transformation from same source: ${removedRecord.currentBase.id} -> ${record.currentBase.id}`,
        )
      }
    }

    // 按优先级插入到正确位置
    const insertIndex = stack.findIndex(t => t.priority < record.priority)
    if (insertIndex === -1) {
      stack.push(record)
    } else {
      stack.splice(insertIndex, 0, record)
    }

    // 应用最高优先级的变身
    this.applyTopTransformation(targetId)

    // 记录变身
    this.addTransformationRecord(targetId, record)
  }

  /**
   * 应用永久变身
   */
  private applyPermanentTransformation(record: TransformationRecord, strategy: AnyTransformationStrategy): void {
    const targetId = record.target.id

    // 根据策略决定是否清理临时变身
    if (record.permanentStrategy === 'clear_temporary') {
      // 默认策略：清理所有临时变身
      this.clearTemporaryTransformations(targetId)
    }
    // 如果是 'preserve_temporary' 策略，则保留临时变身

    // 应用永久变身
    this.permanentTransforms.set(targetId, record)

    // 如果没有临时变身或者清理了临时变身，直接应用永久变身
    const hasTemporaryTransforms = this.temporaryTransformStack.get(targetId)?.length || 0
    if (hasTemporaryTransforms === 0) {
      this.performTransformationTypeSafe(
        record.target,
        record.currentBase,
        strategy,
        record.effectHandlingStrategy,
        record.currentHpRatio,
      )
    }
    // 如果有临时变身且选择保留，临时变身会覆盖永久变身

    // 记录变身
    this.addTransformationRecord(targetId, record)
  }

  /**
   * 移除变身效果
   */
  removeTransformation(
    target: TransformableEntity,
    transformationId?: string,
    reason: 'mark_destroyed' | 'manual' | 'replaced' = 'manual',
  ): boolean {
    const targetId = target.id
    const transformations = this.transformations.get(targetId)

    console.log(`[Transformation] removeTransformation called for target ${targetId}, reason: ${reason}`)
    console.log(
      `[Transformation] Current transformations:`,
      transformations?.map(t => ({ id: t.id, type: t.transformType, currentBase: t.currentBase.id })),
    )

    if (!transformations) {
      console.log(`[Transformation] No transformations found for target ${targetId}`)
      return false
    }

    let removedRecord: TransformationRecord | undefined

    if (transformationId) {
      // 移除特定变身
      const index = transformations.findIndex(t => t.id === transformationId)
      if (index === -1) {
        console.log(`[Transformation] Specific transformation ${transformationId} not found`)
        return false
      }

      removedRecord = transformations[index]
      transformations.splice(index, 1)
    } else {
      // 移除最新的变身
      removedRecord = transformations.pop()
    }

    if (!removedRecord) {
      console.log(`[Transformation] No record to remove`)
      return false
    }

    console.log(`[Transformation] Removing transformation:`, {
      id: removedRecord.id,
      type: removedRecord.transformType,
      currentBase: removedRecord.currentBase.id,
    })

    // 从相应的栈中移除
    if (removedRecord.transformType === 'temporary') {
      const stack = this.temporaryTransformStack.get(targetId)
      if (stack) {
        const stackIndex = stack.findIndex(t => t.id === removedRecord!.id)
        if (stackIndex !== -1) {
          stack.splice(stackIndex, 1)
        }
      }

      // 重新应用最高优先级的变身
      this.applyTopTransformation(targetId, removedRecord)
    } else {
      // 永久变身被移除
      this.permanentTransforms.delete(targetId)
      this.restoreOriginalBase(target, removedRecord)
    }

    // 注意：不要删除变身记录映射，因为我们需要保留原始base信息用于恢复
    // 只有在确实恢复到原始状态后才清理记录

    // 发送变身结束消息
    // 获取恢复后的真正目标base
    const strategy = this.strategyRegistry.getStrategy(target)
    let toBaseId: string

    if (removedRecord.transformType === 'permanent') {
      // 永久变身被移除，恢复到原始形态
      const originalBase = strategy ? this.getOriginalBaseTypeSafe(target, strategy) : undefined
      toBaseId = originalBase?.id || removedRecord.originalBase.id
    } else {
      // 临时变身被移除，可能恢复到永久变身或原始形态
      const permanentTransform = this.permanentTransforms.get(target.id)
      if (permanentTransform) {
        toBaseId = permanentTransform.currentBase.id
      } else {
        const originalBase = strategy ? this.getOriginalBaseTypeSafe(target, strategy) : undefined
        toBaseId = originalBase?.id || removedRecord.originalBase.id
      }
    }

    this.battle.emitMessage(BattleMessageType.TransformEnd, {
      target: target.id as any,
      targetType: removedRecord.targetType,
      fromBase: removedRecord.currentBase.id as any,
      toBase: toBaseId as any,
      reason,
    })

    return true
  }

  /**
   * 应用栈顶的变身
   */
  private applyTopTransformation(targetId: string, removedRecord?: TransformationRecord): void {
    const stack = this.temporaryTransformStack.get(targetId)
    const target = this.findTargetById(targetId)

    console.log(`[Transformation] applyTopTransformation for ${targetId}`)
    console.log(`[Transformation] Stack length: ${stack?.length || 0}`)

    if (!target || !stack || stack.length === 0) {
      // 没有临时变身，恢复到永久变身或原始状态
      const permanentTransform = this.permanentTransforms.get(targetId)
      console.log(`[Transformation] No temporary transforms, permanent transform exists: ${!!permanentTransform}`)

      if (permanentTransform && target) {
        const strategy = this.strategyRegistry.getStrategy(target)
        if (strategy) {
          console.log(`[Transformation] Applying permanent transform to ${permanentTransform.currentBase.id}`)
          this.performTransformationTypeSafe(
            target,
            permanentTransform.currentBase,
            strategy,
            permanentTransform.effectHandlingStrategy,
            permanentTransform.currentHpRatio,
          )
        }
      } else if (target) {
        console.log(`[Transformation] Restoring original base`)
        this.restoreOriginalBase(target, removedRecord)
      }
      return
    }

    // 应用最高优先级的变身
    const topTransform = stack[0]
    const strategy = this.strategyRegistry.getStrategy(target)
    if (strategy) {
      console.log(`[Transformation] Applying top transform to ${topTransform.currentBase.id}`)
      this.performTransformationTypeSafe(
        target,
        topTransform.currentBase,
        strategy,
        topTransform.effectHandlingStrategy,
        topTransform.currentHpRatio,
      )
    }
  }

  private addTransformationRecord(targetId: string, record: TransformationRecord): void {
    if (!this.transformations.has(targetId)) {
      this.transformations.set(targetId, [])
    }
    this.transformations.get(targetId)!.push(record)
  }

  private clearTemporaryTransformations(targetId: string): void {
    const stack = this.temporaryTransformStack.get(targetId)
    if (stack) {
      stack.length = 0
    }
  }

  private restoreOriginalBase(target: TransformableEntity, removedRecord?: TransformationRecord): void {
    const targetId = target.id
    const transformations = this.transformations.get(targetId)

    console.log(`[Transformation] restoreOriginalBase for ${targetId}`)
    console.log(`[Transformation] Transformations count: ${transformations?.length || 0}`)

    const strategy = this.strategyRegistry.getStrategy(target)
    if (!strategy) return

    // 如果有变身记录，直接使用第一个记录中保存的原始base
    if (transformations && transformations.length > 0) {
      const originalRecord = transformations[0]
      const originalBase = originalRecord.originalBase
      const effectHandlingStrategy = originalRecord.effectHandlingStrategy

      console.log(`[Transformation] Restoring to original base: ${originalBase.id}`)
      this.performTransformationTypeSafe(
        target,
        originalBase,
        strategy,
        effectHandlingStrategy,
        originalRecord.currentHpRatio,
      )

      // 成功恢复到原始状态后，清理所有变身记录
      console.log(`[Transformation] Cleaning up transformation records`)
      this.transformations.delete(targetId)
      this.temporaryTransformStack.delete(targetId)
      this.permanentTransforms.delete(targetId)
    } else if (removedRecord) {
      // 如果没有变身记录但有被移除的记录，使用被移除记录中的原始信息
      const originalBase = removedRecord.originalBase
      const effectHandlingStrategy = removedRecord.effectHandlingStrategy

      console.log(`[Transformation] Restoring to original base using removed record: ${originalBase.id}`)
      this.performTransformationTypeSafe(
        target,
        originalBase,
        strategy,
        effectHandlingStrategy,
        removedRecord.currentHpRatio,
      )

      // 清理所有变身记录
      console.log(`[Transformation] Cleaning up transformation records`)
      this.transformations.delete(targetId)
      this.temporaryTransformStack.delete(targetId)
      this.permanentTransforms.delete(targetId)
    } else {
      // 没有变身记录时，说明没有变身过，不需要恢复
      console.warn('No transformation records found for target:', target.id, 'nothing to restore')
    }
  }

  /**
   * 类型安全的获取原始base方法
   */
  private getOriginalBaseTypeSafe(
    target: TransformableEntity,
    strategy: AnyTransformationStrategy,
  ): TransformablePrototype | undefined {
    if (target instanceof Pet) {
      const petStrategy = strategy as TransformationStrategy<PetEntity, PetPrototype, EntityType.Pet>
      return petStrategy.getOriginalBase(target)
    } else if (target instanceof SkillInstance) {
      const skillStrategy = strategy as TransformationStrategy<SkillEntity, SkillPrototype, EntityType.Skill>
      return skillStrategy.getOriginalBase(target)
    } else if (target instanceof MarkInstanceImpl) {
      const markStrategy = strategy as TransformationStrategy<MarkEntity, MarkPrototype, EntityType.Mark>
      return markStrategy.getOriginalBase(target)
    } else {
      throw new Error(`Unsupported entity type for transformation: ${target.constructor.name}`)
    }
  }

  private findTargetById(targetId: string): TransformableEntity | undefined {
    // 在battle中查找对应的实体
    // 首先尝试在pets中查找
    const pet = this.battle.petMap.get(targetId)
    if (pet) return pet

    // 然后尝试在skills中查找
    const skill = this.battle.skillMap.get(targetId)
    if (skill) return skill

    // 最后在marks中查找
    const allMarks = [
      ...this.battle.marks,
      ...this.battle.playerA.team.flatMap(p => p.marks),
      ...this.battle.playerB.team.flatMap(p => p.marks),
    ]
    const mark = allMarks.find(m => m.id === targetId)
    return mark
  }

  /**
   * 清理与印记相关的变身
   */
  cleanupMarkTransformations(mark: any): void {
    for (const [, transformations] of this.transformations) {
      const toRemove = transformations.filter(t => t.causedBy === mark)

      for (const record of toRemove) {
        this.removeTransformation(record.target, record.id, 'mark_destroyed')
      }
    }
  }

  /**
   * 获取实体的当前变身状态
   */
  getTransformationState(target: TransformableEntity): {
    isTransformed: boolean
    currentTransformations: TransformationRecord[]
    activeTransformation?: TransformationRecord
  } {
    const targetId = target.id
    const transformations = this.transformations.get(targetId) || []
    const stack = this.temporaryTransformStack.get(targetId) || []
    const permanent = this.permanentTransforms.get(targetId)

    const activeTransformation = stack[0] || permanent

    return {
      isTransformed: transformations.length > 0,
      currentTransformations: transformations,
      activeTransformation,
    }
  }
}
