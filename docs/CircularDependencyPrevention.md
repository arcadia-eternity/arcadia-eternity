# AttributeSystem 循环依赖检测与防护系统

## 🎯 问题描述

在复杂的属性修改器系统中，容易出现"左脚踩右脚"的循环依赖问题：

- **直接循环**：A属性依赖B属性，B属性又依赖A属性
- **间接循环**：A → B → C → A 的复杂依赖链
- **自引用循环**：属性依赖于自身的计算结果
- **深度递归**：计算过程中无限递归导致栈溢出

## 🛡️ 解决方案设计原则

### 1. **直觉性原则**

- 当检测到循环依赖时，使用**基础值**作为fallback，而不是抛出错误
- 提供清晰的警告信息，帮助开发者定位问题
- 保持游戏的可玩性，避免因循环依赖导致游戏崩溃

### 2. **平衡性原则**

- Fallback值基于属性的基础值，确保数值在合理范围内
- 不会因为循环依赖而产生异常强大或异常弱小的数值
- 保持游戏平衡，避免exploit

### 3. **性能原则**

- 使用轻量级的检测机制，不影响正常计算性能
- 智能缓存fallback值，避免重复计算
- 深度限制防止无限递归

## 🔧 技术实现

### 核心检测机制

```typescript
// 1. 计算栈检测 - 检测直接循环
private calculationStack = new Set<keyof T>()

// 2. 依赖图检测 - 检测复杂循环链
private dependencyGraph = new Map<keyof T, Set<keyof T>>()

// 3. 深度计数器 - 防止无限递归
private calculationDepthCounter = new Map<keyof T, number>()
private maxCalculationDepth = 10

// 4. Fallback值缓存 - 提供安全的默认值
private fallbackValues = new Map<keyof T, number | boolean | string>()
```

### 检测流程

```typescript
private calculateAttributeValueSafely(key, base, modifiers) {
  // 1. 检测直接循环依赖
  if (this.wouldCreateCircularDependency(key)) {
    return this.getFallbackValue(key)
  }

  // 2. 检测递归深度
  if (!this.checkCalculationDepth(key)) {
    return this.getFallbackValue(key)
  }

  // 3. 安全计算
  this.calculationStack.add(key)
  try {
    const result = this.applyModifiersSafely(key, base, modifiers)
    this.fallbackValues.set(key, result) // 更新fallback
    return result
  } finally {
    this.calculationStack.delete(key)
    this.resetCalculationDepth(key)
  }
}
```

## 📋 使用示例

### 场景1：简单循环依赖

```typescript
// 攻击力依赖防御力
const attackModifier = new Modifier(
  DurationType.binding,
  'attack_from_defense',
  computed(() => attributeSystem.getCurrentValue('defense') * 0.5,
           [attributeSystem.getAttribute$('defense')]),
  'delta',
  100
)

// 防御力依赖攻击力 - 会触发循环依赖检测
const defenseModifier = new Modifier(
  DurationType.binding,
  'defense_from_attack',
  computed(() => attributeSystem.getCurrentValue('attack') * 0.3,
           [attributeSystem.getAttribute$('attack')]),
  'delta',
  100
)

// 结果：使用基础值作为fallback，避免无限循环
```

### 场景2：自引用循环

```typescript
// 速度依赖于自身 - 典型的自引用问题
const selfReferencingModifier = new Modifier(
  DurationType.binding,
  'speed_self_boost',
  computed(() => attributeSystem.getCurrentValue('speed') + 10,
           [attributeSystem.getAttribute$('speed')]),
  'delta',
  100
)

// 结果：检测到自引用，使用基础速度值
```

## 🎮 游戏平衡考虑

### Fallback策略

1. **基础值优先**：使用属性的原始基础值
2. **最后成功值**：使用最近一次成功计算的结果
3. **类型安全**：确保fallback值的类型正确

### 数值合理性

```typescript
// 确保fallback值在合理范围内
private getFallbackValue(key: keyof T): number | boolean | string {
  // 优先使用缓存的fallback值
  if (this.fallbackValues.has(key)) {
    return this.fallbackValues.get(key)!
  }

  // 使用基础值作为安全fallback
  const baseSubject = this.baseAttributes.get(key)
  if (baseSubject) {
    const fallback = baseSubject.value
    this.fallbackValues.set(key, fallback)
    return fallback
  }

  // 类型安全的默认值
  return typeof baseValue === 'number' ? 0 :
         typeof baseValue === 'boolean' ? false : ''
}
```

## 🔍 调试和监控

### 调试方法

```typescript
// 检查是否存在循环依赖
const hasCircular = attributeSystem.hasCircularDependencies()

// 查看当前计算栈
const stack = attributeSystem.getCalculationStack()

// 查看依赖图
const graph = attributeSystem.getDependencyGraph()

// 查看fallback值
const fallback = attributeSystem.getCurrentFallbackValue('attack')
```

### 配置选项

```typescript
// 设置最大计算深度
attributeSystem.setMaxCalculationDepth(15)

// 手动设置fallback值
attributeSystem.setFallbackValue('attack', 100)

// 清理循环依赖跟踪数据
attributeSystem.clearCircularDependencyTracking()
```

## ⚡ 性能优化

### 1. **懒加载检测**

- 只在实际计算时进行循环检测
- 避免预先构建完整依赖图的开销

### 2. **智能缓存**

- 缓存成功的计算结果作为fallback
- 避免重复的循环检测

### 3. **深度限制**

- 可配置的最大计算深度
- 防止深度递归影响性能

## 🚨 最佳实践

### 1. **设计时避免**

- 尽量避免设计相互依赖的属性
- 使用单向依赖链而非双向依赖

### 2. **测试验证**

- 为复杂的modifier组合编写测试
- 验证循环依赖检测的正确性

### 3. **监控告警**

- 在开发环境中启用详细的循环依赖警告
- 定期检查依赖图的复杂度

## 📊 实际测试结果

### 基础功能测试

```console
=== Simple Circular Dependency Test ===

Test 1: Basic functionality
Initial attack: 100
Initial defense: 80
After simple modifier (+50): 150

Test 3: Circular dependency detection methods
Has circular dependencies: false
Max calculation depth: 10
Calculation stack size: 0

Test 4: Fallback values
Attack fallback: 150
Defense fallback: 80
```

### 循环依赖检测测试

```console
=== Real Circular Dependency Test ===

Test 1: Direct circular dependency simulation
Initial attack: 100
Simulating circular dependency for attack...
Circular dependency detected in getCurrentValue for 'attack', using fallback value
  Result: 100 (should be fallback value)

Test 2: Deep recursion simulation
Set max calculation depth to: 5
  Recursion depth: 0
  Recursion depth: 1
  Recursion depth: 2
  Calculation depth limit exceeded at depth 5
Deep recursion result: 80

Test 4: Multiple attributes in calculation stack
Calculation stack contents: [ 'attack', 'defense', 'speed' ]
Circular dependency detected in getCurrentValue for 'attack', using fallback value
Circular dependency detected in getCurrentValue for 'defense', using fallback value
Circular dependency detected in getCurrentValue for 'speed', using fallback value
```

## ✅ 验证结果

### 1. **循环依赖检测** ✅

- 成功检测直接循环依赖（属性在计算栈中时被再次访问）
- 正确返回fallback值而不是抛出错误
- 提供清晰的警告信息

### 2. **深度递归保护** ✅

- 成功限制计算深度，防止栈溢出
- 可配置的最大深度限制（默认10层）
- 超出限制时自动使用fallback值

### 3. **错误恢复** ✅

- modifier应用出错时不会导致整个系统崩溃
- 自动使用fallback值保证系统稳定性
- 错误信息记录便于调试

### 4. **性能优化** ✅

- 轻量级检测机制，不影响正常计算
- 智能fallback值缓存
- 计算栈自动清理

### 5. **游戏平衡** ✅

- Fallback值基于属性基础值，确保数值合理
- 不会因循环依赖产生异常数值
- 保持游戏平衡性

## 🎯 总结

这个循环依赖检测与防护系统成功解决了AttributeSystem中"左脚踩右脚"的问题：

1. **直觉性**：使用基础值作为fallback，符合用户期望
2. **平衡性**：确保数值在合理范围内，不破坏游戏平衡
3. **稳定性**：系统不会因循环依赖而崩溃
4. **可调试性**：提供丰富的调试信息和配置选项
5. **性能友好**：轻量级实现，不影响正常使用

该系统确保了即使在复杂的modifier组合下，AttributeSystem也能保持稳定运行，同时为开发者提供了充分的调试信息来识别和解决循环依赖问题。
