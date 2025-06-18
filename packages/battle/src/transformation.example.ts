/**
 * 变身系统使用示例
 * 
 * 这个文件展示了如何使用新的变身系统来实现各种变身效果
 */

import { TransformationSystem } from './transformation'
import { PetTransformationStrategy, SkillTransformationStrategy, MarkTransformationStrategy } from './transformationStrategies'
import { Battle } from './battle'
import { Pet } from './pet'
import { SkillInstance } from './skill'
import { MarkInstanceImpl } from './mark'

// 示例：基本变身系统设置
export function setupTransformationSystem(battle: Battle): TransformationSystem {
  const transformationSystem = new TransformationSystem(battle)
  
  // 注册默认的变身策略
  transformationSystem.registerStrategy('pet', new PetTransformationStrategy())
  transformationSystem.registerStrategy('skill', new SkillTransformationStrategy())
  transformationSystem.registerStrategy('mark', new MarkTransformationStrategy())
  
  return transformationSystem
}

// 示例：精灵临时变身
export async function exampleTemporaryPetTransformation(
  transformationSystem: TransformationSystem,
  pet: Pet,
  newSpecies: any,
  causedByMark?: MarkInstanceImpl
) {
  // 应用临时变身，优先级为5
  const success = await transformationSystem.applyTransformation(
    pet,
    newSpecies,
    'temporary',
    5,
    causedByMark // 如果是印记引起的变身，传入印记实例
  )
  
  if (success) {
    console.log(`${pet.id} 临时变身为 ${newSpecies.id}`)
    
    // 获取变身状态
    const state = transformationSystem.getTransformationState(pet)
    console.log('变身状态:', state)
  }
  
  return success
}

// 示例：精灵永久变身
export async function examplePermanentPetTransformation(
  transformationSystem: TransformationSystem,
  pet: Pet,
  newSpecies: any,
  strategy: 'preserve_temporary' | 'clear_temporary' = 'clear_temporary'
) {
  // 应用永久变身
  const success = await transformationSystem.applyTransformation(
    pet,
    newSpecies,
    'permanent',
    0, // 永久变身通常优先级为0
    undefined, // 没有特定的引起者
    strategy
  )
  
  if (success) {
    console.log(`${pet.id} 永久变身为 ${newSpecies.id}，策略: ${strategy}`)
  }
  
  return success
}

// 示例：技能变身
export async function exampleSkillTransformation(
  transformationSystem: TransformationSystem,
  skill: SkillInstance,
  newBaseSkill: any,
  priority: number = 1
) {
  const success = await transformationSystem.applyTransformation(
    skill,
    newBaseSkill,
    'temporary',
    priority
  )
  
  if (success) {
    console.log(`技能 ${skill.id} 变身为 ${newBaseSkill.id}`)
  }
  
  return success
}

// 示例：印记变身
export async function exampleMarkTransformation(
  transformationSystem: TransformationSystem,
  mark: MarkInstanceImpl,
  newBaseMark: any
) {
  const success = await transformationSystem.applyTransformation(
    mark,
    newBaseMark,
    'temporary',
    1
  )
  
  if (success) {
    console.log(`印记 ${mark.id} 变身为 ${newBaseMark.id}`)
  }
  
  return success
}

// 示例：优先级系统
export async function examplePrioritySystem(
  transformationSystem: TransformationSystem,
  pet: Pet
) {
  const species1 = { id: 'species1', element: 'fire' }
  const species2 = { id: 'species2', element: 'water' }
  const species3 = { id: 'species3', element: 'grass' }
  
  // 应用不同优先级的变身
  await transformationSystem.applyTransformation(pet, species1, 'temporary', 1)
  await transformationSystem.applyTransformation(pet, species2, 'temporary', 5) // 高优先级
  await transformationSystem.applyTransformation(pet, species3, 'temporary', 3)
  
  // 最高优先级的变身会生效
  const state = transformationSystem.getTransformationState(pet)
  console.log('当前活跃变身:', state.activeTransformation?.currentBase.id) // 应该是 species2
  console.log('优先级:', state.activeTransformation?.priority) // 应该是 5
}

// 示例：变身移除
export async function exampleTransformationRemoval(
  transformationSystem: TransformationSystem,
  pet: Pet
) {
  // 移除最新的变身
  const success = await transformationSystem.removeTransformation(pet)
  
  if (success) {
    console.log('变身已移除')
    
    // 检查是否还有其他变身
    const state = transformationSystem.getTransformationState(pet)
    if (state.isTransformed) {
      console.log('恢复到上一个变身:', state.activeTransformation?.currentBase.id)
    } else {
      console.log('恢复到原始形态')
    }
  }
}

// 示例：印记生命周期管理
export async function exampleMarkLifecycleManagement(
  transformationSystem: TransformationSystem,
  pet: Pet,
  mark: MarkInstanceImpl
) {
  const newSpecies = { id: 'transformedSpecies', element: 'electric' }
  
  // 应用由印记引起的变身
  await transformationSystem.applyTransformation(
    pet,
    newSpecies,
    'temporary',
    1,
    mark // 变身由这个印记引起
  )
  
  console.log('印记引起的变身已应用')
  
  // 当印记被销毁时，相关的变身会自动清理
  // 这通常在印记的 destroy 方法中调用
  transformationSystem.cleanupMarkTransformations(mark)
  
  console.log('印记销毁，相关变身已清理')
}

// 示例：复杂变身场景
export async function exampleComplexTransformationScenario(
  transformationSystem: TransformationSystem,
  pet: Pet
) {
  const fireForm = { id: 'fireForm', element: 'fire' }
  const waterForm = { id: 'waterForm', element: 'water' }
  const ultimateForm = { id: 'ultimateForm', element: 'dragon' }
  
  // 1. 应用基础火形态（临时）
  await transformationSystem.applyTransformation(pet, fireForm, 'temporary', 1)
  console.log('阶段1: 火形态')
  
  // 2. 应用水形态（更高优先级）
  await transformationSystem.applyTransformation(pet, waterForm, 'temporary', 3)
  console.log('阶段2: 水形态（覆盖火形态）')
  
  // 3. 应用终极形态（永久，清理临时变身）
  await transformationSystem.applyTransformation(
    pet,
    ultimateForm,
    'permanent',
    0,
    undefined,
    'clear_temporary'
  )
  console.log('阶段3: 终极形态（永久）')
  
  // 4. 再次应用临时变身（会覆盖永久变身）
  await transformationSystem.applyTransformation(pet, fireForm, 'temporary', 2)
  console.log('阶段4: 临时火形态（覆盖永久形态）')
  
  // 5. 移除临时变身，恢复到永久形态
  await transformationSystem.removeTransformation(pet)
  console.log('阶段5: 恢复到终极形态')
  
  const finalState = transformationSystem.getTransformationState(pet)
  console.log('最终状态:', finalState.activeTransformation?.currentBase.id)
}

// 示例：自定义变身策略
export class CustomPetTransformationStrategy extends PetTransformationStrategy {
  async performTransformation(entity: Pet, newBase: any, preservedState: any): Promise<void> {
    // 调用父类的变身逻辑
    await super.performTransformation(entity, newBase, preservedState)
    
    // 添加自定义逻辑
    console.log(`自定义变身逻辑: ${entity.id} -> ${newBase.id}`)
    
    // 例如：变身时触发特殊效果
    if (newBase.element === 'dragon') {
      console.log('龙系变身触发特殊效果！')
      // 这里可以添加特殊的属性加成或效果
    }
  }
}

// 示例：注册自定义策略
export function setupCustomTransformationSystem(battle: Battle): TransformationSystem {
  const transformationSystem = new TransformationSystem(battle)
  
  // 使用自定义的精灵变身策略
  transformationSystem.registerStrategy('pet', new CustomPetTransformationStrategy())
  transformationSystem.registerStrategy('skill', new SkillTransformationStrategy())
  transformationSystem.registerStrategy('mark', new MarkTransformationStrategy())
  
  return transformationSystem
}

// 示例：在效果中使用变身
export function exampleTransformationInEffect() {
  // 这个示例展示如何在 effectBuilder 中使用变身操作符
  
  /*
  // 在实际的效果定义中，你可以这样使用：
  
  import { effectBuilder } from '@arcadia-eternity/effectBuilder'
  
  const transformationEffect = effectBuilder()
    .target(selector.self()) // 选择自己
    .do(
      operator.transformWithPreservation(
        value.constant(newSpeciesData), // 新的物种数据
        'temporary', // 临时变身
        value.constant(5), // 优先级
        'clear_temporary' // 永久变身策略
      )
    )
    .build()
  
  // 或者使用普通的变身操作符
  const simpleTransformEffect = effectBuilder()
    .target(selector.self())
    .do(
      operator.transform(
        value.constant(newSpeciesData),
        'temporary',
        value.constant(1)
      )
    )
    .build()
  
  // 移除变身的效果
  const removeTransformEffect = effectBuilder()
    .target(selector.self())
    .do(operator.removeTransformation())
    .build()
  */
}

export {
  // 导出主要的类和接口供外部使用
  TransformationSystem,
  PetTransformationStrategy,
  SkillTransformationStrategy,
  MarkTransformationStrategy,
}
