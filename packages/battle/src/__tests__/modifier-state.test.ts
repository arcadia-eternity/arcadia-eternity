import { test } from '@japa/runner'
import { AttributeSystem, Modifier, DurationType, ModifierHelpers } from '../attributeSystem'
import type { EntityModifierState, AttributeModifierInfo } from '@arcadia-eternity/const'

interface TestAttributeSet {
  atk: number
  def: number
  hp: number
}

test.group('Modifier State Information', group => {
  let attributeSystem: AttributeSystem<TestAttributeSet>

  group.each.setup(() => {
    attributeSystem = new AttributeSystem<TestAttributeSet>('test-system')

    // 注册基础属性
    attributeSystem.registerBaseAttribute('atk', 100)
    attributeSystem.registerBaseAttribute('def', 80)
    attributeSystem.registerBaseAttribute('hp', 300)
  })

  group.each.teardown(() => {
    attributeSystem.destroy()
  })

  test('should return empty modifier state when no modifiers are applied', ({ expect }) => {
    const modifierState = attributeSystem.getDetailedModifierState()

    expect(modifierState.hasModifiers).toBe(false)
    expect(modifierState.attributes).toHaveLength(3)

    const atkAttribute = modifierState.attributes.find(attr => attr.attributeName === 'atk')
    expect(atkAttribute).toBeDefined()
    expect(atkAttribute!.baseValue).toBe(100)
    expect(atkAttribute!.currentValue).toBe(100)
    expect(atkAttribute!.isModified).toBe(false)
    expect(atkAttribute!.modifiers).toHaveLength(0)
  })

  test('should return modifier state with applied modifiers', ({ expect }) => {
    // 添加一些修改器
    const deltaModifier = new Modifier(DurationType.binding, 'test-delta', 20, 'delta', 0)
    const percentModifier = new Modifier(DurationType.binding, 'test-percent', 50, 'percent', 1)

    attributeSystem.addModifier('atk', deltaModifier)
    attributeSystem.addModifier('atk', percentModifier)

    const modifierState = attributeSystem.getDetailedModifierState()

    expect(modifierState.hasModifiers).toBe(true)

    const atkAttribute = modifierState.attributes.find(attr => attr.attributeName === 'atk')
    expect(atkAttribute).toBeDefined()
    expect(atkAttribute!.baseValue).toBe(100)
    expect(atkAttribute!.currentValue).toBe(170) // 100 * 1.5 + 20 = 150 + 20 = 170
    expect(atkAttribute!.isModified).toBe(true)
    expect(atkAttribute!.modifiers).toHaveLength(2)

    // 检查修改器信息
    const modifiers = atkAttribute!.modifiers
    expect(modifiers[0].id).toBe('test-percent') // 高优先级的先应用
    expect(modifiers[0].type).toBe('percent')
    expect(modifiers[0].value).toBe(50)
    expect(modifiers[0].priority).toBe(1)
    expect(modifiers[0].sourceType).toBe('other')

    expect(modifiers[1].id).toBe('test-delta')
    expect(modifiers[1].type).toBe('delta')
    expect(modifiers[1].value).toBe(20)
    expect(modifiers[1].priority).toBe(0)
  })

  test('should include source information when modifiers have sources', ({ expect }) => {
    // 创建一个模拟的 mark source
    const mockMarkSource = {
      id: 'mark-123',
      baseId: 'strength-boost',
      base: { name: 'Strength Boost' },
    } as any

    const modifierWithSource = new Modifier(DurationType.binding, 'test-with-source', 30, 'delta', 0, mockMarkSource)

    attributeSystem.addModifier('atk', modifierWithSource)

    const modifierState = attributeSystem.getDetailedModifierState()
    const atkAttribute = modifierState.attributes.find(attr => attr.attributeName === 'atk')

    expect(atkAttribute!.modifiers).toHaveLength(1)
    const modifier = atkAttribute!.modifiers[0]

    expect(modifier.sourceType).toBe('mark')
    expect(modifier.sourceId).toBe('mark-123')
    expect(modifier.sourceName).toBe('Strength Boost')
  })

  test('should handle clamp modifiers correctly', ({ expect }) => {
    const clampMaxModifier = ModifierHelpers.createClampMax('test-clamp-max', 90, 0)

    attributeSystem.addModifier('atk', clampMaxModifier)

    const modifierState = attributeSystem.getDetailedModifierState()
    const atkAttribute = modifierState.attributes.find(attr => attr.attributeName === 'atk')

    expect(atkAttribute!.baseValue).toBe(100)
    expect(atkAttribute!.currentValue).toBe(90) // 被限制到最大值 90
    expect(atkAttribute!.isModified).toBe(true)
    expect(atkAttribute!.modifiers[0].type).toBe('clampMax')
  })
})
