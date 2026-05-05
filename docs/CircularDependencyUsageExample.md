# AttributeSystem 循环依赖防护 - 使用示例

## 🚀 快速开始

### 基本使用

```typescript
import { AttributeSystem, Modifier, DurationType } from '@arcadia-eternity/battle'

// 创建属性系统
const attributeSystem = new AttributeSystem<PetAttributeSet>()

// 注册基础属性
attributeSystem.registerBaseAttribute('attack', 100)
attributeSystem.registerBaseAttribute('defense', 80)
attributeSystem.registerBaseAttribute('speed', 60)

// 正常使用 - 不会有循环依赖问题
const attackBoost = new Modifier(DurationType.binding, 'attack_boost', 50, 'delta', 100)

attributeSystem.addModifier('attack', attackBoost)
console.log('Attack:', attributeSystem.getCurrentValue('attack')) // 150
```

## ⚠️ 潜在的循环依赖场景

### 场景1：相互依赖的属性

```typescript
// ❌ 危险：这种设计可能导致循环依赖
const attackFromDefense = new Modifier(
  DurationType.binding,
  'attack_from_defense',
  computed(() => {
    // 攻击力依赖防御力
    const defense = attributeSystem.getCurrentValue('defense') as number
    return Math.floor(defense * 0.5)
  }, [attributeSystem.getAttribute$('defense')]),
  'delta',
  100,
)

const defenseFromAttack = new Modifier(
  DurationType.binding,
  'defense_from_attack',
  computed(() => {
    // 防御力依赖攻击力 - 形成循环！
    const attack = attributeSystem.getCurrentValue('attack') as number
    return Math.floor(attack * 0.3)
  }, [attributeSystem.getAttribute$('attack')]),
  'delta',
  100,
)

// 添加这两个modifier会触发循环依赖检测
attributeSystem.addModifier('attack', attackFromDefense)
attributeSystem.addModifier('defense', defenseFromAttack)

// ✅ 系统会自动处理：
// - 检测到循环依赖
// - 使用fallback值（基础值）
// - 输出警告信息
// - 保持系统稳定运行
```

### 场景2：自引用属性

```typescript
// ❌ 危险：属性依赖自身
const selfBoostingSpeed = new Modifier(
  DurationType.binding,
  'self_boosting_speed',
  computed(() => {
    // 速度依赖自身 - 自引用循环！
    const currentSpeed = attributeSystem.getCurrentValue('speed') as number
    return currentSpeed + 10
  }, [attributeSystem.getAttribute$('speed')]),
  'delta',
  100,
)

attributeSystem.addModifier('speed', selfBoostingSpeed)

// ✅ 系统会自动处理：
// Console: "Circular dependency detected for attribute 'speed', using fallback value"
// 返回基础速度值而不是无限递增
```

## 🛡️ 系统保护机制

### 1. 循环依赖检测

```typescript
// 检查是否存在循环依赖
if (attributeSystem.hasCircularDependencies()) {
  console.log('Warning: Circular dependencies detected!')

  // 查看依赖图
  const graph = attributeSystem.getDependencyGraph()
  console.log('Dependency graph:', graph)

  // 查看当前计算栈
  const stack = attributeSystem.getCalculationStack()
  console.log('Calculation stack:', Array.from(stack))
}
```

### 2. 深度限制配置

```typescript
// 设置最大计算深度（默认10）
attributeSystem.setMaxCalculationDepth(15)

// 获取当前设置
const maxDepth = attributeSystem.getMaxCalculationDepth()
console.log('Max calculation depth:', maxDepth)
```

### 3. Fallback值管理

```typescript
// 查看当前fallback值
const attackFallback = attributeSystem.getCurrentFallbackValue('attack')
console.log('Attack fallback:', attackFallback)

// 手动设置fallback值（用于特殊情况）
attributeSystem.setFallbackValue('defense', 100)

// 当基础值更新时，fallback值会自动更新
attributeSystem.updateBaseValue('attack', 120)
// fallback值也会更新为120
```

### 4. 清理和重置

```typescript
// 清理所有循环依赖跟踪数据
attributeSystem.clearCircularDependencyTracking()

// 重置计算深度计数器
// （通常在每次成功计算后自动重置）
```

## 🎮 游戏设计最佳实践

### 1. 避免循环设计

```typescript
// ✅ 推荐：单向依赖链
const levelBonus = new Modifier(
  DurationType.binding,
  'level_bonus',
  computed(() => {
    const level = petInstance.getLevel()
    return level * 5 // 等级影响攻击力
  }, [petInstance.level$]),
  'delta',
  100,
)

// ✅ 推荐：基于外部状态的modifier
const weatherBonus = new Modifier(
  DurationType.binding,
  'weather_bonus',
  computed(() => {
    const weather = battleInstance.getCurrentWeather()
    return weather === 'sunny' ? 20 : 0
  }, [battleInstance.weather$]),
  'delta',
  50,
)
```

### 2. 安全的动态modifier

```typescript
// ✅ 安全：基于HP比例的攻击加成
const hpRatioBonus = new Modifier(
  DurationType.binding,
  'hp_ratio_bonus',
  computed(() => {
    const currentHp = attributeSystem.getCurrentValue('currentHp') as number
    const maxHp = attributeSystem.getCurrentValue('maxHp') as number
    const ratio = currentHp / maxHp

    // 低血量时攻击力提升，但不依赖攻击力本身
    return ratio < 0.3 ? 50 : 0
  }, [attributeSystem.getAttribute$('currentHp'), attributeSystem.getAttribute$('maxHp')]),
  'delta',
  200,
)

attributeSystem.addModifier('attack', hpRatioBonus)
```

### 3. 错误处理

```typescript
try {
  // 添加可能有问题的modifier
  const riskyModifier = createComplexModifier()
  const cleanup = attributeSystem.addModifier('attack', riskyModifier)

  // 检查是否工作正常
  const value = attributeSystem.getCurrentValue('attack')

  if (attributeSystem.hasCircularDependencies()) {
    console.warn('Circular dependency detected, cleaning up...')
    cleanup()
    attributeSystem.clearCircularDependencyTracking()
  }
} catch (error) {
  console.error('Error adding modifier:', error)
  // 系统会自动使用fallback值，保持稳定
}
```

## 🔍 调试技巧

### 1. 开发环境监控

```typescript
// 在开发环境中启用详细日志
if (process.env.NODE_ENV === 'development') {
  // 监听属性变化
  attributeSystem.getAttribute$('attack').subscribe(value => {
    console.log('Attack changed to:', value)

    if (attributeSystem.hasCircularDependencies()) {
      console.warn('Circular dependency detected!')
      console.log('Stack:', Array.from(attributeSystem.getCalculationStack()))
      console.log('Graph:', attributeSystem.getDependencyGraph())
    }
  })
}
```

### 2. 性能监控

```typescript
// 监控计算深度
const originalGetCurrentValue = attributeSystem.getCurrentValue.bind(attributeSystem)
attributeSystem.getCurrentValue = function (key) {
  const start = performance.now()
  const result = originalGetCurrentValue(key)
  const end = performance.now()

  if (end - start > 10) {
    // 超过10ms
    console.warn(`Slow calculation for ${key}: ${end - start}ms`)
  }

  return result
}
```

## 📋 总结

循环依赖防护系统的核心优势：

1. **自动检测**：无需手动检查，系统自动识别循环依赖
2. **优雅降级**：使用fallback值而不是崩溃
3. **保持平衡**：fallback值基于基础值，不会破坏游戏平衡
4. **易于调试**：提供丰富的调试信息和配置选项
5. **性能友好**：轻量级实现，不影响正常使用

通过这个系统，开发者可以放心地创建复杂的属性modifier组合，而不用担心"左脚踩右脚"的循环依赖问题。
