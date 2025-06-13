# 标签化配置系统使用示例

## 概述

标签化配置系统允许效果注册自己的配置值并附加标签，然后修改器可以通过标签选择要修改的配置值。所有带有特定标签的配置值都会被相应的修改器修改。

## 核心功能

### 1. 注册带标签的配置

```typescript
// 在ConfigSystem中注册带标签的配置
configSystem.registerTaggedConfig('freeze.probability', 0.3, ['freeze', 'probability'])
configSystem.registerTaggedConfig('burn.damage', 50, ['burn', 'damage'])
configSystem.registerTaggedConfig('poison.duration', 3, ['poison', 'duration'])
```

### 2. 按标签修改配置

```typescript
// 增加所有带"probability"标签的效果的触发概率5%
configSystem.addTaggedConfigModifierSingle(
  'probability',
  ConfigModifierType.delta,
  0.05,
  100, // priority
  ConfigDurationType.binding,
  markInstance, // source
  petScope // scope
)

// 增加所有带"damage"标签的效果的伤害10点
configSystem.addTaggedConfigModifierSingle(
  'damage',
  ConfigModifierType.delta,
  10,
  100
)
```

## DSL使用示例

### 示例1：使用带标签的rawValue自动注册配置

```yaml
# 使用带标签的配置值，系统会自动注册
- id: freeze_effect
  trigger: OnDamage
  priority: 100
  apply:
    type: addMark
    target: { base: target }
    mark: { type: 'entity:baseMark', value: 'freeze_mark' }
    # 使用带标签的配置值，会自动注册为标签化配置
    probability:
      type: 'raw:number'
      value: 0.3
      configId: 'freeze_probability'
      tags: ['freeze', 'probability']
```

### 示例2：手动注册标签化配置

```yaml
# 手动注册冰冻效果的配置，并添加标签
- id: register_freeze_config
  trigger: OnBattleStart
  priority: 1000
  apply:
    type: registerTaggedConfig
    target: { base: battle }
    configKey: { type: 'raw:string', value: 'freeze.probability' }
    initialValue: { type: 'raw:number', value: 0.3 }
    tags: { type: 'raw:array', value: ['freeze', 'probability'] }
```

### 示例3：增加所有概率类效果的触发率

```yaml
# 创建一个印记，增加所有带"probability"标签的效果5%触发概率
- id: probability_boost_mark
  trigger: OnMarkAdded
  priority: 100
  apply:
    type: addTaggedConfigModifier
    target: { base: self }
    tag: { type: 'raw:string', value: 'probability' }
    modifierType: { type: 'raw:string', value: 'delta' }
    value: { type: 'raw:number', value: 0.05 }
    priority: { type: 'raw:number', value: 100 }
```

### 示例3：增加所有冰冻类效果的触发率

```yaml
# 创建一个印记，专门增加冰冻效果的触发概率
- id: freeze_mastery_mark
  trigger: OnMarkAdded
  priority: 100
  apply:
    type: addTaggedConfigModifier
    target: { base: self }
    tag: { type: 'raw:string', value: 'freeze' }
    modifierType: { type: 'raw:string', value: 'delta' }
    value: { type: 'raw:number', value: 0.1 }
    priority: { type: 'raw:number', value: 150 }
```

## 完整使用场景示例

### 场景：冰系精灵的能力增强

```yaml
# 1. 冰冻技能 - 使用带标签的配置值，自动注册
- id: ice_freeze_skill
  trigger: OnSkillUse
  priority: 100
  apply:
    type: addMark
    target: { base: target }
    mark: { type: 'entity:baseMark', value: 'freeze_mark' }
    probability:
      type: 'raw:number'
      value: 0.2
      configId: 'freeze_probability'
      tags: ['freeze', 'probability', 'ice']
    duration:
      type: 'raw:number'
      value: 2
      configId: 'freeze_duration'
      tags: ['freeze', 'duration', 'ice']

# 2. 冰锥术技能 - 使用带标签的伤害配置
- id: ice_shard_skill
  trigger: OnSkillUse
  priority: 100
  apply:
    type: dealDamage
    target: { base: target }
    damage:
      type: 'raw:number'
      value: 30
      configId: 'ice_shard_damage'
      tags: ['ice', 'damage']

# 2. 创建冰系掌控印记 - 增强所有冰系效果
- id: ice_mastery_effect
  trigger: OnMarkAdded
  priority: 100
  apply:
    type: addTaggedConfigModifier
    target: { base: self }
    tag: { type: 'raw:string', value: 'ice' }
    modifierType: { type: 'raw:string', value: 'delta' }
    value: 
      type: dynamic
      selector:
        base: self
        chain:
          - type: select
            arg:
              type: base
              arg: level
          - type: multiply
            arg: 0.02  # 每级增加2%
    priority: { type: 'raw:number', value: 100 }

# 3. 创建概率增强印记 - 增强所有概率类效果
- id: probability_enhancement_effect
  trigger: OnMarkAdded
  priority: 100
  apply:
    type: addTaggedConfigModifier
    target: { base: self }
    tag: { type: 'raw:string', value: 'probability' }
    modifierType: { type: 'raw:string', value: 'delta' }
    value: { type: 'raw:number', value: 0.05 }
    priority: { type: 'raw:number', value: 200 }
```

## API参考

### ConfigSystem方法

#### `registerTaggedConfig(key: string, initialValue: ConfigValue, tags: string[]): void`

注册一个带标签的配置键。

#### `addConfigTags(key: string, tags: string[]): void`

为现有配置键添加标签。

#### `removeConfigTags(key: string, tags: string[]): void`

从配置键中移除标签。

#### `getConfigKeysByTag(tag: string): string[]`

获取所有带有指定标签的配置键。

#### `getConfigTags(key: string): string[]`

获取指定配置键的所有标签。

#### `hasConfigTag(key: string, tag: string): boolean`

检查配置键是否有指定标签。

#### `addTaggedConfigModifier(...): (() => void)[]`

为所有带有指定标签的配置添加修改器，返回清理函数数组。

#### `addTaggedConfigModifierSingle(...): () => void`

为所有带有指定标签的配置添加修改器，返回单个清理函数。

### 操作符

#### `registerTaggedConfig`

注册带标签的配置。

#### `addTaggedConfigModifier`

为带有指定标签的所有配置添加修改器。

## 最佳实践

1. **标签命名规范**：使用有意义的标签名，如 `freeze`、`probability`、`damage` 等。

2. **标签分层**：可以使用多个标签来实现不同层次的分类，如 `['ice', 'freeze', 'probability']`。

3. **优先级管理**：为不同类型的修改器设置合适的优先级，确保修改顺序符合预期。

4. **生命周期绑定**：合理使用 `ConfigDurationType` 来控制修改器的生命周期。

5. **作用域控制**：使用 `scope` 参数来限制修改器的作用范围。
