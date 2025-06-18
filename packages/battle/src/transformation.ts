import { BattleMessageType, EffectTrigger } from '@arcadia-eternity/const'
import { nanoid } from 'nanoid'
import { Battle } from './battle'
import { TransformContext } from './context'
import { type Prototype } from './entity'
import {
  PetTransformationStrategy,
  SkillTransformationStrategy,
  MarkTransformationStrategy,
} from './transformationStrategies'

// 抽象变身策略接口
export interface TransformationStrategy<TEntity = any, TPrototype extends Prototype = Prototype> {
  canTransform(entity: any): entity is TEntity
  getEntityType(): 'pet' | 'skill' | 'mark'
  preserveState(entity: TEntity): any
  restoreState(entity: TEntity, state: any): void
  performTransformation(entity: TEntity, newBase: TPrototype, preservedState: any): Promise<void>
  getOriginalBase(entity: TEntity): TPrototype | undefined
}

// 抽象变身接口
export interface Transformable {
  readonly id: string
  base: Prototype
}

export type TransformableEntity = Transformable
export type TransformablePrototype = Prototype

// 变身记录
export interface TransformationRecord {
  id: string
  target: TransformableEntity
  targetType: 'pet' | 'skill' | 'mark'
  originalBase: TransformablePrototype
  currentBase: TransformablePrototype
  transformType: 'temporary' | 'permanent'
  priority: number
  causedBy?: any
  isActive: boolean
  createdAt: number
  preservedState?: any
  permanentStrategy?: 'preserve_temporary' | 'clear_temporary'
}

// 变身策略注册表
export class TransformationStrategyRegistry {
  private strategies = new Map<string, TransformationStrategy>()

  register(entityType: string, strategy: TransformationStrategy): void {
    this.strategies.set(entityType, strategy)
  }

  getStrategy(entity: any): TransformationStrategy | undefined {
    for (const [type, strategy] of this.strategies) {
      if (strategy.canTransform(entity)) {
        return strategy
      }
    }
    return undefined
  }

  getAllStrategies(): TransformationStrategy[] {
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
    this.registerStrategy('pet', new PetTransformationStrategy())
    this.registerStrategy('skill', new SkillTransformationStrategy())
    this.registerStrategy('mark', new MarkTransformationStrategy())
  }

  /**
   * 注册变身策略
   */
  registerStrategy(entityType: string, strategy: TransformationStrategy): void {
    this.strategyRegistry.register(entityType, strategy)
  }

  /**
   * 保留导致变身的效果
   */
  private preserveCausingEffect(target: TransformableEntity, causedBy: any, preservedState: any): void {
    try {
      // 如果变身是由印记引起的，确保该印记在变身后仍然有效
      if (causedBy && typeof causedBy === 'object' && 'id' in causedBy) {
        // 在保留状态中标记这个效果需要特殊保护
        if (!preservedState.protectedEffects) {
          preservedState.protectedEffects = []
        }

        preservedState.protectedEffects.push({
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
   * 应用变身效果
   */
  async applyTransformation(
    target: TransformableEntity,
    newBase: TransformablePrototype,
    transformType: 'temporary' | 'permanent',
    priority: number = 0,
    causedBy?: any,
    permanentStrategy: 'preserve_temporary' | 'clear_temporary' = 'clear_temporary',
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
      target as any, // 临时类型转换，因为TransformContext期望具体类型
      targetType,
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

    // 保存当前状态
    const preservedState = strategy.preserveState(target)

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
      target: target.id as any,
      targetType,
      fromBase: originalBase.id as any,
      toBase: newBase.id as any,
      transformType,
      priority,
      causedBy: causedBy?.id as any,
    })

    return true
  }

  /**
   * 应用临时变身
   */
  private async applyTemporaryTransformation(
    record: TransformationRecord,
    strategy: TransformationStrategy,
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
    strategy: TransformationStrategy,
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
      await strategy.performTransformation(record.target, record.currentBase, record.preservedState)
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
          await strategy.performTransformation(
            target,
            permanentTransform.currentBase,
            permanentTransform.preservedState,
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
      await strategy.performTransformation(target, topTransform.currentBase, topTransform.preservedState)
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
      await strategy.performTransformation(target, originalRecord.originalBase, originalRecord.preservedState)
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
