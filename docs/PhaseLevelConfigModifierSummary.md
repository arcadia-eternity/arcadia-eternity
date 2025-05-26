# Phase Level Config Modifier - 完整实现总结

## 🎯 解决的问题

您提出的需求：**"如果我想做一个一次性的修改，在当前phase树中的某一层级的phase结束之后就立刻移除呢？"**

这个功能现在已经完全实现！

## ✅ 核心功能

### 1. Phase Level Duration Type
新增了 `ConfigDurationType.phaseLevel`，支持基于phase层级的生命周期管理。

### 2. Phase Level Specification
```typescript
interface PhaseLevelSpec {
  phaseId?: string // 可选：特定phase ID
  level: number // Phase树层级 (0 = root, 1 = 第一层子phase, etc.)
  strategy: 'exact' | 'atOrAbove' | 'atOrBelow' // 层级匹配策略
}
```

### 3. 三种清理策略

#### `exact` - 精确层级
- 当**恰好**指定层级的phase完成时移除modifier
- 例：`level: 2, strategy: 'exact'` → 当level 2的phase完成时移除

#### `atOrAbove` - 指定层级及以上
- 当**指定层级或更高层级**的phase完成时移除modifier  
- 例：`level: 1, strategy: 'atOrAbove'` → 当level 1, 2, 3...任何phase完成时移除

#### `atOrBelow` - 指定层级及以下
- 当**指定层级或更低层级**的phase完成时移除modifier
- 例：`level: 2, strategy: 'atOrBelow'` → 当level 0, 1, 2的phase完成时移除

## 🚀 使用示例

### 基础用法
```typescript
// 在level 1 phase结束时自动移除的伤害加成
const temporaryDamageBoost = {
  type: 'addPhaseLevelConfigModifier',
  configKey: 'effects.damageMultiplier',
  modifierType: 'delta',
  value: 0.5, // +50% 伤害
  level: 1, // 在level 1 phase完成时移除
  strategy: 'exact', // 精确匹配level 1
  priority: 100,
}
```

### 特定Phase ID
```typescript
// 只在特定phase完成时移除
const specificPhaseModifier = {
  type: 'addPhaseLevelConfigModifier',
  configKey: 'effects.healingMultiplier',
  modifierType: 'delta',
  value: 1.0, // 双倍治疗
  level: 1,
  strategy: 'exact',
  phaseId: 'damage_calculation_phase', // 只针对特定phase
  priority: 100,
}
```

### 动态值
```typescript
// 基于当前状态的动态modifier，在phase层级完成时移除
const dynamicPhaseModifier = {
  type: 'addDynamicPhaseLevelConfigModifier',
  configKey: 'effects.criticalChance',
  modifierType: 'delta',
  observableValue: {
    base: 'battle',
    chain: [
      { type: 'selectProp', arg: 'currentTurn' },
      { type: 'multiply', arg: 0.05 }, // 每回合+5%
    ],
  },
  level: 2, // 在level 2 phase完成时移除
  strategy: 'exact',
  priority: 100,
}
```

### 复杂嵌套场景
```typescript
// 多层级modifier，在不同层级完成时分别移除
const nestedPhaseModifiers = {
  type: 'sequence',
  operators: [
    // Level 0 - 整个战斗期间有效
    {
      type: 'addPhaseLevelConfigModifier',
      configKey: 'battle.baseMultiplier',
      modifierType: 'delta',
      value: 0.1,
      level: 0,
      strategy: 'exact',
    },
    // Level 1 - 第一层子phase完成时移除
    {
      type: 'addPhaseLevelConfigModifier',
      configKey: 'effects.speedBonus',
      modifierType: 'delta',
      value: 0.2,
      level: 1,
      strategy: 'exact',
    },
    // Level 2 - 第二层子phase完成时移除
    {
      type: 'addPhaseLevelConfigModifier',
      configKey: 'effects.powerBonus',
      modifierType: 'delta',
      value: 0.3,
      level: 2,
      strategy: 'exact',
    },
  ],
}
```

## 🔧 技术实现

### Phase Stack管理
- ConfigSystem维护一个phase执行栈
- PhaseManager在执行phase时自动push/pop
- 支持嵌套phase的正确层级跟踪

### 自动清理机制
- Phase完成时自动检查所有phase level modifier
- 根据策略和层级匹配规则决定是否清理
- 支持特定phase ID的精确匹配

### 生命周期集成
- 与现有的phase生命周期完全集成
- 在PhaseManager的finally块中确保清理
- 支持异常情况下的正确清理

## 📊 实际应用场景

### 1. 临时战斗增益
```typescript
// 在当前技能phase结束后立即移除的暴击加成
const temporaryCritBoost = {
  trigger: 'OnSkillStart',
  apply: {
    type: 'addPhaseLevelConfigModifier',
    configKey: 'effects.criticalChance',
    modifierType: 'delta',
    value: 0.3, // +30% 暴击率
    level: 2, // 技能phase层级
    strategy: 'exact',
  }
}
```

### 2. 阶段性效果
```typescript
// 在回合phase结束时移除的时间加速
const turnBasedTimeAcceleration = {
  trigger: 'OnTurnStart',
  apply: {
    type: 'addPhaseLevelConfigModifier',
    configKey: 'battle.turnTimeLimit',
    modifierType: 'delta',
    value: -10, // 减少10秒
    level: 1, // 回合phase层级
    strategy: 'exact',
  }
}
```

### 3. 条件性临时效果
```typescript
// 高伤害触发的临时连击加成，在当前phase完成时移除
const conditionalComboBoost = {
  trigger: 'OnDamageDealt',
  condition: {
    type: 'evaluate',
    target: { base: 'damageContext', chain: [{ type: 'selectProp', arg: 'damage' }] },
    evaluator: { type: 'compare', operator: '>', value: 100 },
  },
  apply: {
    type: 'addPhaseLevelConfigModifier',
    configKey: 'effects.comboMultiplier',
    modifierType: 'delta',
    value: 0.25,
    level: 1,
    strategy: 'atOrAbove', // 任何level 1+的phase完成时移除
  }
}
```

## 🎯 优势特性

### 1. 精确控制
- 可以精确指定在哪个层级的phase完成时移除
- 支持特定phase ID的精确匹配
- 三种策略覆盖所有使用场景

### 2. 自动管理
- 无需手动清理，完全自动化
- 与phase生命周期深度集成
- 异常安全，确保资源正确释放

### 3. 灵活性
- 支持静态值和动态Observable值
- 可以与现有的所有modifier类型组合
- 支持复杂的嵌套phase场景

### 4. 性能优化
- 高效的层级跟踪算法
- 最小化内存占用
- 快速的modifier查找和清理

## 🧪 测试验证

所有功能都经过了完整的测试验证：

- ✅ 基础phase level modifier功能
- ✅ 三种清理策略（exact, atOrAbove, atOrBelow）
- ✅ 特定phase ID匹配
- ✅ 动态Observable值支持
- ✅ 复杂嵌套phase树场景
- ✅ 异常情况下的正确清理

## 🎉 总结

现在您可以轻松创建**一次性的config修改**，它们会在**当前phase树中的某一层级的phase结束之后立刻移除**！

这个功能提供了：
1. **精确的层级控制** - 指定确切的清理时机
2. **灵活的策略选择** - 三种不同的匹配策略
3. **完全自动化** - 无需手动管理生命周期
4. **强大的表达能力** - 支持复杂的游戏逻辑

完美解决了您的需求！🚀
