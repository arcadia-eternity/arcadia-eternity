import { type TransformationStrategy } from './transformation'
import { Pet, type Species } from './pet'
import { SkillInstance, BaseSkill } from './skill'
import { type MarkInstance, MarkInstanceImpl, BaseMark } from './mark'

/**
 * 精灵变身策略
 */
export class PetTransformationStrategy implements TransformationStrategy<Pet, Species> {
  canTransform(entity: any): entity is Pet {
    return entity instanceof Pet
  }

  getEntityType(): 'pet' {
    return 'pet'
  }

  preserveState(entity: Pet): any {
    const maxHp = entity.stat.maxHp
    return {
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
    }
  }

  private preservePassiveEffects(entity: Pet): any {
    // 保存所有来自印记和技能的被动效果
    const passiveEffects: any = {
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

  private preserveAttributeModifiers(entity: Pet): any {
    // 获取当前所有属性的修改器
    const modifiers: any = {}
    const attributeSystem = entity.attributeSystem

    // 保存所有当前的修改器
    // 注意：这里我们需要保存修改器的状态，而不是修改器本身
    // 因为修改器可能包含对其他对象的引用
    try {
      // 获取所有属性的当前值和基础值的差异
      const currentStats = entity.stat
      const baseStats = entity.calculateStats()

      modifiers.statDifferences = {
        atk: currentStats.atk - baseStats.atk,
        def: currentStats.def - baseStats.def,
        spa: currentStats.spa - baseStats.spa,
        spd: currentStats.spd - baseStats.spd,
        spe: currentStats.spe - baseStats.spe,
        maxHp: currentStats.maxHp - baseStats.maxHp,
        critRate: currentStats.critRate - entity.baseCritRate,
        accuracy: currentStats.accuracy - entity.baseAccuracy,
        evasion: currentStats.evasion - 0,
      }
    } catch (error) {
      console.warn('Failed to preserve attribute modifiers:', error)
      modifiers.statDifferences = {}
    }

    return modifiers
  }

  restoreState(entity: Pet, state: any): void {
    if (!state) return

    if (state.currentHpRatio !== undefined) {
      const maxHp = entity.stat.maxHp
      entity.currentHp = Math.floor(maxHp * state.currentHpRatio)
    }
    if (state.marks) {
      // 保留原有的印记（变身不应该清除印记）
      entity.marks = state.marks
    }
    if (state.appeared !== undefined) {
      entity.appeared = state.appeared
    }
    if (state.lastSkill !== undefined) {
      entity.lastSkill = state.lastSkill
    }
    if (state.lastSkillUsedTimes !== undefined) {
      entity.lastSkillUsedTimes = state.lastSkillUsedTimes
    }
    if (state.isAlive !== undefined) {
      entity.isAlive = state.isAlive
    }

    // 恢复属性修改器状态
    if (state.attributeModifiers) {
      this.restoreAttributeModifiers(entity, state.attributeModifiers)
    }

    // 恢复被动效果状态
    if (state.passiveEffects) {
      this.restorePassiveEffects(entity, state.passiveEffects)
    }

    // 处理受保护的效果
    if (state.protectedEffects) {
      this.handleProtectedEffects(entity, state.protectedEffects)
    }
  }

  private restoreAttributeModifiers(entity: Pet, modifiers: any): void {
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

  private restorePassiveEffects(entity: Pet, passiveEffects: any): void {
    if (!passiveEffects) return

    try {
      // 恢复印记的被动效果
      if (passiveEffects.markEffects) {
        passiveEffects.markEffects.forEach((markEffect: any) => {
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
        passiveEffects.skillEffects.forEach((skillEffect: any) => {
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

  async performTransformation(entity: Pet, newBase: Species, preservedState: any): Promise<void> {
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

    // 保持当前HP比例
    const currentHpRatio = preservedState?.currentHpRatio || 1
    const newCurrentHp = Math.floor(newStats.maxHp * currentHpRatio)
    entity.attributeSystem.setCurrentHp(newCurrentHp)

    // 恢复保留的状态
    this.restoreState(entity, preservedState)
  }

  getOriginalBase(entity: Pet): Species | undefined {
    return entity.species
  }
}

/**
 * 技能变身策略
 */
export class SkillTransformationStrategy implements TransformationStrategy<SkillInstance, BaseSkill> {
  canTransform(entity: any): entity is SkillInstance {
    return entity instanceof SkillInstance
  }

  getEntityType(): 'skill' {
    return 'skill'
  }

  preserveState(entity: SkillInstance): any {
    return {
      appeared: entity.appeared,
      owner: entity.owner,
    }
  }

  restoreState(entity: SkillInstance, state: any): void {
    if (!state) return

    if (state.appeared !== undefined) {
      entity.appeared = state.appeared
    }
    if (state.owner !== undefined) {
      entity.owner = state.owner
    }
  }

  async performTransformation(entity: SkillInstance, newBase: BaseSkill, preservedState: any): Promise<void> {
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
    ;(entity as any).effects = [...newBase.effects]

    // 更新属性系统
    entity.attributeSystem.initializeSkillAttributes(entity.power, entity.accuracy, entity.rage, entity.priority, false)

    // 恢复保留的状态
    this.restoreState(entity, preservedState)
  }

  getOriginalBase(entity: SkillInstance): BaseSkill | undefined {
    return entity.base
  }
}

/**
 * 印记变身策略
 */
export class MarkTransformationStrategy implements TransformationStrategy<MarkInstanceImpl, BaseMark> {
  canTransform(entity: any): entity is MarkInstanceImpl {
    return entity instanceof MarkInstanceImpl
  }

  getEntityType(): 'mark' {
    return 'mark'
  }

  preserveState(entity: MarkInstanceImpl): any {
    return {
      stack: entity.stack,
      duration: entity.duration,
      isActive: entity.isActive,
      owner: entity.owner,
    }
  }

  restoreState(entity: MarkInstanceImpl, state: any): void {
    if (!state) return

    if (state.stack !== undefined) {
      entity.stack = state.stack
    }
    if (state.duration !== undefined) {
      entity.duration = state.duration
    }
    if (state.isActive !== undefined) {
      entity.isActive = state.isActive
    }
    if (state.owner !== undefined) {
      entity.owner = state.owner
    }
  }

  async performTransformation(entity: MarkInstanceImpl, newBase: BaseMark, preservedState: any): Promise<void> {
    // 更新base引用
    ;(entity as any).base = newBase

    // 更新印记属性
    entity.config = { ...newBase.config }
    ;(entity as any).tags = [...newBase.tags]
    ;(entity as any).effects = [...newBase.effects]

    // 恢复保留的状态
    this.restoreState(entity, preservedState)
  }

  getOriginalBase(entity: MarkInstanceImpl): BaseMark | undefined {
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
