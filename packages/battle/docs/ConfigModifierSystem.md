# Config Modifier System

## 概述

Config Modifier System 是一个强大的配置值动态修改系统，允许印记、技能和阶段在特定scope或phase内动态修改config的键值对。当modifier被移除时，配置值会自动恢复原状。

## 核心特性

### 1. 多种修改器类型
- **override**: 完全覆盖原值
- **delta**: 数值增减（仅适用于数字类型）
- **append**: 字符串追加（仅适用于字符串类型）
- **prepend**: 字符串前置（仅适用于字符串类型）

### 2. 生命周期管理
- **instant**: 立即生效，手动清理
- **binding**: 绑定到源对象生命周期（mark/skill）
- **phase**: 绑定到phase生命周期

### 3. 优先级系统
- 支持优先级排序，高优先级的modifier先应用
- 相同优先级按添加顺序应用

### 4. 响应式更新
- 支持Observable值源，实现动态响应式更新
- 基于RxJS的响应式编程模式

## 核心类

### ConfigModifier
```typescript
class ConfigModifier {
  constructor(
    durationType: ConfigDurationType,
    id: string,
    initialValue: ConfigValue | Subject<ConfigValue> | Observable<ConfigValue>,
    type: ConfigModifierType,
    priority: number,
    source?: MarkInstance | SkillInstance | BattlePhaseBase,
  )
}
```

### ConfigSystem
```typescript
class ConfigSystem {
  // 注册支持modifier的配置键
  registerConfig(key: string, initialValue: ConfigValue): void
  
  // 获取配置值（应用所有modifier后的结果）
  get(key: string, scope?: ScopeObject): ConfigValue | undefined
  
  // 设置基础配置值
  set(key: string, value: ConfigValue, scope?: ScopeObject): void
  
  // 添加配置modifier
  addConfigModifier(key: string, modifier: ConfigModifier): () => void
  
  // 移除来自特定源的所有modifier
  removeModifiersFromSource(sourceId: string): void
}
```

## 使用示例

### 基础用法
```typescript
const configSystem = ConfigSystem.getInstance()

// 注册配置
configSystem.registerConfig('battle.turnTimeLimit', 30)

// 创建modifier
const timeModifier = new ConfigModifier(
  ConfigDurationType.binding,
  'time_reduction',
  -10, // 减少10秒
  ConfigModifierType.delta,
  100,
)

// 应用modifier
const cleanup = configSystem.addConfigModifier('battle.turnTimeLimit', timeModifier)

console.log(configSystem.get('battle.turnTimeLimit')) // 20

// 清理
cleanup()
```

### 动态modifier
```typescript
const dynamicValue$ = new BehaviorSubject(0.5)
const dynamicModifier = new ConfigModifier(
  ConfigDurationType.binding,
  'dynamic_damage',
  dynamicValue$,
  ConfigModifierType.delta,
  50,
)

configSystem.addConfigModifier('effects.damageMultiplier', dynamicModifier)

// 动态改变值
dynamicValue$.next(1.0) // 伤害倍率会自动更新
```

### Phase级别的modifier
```typescript
// 在Phase中添加临时配置修改
class CustomPhase extends BattlePhaseBase {
  protected async executeOperation(): Promise<void> {
    // 在此phase期间增加伤害倍率
    this.addConfigModifier(
      'effects.damageMultiplier',
      ConfigModifierType.delta,
      0.5,
      100
    )
    
    // Phase结束时会自动清理modifier
  }
}
```

## Effect Builder集成

### 新增的Operator

#### addConfigModifier
```typescript
{
  type: 'addConfigModifier',
  configKey: 'battle.turnTimeLimit',
  modifierType: 'delta',
  value: -15,
  priority: 100,
}
```

#### addDynamicConfigModifier
```typescript
{
  type: 'addDynamicConfigModifier',
  configKey: 'effects.damageMultiplier',
  modifierType: 'delta',
  observableValue: {
    base: 'self',
    chain: [
      { type: 'selectAttribute$', arg: 'hp' },
      { type: 'map', arg: 'hp => hp < 50 ? 0.5 : 0' }
    ]
  },
  priority: 100,
}
```

#### addPhaseConfigModifier
```typescript
{
  type: 'addPhaseConfigModifier',
  target: { base: 'currentPhase' },
  configKey: 'effects.damageMultiplier',
  modifierType: 'delta',
  value: 0.8,
  priority: 200,
}
```

#### registerConfig
```typescript
{
  type: 'registerConfig',
  configKey: 'battle.customRule',
  initialValue: true,
}
```

## 实际应用场景

### 1. 时间操控效果
```typescript
const timeAccelerationMark = {
  effects: [{
    trigger: 'OnMarkAdded',
    apply: {
      type: 'addConfigModifier',
      configKey: 'battle.turnTimeLimit',
      modifierType: 'delta',
      value: -15, // 减少15秒回合时间
    }
  }]
}
```

### 2. 战斗规则修改
```typescript
const endlessRageMark = {
  effects: [{
    trigger: 'OnMarkAdded',
    apply: {
      type: 'addConfigModifier',
      configKey: 'battle.maxRounds',
      modifierType: 'delta',
      value: 50, // 增加50回合上限
    }
  }]
}
```

### 3. 动态伤害调整
```typescript
const adaptiveDamageMark = {
  effects: [{
    trigger: 'OnMarkAdded',
    apply: {
      type: 'addDynamicConfigModifier',
      configKey: 'effects.damageMultiplier',
      modifierType: 'delta',
      observableValue: {
        base: 'self',
        chain: [
          { type: 'selectAttribute$', arg: 'hp' },
          { type: 'combineWith', arg: { base: 'self', chain: [{ type: 'selectAttribute$', arg: 'maxHp' }] } },
          { type: 'map', arg: '([hp, maxHp]) => (1 - hp / maxHp) * 0.5' }
        ]
      }
    }
  }]
}
```

### 4. UI主题修改
```typescript
const darknessMark = {
  effects: [{
    trigger: 'OnMarkAdded',
    apply: {
      type: 'addConfigModifier',
      configKey: 'ui.theme',
      modifierType: 'override',
      value: 'darkness',
    }
  }]
}
```

## 优势

1. **类型安全**: 强类型支持，编译时错误检查
2. **响应式**: 基于RxJS的响应式更新机制
3. **生命周期管理**: 自动清理，防止内存泄漏
4. **优先级控制**: 灵活的优先级系统
5. **可扩展性**: 易于添加新的modifier类型
6. **调试友好**: 详细的错误信息和调试支持

## 注意事项

1. 配置键必须先通过`registerConfig()`注册才能使用modifier
2. 不同类型的modifier只能应用于兼容的值类型
3. 动态modifier的Observable必须同步发出初始值
4. Phase级别的modifier会在phase结束时自动清理
5. 避免创建循环依赖的modifier链
