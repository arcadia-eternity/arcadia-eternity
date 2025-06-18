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

// 强类型的变身策略接口
export interface TransformationStrategy<
  TEntity extends Transformable,
  TPrototype extends Prototype,
  TEntityType extends EntityType,
> {
  canTransform(entity: unknown): entity is TEntity
  getEntityType(): TEntityType
  preserveState(entity: TEntity): TransformationState<TEntity>
  restoreState(entity: TEntity, state: TransformationState<TEntity>): void
  performTransformation(
    entity: TEntity,
    newBase: TPrototype,
    preservedState: TransformationState<TEntity>,
    effectHandlingStrategy: EffectHandlingStrategy,
  ): Promise<void>
  getOriginalBase(entity: TEntity): TPrototype | undefined
}

// 属性修改器状态类型
export interface AttributeModifiersState {
  statDifferences: {
    atk: number
    def: number
    spa: number
    spd: number
    spe: number
    maxHp: number
    critRate: number
    accuracy: number
    evasion: number
  }
}

// 被动效果状态类型
export interface PassiveEffectsState {
  markEffects: Array<{
    markId: string
    effects: Array<{
      trigger: EffectTrigger
      effectData: {
        id: string
        trigger: EffectTrigger
        metadata: Record<string, unknown>
      }
    }>
  }>
  skillEffects: any[]
}

// 变身状态数据类型定义
export interface PetTransformationData {
  currentHpRatio: number
  marks: MarkInstance[]
  appeared: boolean
  lastSkill?: SkillInstance
  lastSkillUsedTimes: number
  isAlive: boolean
  attributeModifiers: AttributeModifiersState
  passiveEffects: PassiveEffectsState
}

export interface SkillTransformationData {
  appeared: boolean
  owner: Pet | null
}

export interface MarkTransformationData {
  stack: number
  duration: number
  isActive: boolean
  owner: Pet | Battle | null
}

// 变身状态类型映射
export interface TransformationDataMap {
  [EntityType.Pet]: PetTransformationData
  [EntityType.Skill]: SkillTransformationData
  [EntityType.Mark]: MarkTransformationData
}

// 变身状态类型
export interface TransformationState<TEntity extends Transformable> {
  readonly entityId: string
  readonly entityType: EntityType
  readonly timestamp: number
  readonly data: TEntity extends PetEntity
    ? PetTransformationData
    : TEntity extends SkillEntity
      ? SkillTransformationData
      : TEntity extends MarkEntity
        ? MarkTransformationData
        : Record<string, unknown>
  readonly protectedEffects?: Array<{
    sourceId: string
    sourceType: string
    reason: string
  }>
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

// 变身记录类型
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
  readonly preservedState: TransformationState<TEntity>
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
    for (const [type, strategy] of this.strategies) {
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
   * 保留导致变身的效果
   */
  private preserveCausingEffect<TEntity extends TransformableEntity>(
    target: TEntity,
    causedBy: MarkInstance | SkillInstance | Effect<EffectTrigger>,
    preservedState: TransformationState<TEntity>,
  ): void {
    try {
      // 如果变身是由印记引起的，确保该印记在变身后仍然有效
      if (causedBy && typeof causedBy === 'object' && 'id' in causedBy) {
        // 在保留状态中标记这个效果需要特殊保护
        if (!preservedState.protectedEffects) {
          ;(preservedState as any).protectedEffects = []
        }

        preservedState.protectedEffects!.push({
          sourceId: causedBy.id,
          sourceType: this.getSourceType(causedBy),
          reason: 'transformation_cause',
        })

        console.log('Preserving causing effect:', causedBy.id)
      }
    } catch (error) {
      console.warn('Failed to preserve causing effect:', error)
    }
  }

  /**
   * 获取效果源的类型
   */
  private getSourceType(source: any): string {
    if (source.constructor.name.includes('Mark')) return 'mark'
    if (source.constructor.name.includes('Skill')) return 'skill'
    if (source.constructor.name.includes('Effect')) return 'effect'
    return 'unknown'
  }

  /**
   * 应用变身效果 - 类型安全的重载方法
   */
  async applyTransformation<T extends EntityType>(
    target: EntityTypeMap[T]['entity'],
    newBase: EntityTypeMap[T]['prototype'],
    transformType: 'temporary' | 'permanent',
    priority?: number,
    causedBy?: MarkInstance | SkillInstance | Effect<EffectTrigger>,
    permanentStrategy?: 'preserve_temporary' | 'clear_temporary',
    effectHandlingStrategy?: EffectHandlingStrategy,
  ): Promise<boolean>

  /**
   * 应用变身效果 - 通用方法
   */
  async applyTransformation(
    target: TransformableEntity,
    newBase: TransformablePrototype,
    transformType: 'temporary' | 'permanent',
    priority?: number,
    causedBy?: MarkInstance | SkillInstance | Effect<EffectTrigger>,
    permanentStrategy?: 'preserve_temporary' | 'clear_temporary',
    effectHandlingStrategy?: EffectHandlingStrategy,
  ): Promise<boolean>

  async applyTransformation(
    target: TransformableEntity,
    newBase: TransformablePrototype,
    transformType: 'temporary' | 'permanent',
    priority: number = 0,
    causedBy?: MarkInstance | SkillInstance | Effect<EffectTrigger>,
    permanentStrategy: 'preserve_temporary' | 'clear_temporary' = 'clear_temporary',
    effectHandlingStrategy: EffectHandlingStrategy = EffectHandlingStrategy.Preserve,
  ): Promise<boolean> {
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
  private async applyTransformationInternal(
    target: TransformableEntity,
    newBase: TransformablePrototype,
    transformType: 'temporary' | 'permanent',
    priority: number,
    causedBy?: MarkInstance | SkillInstance | Effect<EffectTrigger>,
    permanentStrategy: 'preserve_temporary' | 'clear_temporary' = 'clear_temporary',
    effectHandlingStrategy: EffectHandlingStrategy = EffectHandlingStrategy.Preserve,
  ): Promise<boolean> {
    // 获取适合的变身策略
    const strategy = this.strategyRegistry.getStrategy(target)
    if (!strategy) {
      console.warn('No transformation strategy found for target:', target)
      return false
    }

    const targetType = strategy.getEntityType()
    const originalBase = target.base

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

    // 使用类型安全的方式保存状态
    const preservedState = this.preserveStateTypeSafe(target, strategy)

    // 如果变身是由被动效果引起的，确保该效果在变身后仍然有效
    if (causedBy) {
      this.preserveCausingEffect(target, causedBy, preservedState)
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
      preservedState,
      permanentStrategy: transformType === 'permanent' ? permanentStrategy : undefined,
      effectHandlingStrategy,
    }

    if (transformType === 'temporary') {
      await this.applyTemporaryTransformation(record, strategy)
    } else {
      await this.applyPermanentTransformation(record, strategy)
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
   * 类型安全的状态保存方法
   */
  private preserveStateTypeSafe(
    target: TransformableEntity,
    strategy: AnyTransformationStrategy,
  ): TransformationState<TransformableEntity> {
    if (target instanceof Pet) {
      const petStrategy = strategy as TransformationStrategy<PetEntity, PetPrototype, EntityType.Pet>
      return petStrategy.preserveState(target)
    } else if (target instanceof SkillInstance) {
      const skillStrategy = strategy as TransformationStrategy<SkillEntity, SkillPrototype, EntityType.Skill>
      return skillStrategy.preserveState(target)
    } else if (target instanceof MarkInstanceImpl) {
      const markStrategy = strategy as TransformationStrategy<MarkEntity, MarkPrototype, EntityType.Mark>
      return markStrategy.preserveState(target)
    } else {
      throw new Error(`Unsupported entity type for transformation: ${target.constructor.name}`)
    }
  }

  /**
   * 类型安全的变身执行方法
   */
  private async performTransformationTypeSafe(
    target: TransformableEntity,
    newBase: TransformablePrototype,
    preservedState: TransformationState<TransformableEntity>,
    strategy: AnyTransformationStrategy,
    effectHandlingStrategy: EffectHandlingStrategy,
  ): Promise<void> {
    if (target instanceof Pet) {
      const petStrategy = strategy as TransformationStrategy<PetEntity, PetPrototype, EntityType.Pet>
      await petStrategy.performTransformation(
        target,
        newBase as PetPrototype,
        preservedState as TransformationState<PetEntity>,
        effectHandlingStrategy,
      )
    } else if (target instanceof SkillInstance) {
      const skillStrategy = strategy as TransformationStrategy<SkillEntity, SkillPrototype, EntityType.Skill>
      await skillStrategy.performTransformation(
        target,
        newBase as SkillPrototype,
        preservedState as TransformationState<SkillEntity>,
        effectHandlingStrategy,
      )
    } else if (target instanceof MarkInstanceImpl) {
      const markStrategy = strategy as TransformationStrategy<MarkEntity, MarkPrototype, EntityType.Mark>
      await markStrategy.performTransformation(
        target,
        newBase as MarkPrototype,
        preservedState as TransformationState<MarkEntity>,
        effectHandlingStrategy,
      )
    } else {
      throw new Error(`Unsupported entity type for transformation: ${target.constructor.name}`)
    }
  }

  /**
   * 应用临时变身
   */
  private async applyTemporaryTransformation(
    record: TransformationRecord,
    strategy: AnyTransformationStrategy,
  ): Promise<void> {
    const targetId = record.target.id

    // 获取或创建变身栈
    if (!this.temporaryTransformStack.has(targetId)) {
      this.temporaryTransformStack.set(targetId, [])
    }

    const stack = this.temporaryTransformStack.get(targetId)!

    // 按优先级插入到正确位置
    const insertIndex = stack.findIndex(t => t.priority < record.priority)
    if (insertIndex === -1) {
      stack.push(record)
    } else {
      stack.splice(insertIndex, 0, record)
    }

    // 应用最高优先级的变身
    await this.applyTopTransformation(targetId)

    // 记录变身
    this.addTransformationRecord(targetId, record)
  }

  /**
   * 应用永久变身
   */
  private async applyPermanentTransformation(
    record: TransformationRecord,
    strategy: AnyTransformationStrategy,
  ): Promise<void> {
    const targetId = record.target.id

    // 根据策略决定是否清理临时变身
    if (record.permanentStrategy === 'clear_temporary') {
      // 默认策略：清理所有临时变身
      await this.clearTemporaryTransformations(targetId)
    }
    // 如果是 'preserve_temporary' 策略，则保留临时变身

    // 应用永久变身
    this.permanentTransforms.set(targetId, record)

    // 如果没有临时变身或者清理了临时变身，直接应用永久变身
    const hasTemporaryTransforms = this.temporaryTransformStack.get(targetId)?.length || 0
    if (hasTemporaryTransforms === 0) {
      await this.performTransformationTypeSafe(
        record.target,
        record.currentBase,
        record.preservedState,
        strategy,
        record.effectHandlingStrategy,
      )
    }
    // 如果有临时变身且选择保留，临时变身会覆盖永久变身

    // 记录变身
    this.addTransformationRecord(targetId, record)
  }

  /**
   * 移除变身效果
   */
  async removeTransformation(
    target: TransformableEntity,
    transformationId?: string,
    reason: 'mark_destroyed' | 'manual' | 'replaced' = 'manual',
  ): Promise<boolean> {
    const targetId = target.id
    const transformations = this.transformations.get(targetId)

    if (!transformations) return false

    let removedRecord: TransformationRecord | undefined

    if (transformationId) {
      // 移除特定变身
      const index = transformations.findIndex(t => t.id === transformationId)
      if (index === -1) return false

      removedRecord = transformations[index]
      transformations.splice(index, 1)
    } else {
      // 移除最新的变身
      removedRecord = transformations.pop()
    }

    if (!removedRecord) return false

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
      await this.applyTopTransformation(targetId)
    } else {
      // 永久变身被移除
      this.permanentTransforms.delete(targetId)
      await this.restoreOriginalBase(target)
    }

    // 发送变身结束消息
    this.battle.emitMessage(BattleMessageType.TransformEnd, {
      target: target.id as any,
      targetType: removedRecord.targetType,
      fromBase: removedRecord.currentBase.id as any,
      toBase: removedRecord.originalBase.id as any,
      reason,
    })

    return true
  }

  /**
   * 应用栈顶的变身
   */
  private async applyTopTransformation(targetId: string): Promise<void> {
    const stack = this.temporaryTransformStack.get(targetId)
    const target = this.findTargetById(targetId)

    if (!target || !stack || stack.length === 0) {
      // 没有临时变身，恢复到永久变身或原始状态
      const permanentTransform = this.permanentTransforms.get(targetId)
      if (permanentTransform && target) {
        const strategy = this.strategyRegistry.getStrategy(target)
        if (strategy) {
          await this.performTransformationTypeSafe(
            target,
            permanentTransform.currentBase,
            permanentTransform.preservedState,
            strategy,
            permanentTransform.effectHandlingStrategy,
          )
        }
      } else if (target) {
        await this.restoreOriginalBase(target)
      }
      return
    }

    // 应用最高优先级的变身
    const topTransform = stack[0]
    const strategy = this.strategyRegistry.getStrategy(target)
    if (strategy) {
      await this.performTransformationTypeSafe(
        target,
        topTransform.currentBase,
        topTransform.preservedState,
        strategy,
        topTransform.effectHandlingStrategy,
      )
    }
  }

  private addTransformationRecord(targetId: string, record: TransformationRecord): void {
    if (!this.transformations.has(targetId)) {
      this.transformations.set(targetId, [])
    }
    this.transformations.get(targetId)!.push(record)
  }

  private async clearTemporaryTransformations(targetId: string): Promise<void> {
    const stack = this.temporaryTransformStack.get(targetId)
    if (stack) {
      stack.length = 0
    }
  }

  private async restoreOriginalBase(target: TransformableEntity): Promise<void> {
    const targetId = target.id
    const transformations = this.transformations.get(targetId)

    if (!transformations || transformations.length === 0) return

    const originalRecord = transformations[0]
    const strategy = this.strategyRegistry.getStrategy(target)
    if (strategy) {
      await this.performTransformationTypeSafe(
        target,
        originalRecord.originalBase,
        originalRecord.preservedState,
        strategy,
        originalRecord.effectHandlingStrategy,
      )
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
