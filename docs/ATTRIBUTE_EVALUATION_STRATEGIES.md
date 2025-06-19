# 属性评估策略系统

## 概述

为了正确处理不同类型属性的 modifier 效果显示，我们实现了一个双策略系统。这个系统能够区分"收益型属性"和"成本型属性"，并根据属性类型正确判断 modifier 效果是正面还是负面。

## 问题背景

在之前的实现中，所有属性都使用相同的评估逻辑：
- 数值增加 = 正面效果（绿色）
- 数值减少 = 负面效果（红色）

但这对于"成本型属性"（如怒气消耗）是不正确的：
- 怒气消耗增加 = 负面效果（应该显示红色）
- 怒气消耗减少 = 正面效果（应该显示绿色）

## 策略系统设计

### 1. 策略类型定义

```typescript
export type AttributeEvaluationStrategy = 'benefit' | 'cost'
```

- **benefit**: 收益型属性 - 数值越高越好
- **cost**: 成本型属性 - 数值越低越好

### 2. 属性策略配置

```typescript
const ATTRIBUTE_STRATEGIES: Record<string, AttributeEvaluationStrategy> = {
  // 收益型属性 - 数值越高越好
  power: 'benefit',        // 技能威力
  accuracy: 'benefit',     // 命中率
  priority: 'benefit',     // 优先级
  atk: 'benefit',         // 攻击力
  def: 'benefit',         // 防御力
  spa: 'benefit',         // 特攻
  spd: 'benefit',         // 特防
  spe: 'benefit',         // 速度
  maxHp: 'benefit',       // 最大生命值
  currentHp: 'benefit',   // 当前生命值
  maxRage: 'benefit',     // 最大怒气值
  currentRage: 'benefit', // 当前怒气值
  critRate: 'benefit',    // 暴击率
  evasion: 'benefit',     // 闪避率
  level: 'benefit',       // 等级
  
  // 成本型属性 - 数值越低越好
  rage: 'cost',           // 怒气消耗
}
```

### 3. 策略获取函数

```typescript
function getAttributeStrategy(attributeName: string): AttributeEvaluationStrategy {
  return ATTRIBUTE_STRATEGIES[attributeName] || 'benefit'
}
```

默认情况下，未配置的属性被视为收益型属性。

## 评估逻辑

### 1. 更新的 analyzeModifierType 函数

```typescript
export function analyzeModifierType(
  attributeInfo?: AttributeModifierInfo, 
  attributeName?: string
): ModifierEffectType
```

新增了 `attributeName` 参数，用于指定属性名以获取正确的评估策略。

### 2. 策略应用逻辑

#### 对于 benefit 策略（收益型）
- 数值增加 → 正面效果（绿色）
- 数值减少 → 负面效果（红色）

#### 对于 cost 策略（成本型）
- 数值增加 → 负面效果（红色）
- 数值减少 → 正面效果（绿色）

### 3. 实现细节

```typescript
// 根据策略检查正面效果
const hasPositive = modifiers.some(m => {
  let isIncrease = false
  
  switch (m.type) {
    case 'delta':
      isIncrease = typeof m.value === 'number' && m.value > 0
      break
    case 'percent':
      isIncrease = typeof m.value === 'number' && m.value > 0
      break
    case 'override':
      isIncrease = typeof m.value === 'number' && m.value > baseValue
      break
  }
  
  // 根据策略判断增加是否为正面效果
  return strategy === 'benefit' ? isIncrease : !isIncrease
})
```

## 组件更新

### 1. SkillButton 组件

```typescript
// 修改前
const powerModifierType = computed(() => {
  return analyzeModifierType(props.powerModifierInfo)
})

// 修改后
const powerModifierType = computed(() => {
  return analyzeModifierType(props.powerModifierInfo, 'power')
})

const rageModifierType = computed(() => {
  return analyzeModifierType(props.rageModifierInfo, 'rage')
})
```

### 2. HealthRageBar 组件

```typescript
// 修改前
const rageModifierType = computed(() => {
  return analyzeModifierType(props.rageModifierInfo)
})

// 修改后
const rageModifierType = computed(() => {
  return analyzeModifierType(props.rageModifierInfo, 'currentRage')
})
```

## 效果示例

### 怒气消耗 (rage) - 成本型属性

| 基础值 | 当前值 | 变化 | 效果类型 | 显示颜色 | 说明 |
|--------|--------|------|----------|----------|------|
| 15 | 18 | +3 | debuffed | 红色 | 消耗增加，负面 |
| 15 | 12 | -3 | buffed | 绿色 | 消耗减少，正面 |
| 15 | 15 | 0 | none | 白色 | 无变化 |

### 技能威力 (power) - 收益型属性

| 基础值 | 当前值 | 变化 | 效果类型 | 显示颜色 | 说明 |
|--------|--------|------|----------|----------|------|
| 80 | 120 | +40 | buffed | 绿色 | 威力提升，正面 |
| 80 | 60 | -20 | debuffed | 红色 | 威力降低，负面 |
| 80 | 80 | 0 | none | 白色 | 无变化 |

## 测试验证

### 测试页面更新

在 `ModifierTest.vue` 中添加了专门的策略测试区域：

```vue
<!-- 怒气消耗策略测试 -->
<div class="mt-8 border-t border-gray-600 pt-6">
  <h3 class="text-lg font-medium mb-4">怒气消耗策略测试</h3>
  <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
    <div class="text-center bg-gray-700 rounded-lg p-4">
      <h4 class="text-sm text-gray-400 mb-2">怒气消耗增加</h4>
      <div class="text-xl mb-2">
        <ModifiedValue :value="18" :attribute-info="createTestModifierInfo('rage', 15, 18)" />
      </div>
      <p class="text-xs text-gray-500">15 → 18 (红色，负面)</p>
    </div>
    <!-- 更多测试用例... -->
  </div>
</div>
```

### 预期测试结果

- ✅ 怒气消耗增加（15→18）显示红色
- ✅ 怒气消耗减少（15→12）显示绿色
- ✅ 威力提升（80→120）显示绿色
- ✅ 其他收益型属性按原逻辑显示

## 扩展性

### 添加新的成本型属性

如果需要添加新的成本型属性，只需在配置中添加：

```typescript
const ATTRIBUTE_STRATEGIES: Record<string, AttributeEvaluationStrategy> = {
  // 现有配置...
  
  // 新增成本型属性
  cooldown: 'cost',        // 冷却时间
  castTime: 'cost',        // 施法时间
  energyCost: 'cost',      // 能量消耗
}
```

### 添加新的策略类型

如果需要更复杂的评估逻辑，可以扩展策略类型：

```typescript
export type AttributeEvaluationStrategy = 'benefit' | 'cost' | 'neutral' | 'complex'
```

## 技术优势

### 1. 语义正确性
- 正确反映了不同属性类型的实际意义
- 提供了符合用户直觉的视觉反馈

### 2. 可扩展性
- 易于添加新的属性类型
- 支持未来更复杂的评估策略

### 3. 向后兼容
- 默认策略确保现有属性不受影响
- 渐进式升级，不破坏现有功能

### 4. 类型安全
- TypeScript 类型定义确保编译时检查
- 减少运行时错误

## 总结

通过实现属性评估策略系统，我们解决了怒气消耗等成本型属性的显示问题：

- 🎯 **语义正确**: 怒气消耗增加正确显示为负面效果
- 🔧 **易于扩展**: 可以轻松添加新的属性类型
- 🛡️ **向后兼容**: 不影响现有功能
- 📊 **直观显示**: 提供符合用户预期的视觉反馈

现在系统能够正确区分不同类型的属性，为用户提供更准确和直观的 modifier 效果显示。
