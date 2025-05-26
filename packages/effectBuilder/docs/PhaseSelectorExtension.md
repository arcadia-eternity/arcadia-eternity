# Phase Selector Extension

## 概述

为了支持Config Modifier系统中的phase级别操作，我们扩展了selector系统，使其能够选择和操作BattlePhase对象。这解决了之前selector只能选择context而无法直接选择phase的限制。

## 新增的Selector

### 1. currentPhase
选择当前正在执行的phase。

```typescript
{
  base: 'currentPhase'
}
```

**返回类型**: `BattlePhaseBase | undefined`

**使用场景**:
- 为当前phase添加临时config modifier
- 基于当前phase状态进行条件判断
- 获取当前phase的属性信息

### 2. allPhases
选择所有已注册的phases。

```typescript
{
  base: 'allPhases'
}
```

**返回类型**: `BattlePhaseBase[]`

**使用场景**:
- 对所有phase应用全局修改
- 统计phase信息
- 批量操作多个phase

## 实现细节

### Selector实现
```typescript
// 选择当前正在执行的phase
currentPhase: createChainable<BattlePhaseBase>('BattlePhaseBase', (context: EffectContext<EffectTrigger>) => {
  const currentPhase = context.battle.phaseManager.getCurrentPhase()
  return currentPhase ? [currentPhase] : []
}),

// 选择所有已注册的phases
allPhases: createChainable<BattlePhaseBase>('BattlePhaseBase', (context: EffectContext<EffectTrigger>) => {
  return context.battle.phaseManager.getAllPhases()
}),
```

### 类型系统集成
- 添加了`BattlePhaseBase`到`ObjectOpinion`联合类型
- 自动支持所有现有的selector链式操作
- 完全兼容现有的类型检查系统

## 使用示例

### 基础用法

#### 选择当前phase并添加config modifier
```typescript
{
  type: 'addPhaseConfigModifier',
  target: { base: 'currentPhase' },
  configKey: 'effects.damageMultiplier',
  modifierType: 'delta',
  value: 0.5,
  priority: 100,
}
```

#### 对所有phase应用全局修改
```typescript
{
  type: 'forEach',
  target: { base: 'allPhases' },
  operator: {
    type: 'addPhaseConfigModifier',
    configKey: 'ui.theme',
    modifierType: 'override',
    value: 'epic',
    priority: 50,
  },
}
```

### 高级用法

#### 基于phase属性的条件逻辑
```typescript
{
  type: 'conditional',
  condition: {
    type: 'evaluate',
    target: { 
      base: 'currentPhase', 
      chain: [{ type: 'selectProp', arg: 'state' }] 
    },
    evaluator: { type: 'same', value: 'Executing' },
  },
  trueOperator: {
    type: 'addPhaseConfigModifier',
    target: { base: 'currentPhase' },
    configKey: 'effects.powerBoost',
    modifierType: 'delta',
    value: 0.3,
    priority: 100,
  },
}
```

#### 动态值基于phase状态
```typescript
{
  type: 'addDynamicConfigModifier',
  configKey: 'effects.skillPowerMultiplier',
  modifierType: 'delta',
  observableValue: {
    base: 'currentPhase',
    chain: [
      { type: 'selectProp', arg: 'state' },
      {
        type: 'when',
        condition: { type: 'same', value: 'Executing' },
        trueValue: 0.5,
        falseValue: 0,
      },
    ],
  },
  priority: 100,
}
```

#### 复杂的phase链式操作
```typescript
{
  base: 'allPhases',
  chain: [
    { type: 'where', arg: { type: 'selectProp', arg: 'state' } },
    { type: 'same', value: 'Executing' },
    { type: 'limit', arg: 3 }, // 最多选择3个执行中的phase
  ]
}
```

## 与Config Modifier系统的集成

### Phase级别的Config Modifier
新的phase selector使得以下操作成为可能：

1. **临时phase配置**: 在phase执行期间临时修改配置
2. **phase生命周期绑定**: modifier自动与phase生命周期绑定
3. **条件性phase修改**: 基于phase状态动态应用modifier

### 自动清理机制
- Phase结束时，所有绑定到该phase的config modifier会自动清理
- 无需手动管理modifier生命周期
- 防止内存泄漏和配置污染

## 兼容性

### 向后兼容
- 所有现有的selector功能保持不变
- 现有的effect定义无需修改
- 类型系统完全兼容

### 扩展性
- 可以轻松添加更多phase相关的selector
- 支持所有现有的selector链式操作
- 与Observable系统完全集成

## 最佳实践

### 1. 使用currentPhase进行临时修改
```typescript
// ✅ 推荐：为当前phase添加临时配置
{
  target: { base: 'currentPhase' },
  type: 'addPhaseConfigModifier',
  configKey: 'effects.damageBonus',
  modifierType: 'delta',
  value: 0.2,
}
```

### 2. 使用allPhases进行全局操作
```typescript
// ✅ 推荐：对所有phase应用全局设置
{
  target: { base: 'allPhases' },
  type: 'forEach',
  operator: {
    type: 'addPhaseConfigModifier',
    configKey: 'ui.debugMode',
    modifierType: 'override',
    value: true,
  },
}
```

### 3. 结合条件逻辑使用
```typescript
// ✅ 推荐：基于phase状态的智能逻辑
{
  type: 'conditional',
  condition: {
    type: 'evaluate',
    target: { base: 'currentPhase' },
    evaluator: { type: 'exist' },
  },
  trueOperator: {
    // 只有当存在当前phase时才执行
    type: 'addPhaseConfigModifier',
    target: { base: 'currentPhase' },
    // ...
  },
}
```

### 4. 避免的反模式
```typescript
// ❌ 避免：不要尝试修改已完成的phase
{
  target: { 
    base: 'allPhases',
    chain: [
      { type: 'where', arg: { type: 'selectProp', arg: 'state' } },
      { type: 'same', value: 'Completed' }
    ]
  },
  type: 'addPhaseConfigModifier', // 这不会有效果
}
```

## 调试和监控

### Phase状态监控
```typescript
{
  type: 'log',
  message: {
    base: 'currentPhase',
    chain: [
      { type: 'selectProp', arg: 'id' },
      { type: 'add', arg: ' is currently executing' }
    ]
  }
}
```

### Config值追踪
```typescript
{
  type: 'log',
  message: {
    base: 'config',
    key: 'effects.damageMultiplier',
    chain: [
      { type: 'add', arg: ' current damage multiplier: ' }
    ]
  }
}
```

## 总结

Phase Selector扩展为Config Modifier系统提供了强大的phase级别操作能力，使得：

1. **精确控制**: 可以精确控制特定phase的配置
2. **生命周期管理**: 自动处理modifier的生命周期
3. **灵活性**: 支持复杂的条件逻辑和动态值
4. **类型安全**: 完整的TypeScript类型支持
5. **易用性**: 与现有selector系统无缝集成

这个扩展完美解决了"selector选不到phase"的问题，为游戏效果系统提供了更强大和灵活的配置管理能力。
