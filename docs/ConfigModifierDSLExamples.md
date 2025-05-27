# Config Modifier DSL Examples

## 🎯 概述

现在effectBuilder完全支持config modifier功能的DSL语法！您可以在DSL中使用config modifier来动态修改游戏配置值，支持多种修改策略和phase-aware功能。

## 🔍 Scope-Aware Config System

Config modifier系统是**scope-aware**的，这意味着：

1. **Modifier的scope由其source决定** - 如果modifier来自Pet的Mark，则它的scope是该Pet
2. **Config获取时考虑scope层级** - 当获取配置值时，系统会根据当前scope过滤适用的modifier
3. **Scope层级关系** - Battle > Player > Pet > Mark/Skill
4. **只有同级或上级的modifier会生效** - Pet级别的modifier不会影响Player或Battle级别的配置获取

### Scope工作原理

```typescript
// 当Pet获取配置时，会应用：
// 1. 来自该Pet的modifier
// 2. 来自该Pet的Player的modifier
// 3. 来自Battle的modifier
// 4. 全局modifier

// 当Player获取配置时，会应用：
// 1. 来自该Player的modifier
// 2. 来自Battle的modifier
// 3. 全局modifier

// 当Battle获取配置时，会应用：
// 1. 来自Battle的modifier
// 2. 全局modifier
```

## 🆕 Config Modifier Types

Config modifier支持以下修改类型：

```typescript
modifierType: 'override' | 'delta' | 'append' | 'prepend'
```

- **override**: 完全覆盖原值
- **delta**: 数值增减（仅适用于数字类型）
- **append**: 字符串末尾追加（仅适用于字符串类型）
- **prepend**: 字符串开头添加（仅适用于字符串类型）

## 📋 支持的Config Operators

### 1. addConfigModifier - 基础配置修改器

```yaml
type: addConfigModifier
target: { base: self }
configKey: { type: 'raw:string', value: 'damage.multiplier' }
modifierType: { type: 'raw:string', value: 'delta' }
value: { type: 'raw:number', value: 0.5 }
priority: { type: 'raw:number', value: 100 }
```

### 2. addDynamicConfigModifier - 动态配置修改器

```yaml
type: addDynamicConfigModifier
target: { base: self }
configKey: { type: 'raw:string', value: 'heal.effectiveness' }
modifierType: { type: 'raw:string', value: 'override' }
observableValue:
  base: self
  chain:
    - type: selectAttribute$
      arg: attack
    - type: multiply
      arg: { type: 'raw:number', value: 0.1 }
priority: { type: 'raw:number', value: 100 }
```

### 3. registerConfig - 注册配置项

```yaml
type: registerConfig
target: { base: self }
configKey: { type: 'raw:string', value: 'custom.setting' }
initialValue: { type: 'raw:string', value: 'default_value' }
```

### 4. addPhaseConfigModifier - Phase级配置修改器

```yaml
type: addPhaseConfigModifier
target: { base: currentPhase }
configKey: { type: 'raw:string', value: 'phase.modifier' }
modifierType: { type: 'raw:string', value: 'append' }
value: { type: 'raw:string', value: '_enhanced' }
priority: { type: 'raw:number', value: 100 }
```

### 5. addPhaseDynamicConfigModifier - Phase级动态配置修改器

```yaml
type: addPhaseDynamicConfigModifier
target: { base: currentPhase }
configKey: { type: 'raw:string', value: 'phase.dynamic' }
modifierType: { type: 'raw:string', value: 'prepend' }
observableValue:
  base: self
  chain:
    - type: selectAttribute$
      arg: speed
    - type: divide
      arg: { type: 'raw:number', value: 10 }
priority: { type: 'raw:number', value: 100 }
```

### 6. addPhaseTypeConfigModifier - Phase类型配置修改器

```yaml
type: addPhaseTypeConfigModifier
target: { base: self }
configKey: { type: 'raw:string', value: 'skill.power.modifier' }
modifierType: { type: 'raw:string', value: 'delta' }
value: { type: 'raw:number', value: 25 }
phaseType: { type: 'raw:string', value: 'skill' }
scope: { type: 'raw:string', value: 'current' }
priority: { type: 'raw:number', value: 100 }
phaseId: { type: 'raw:string', value: 'fire_blast' }  # 可选：特定phase ID
```

### 7. addDynamicPhaseTypeConfigModifier - 动态Phase类型配置修改器

```yaml
type: addDynamicPhaseTypeConfigModifier
target: { base: self }
configKey: { type: 'raw:string', value: 'damage.reduction' }
modifierType: { type: 'raw:string', value: 'override' }
observableValue:
  base: self
  chain:
    - type: selectAttribute$
      arg: defense
    - type: multiply
      arg: { type: 'raw:number', value: 0.01 }
phaseType: { type: 'raw:string', value: 'damage' }
scope: { type: 'raw:string', value: 'current' }
priority: { type: 'raw:number', value: 100 }
```

## 🎮 实际使用示例

### 示例1：伤害倍率修改

```yaml
id: damage_multiplier_boost
trigger: OnTurnStart
priority: 100
apply:
  type: addConfigModifier
  target: { base: self }
  configKey: { type: 'raw:string', value: 'damage.multiplier' }
  modifierType: { type: 'raw:string', value: 'delta' }
  value: { type: 'raw:number', value: 0.3 }  # 增加30%伤害
  priority: { type: 'raw:number', value: 100 }
```

### 示例2：技能名称修改

```yaml
id: skill_name_enhancement
trigger: OnTurnStart
priority: 100
apply:
  type: addConfigModifier
  target: { base: self }
  configKey: { type: 'raw:string', value: 'skill.display.name' }
  modifierType: { type: 'raw:string', value: 'append' }
  value: { type: 'raw:string', value: ' (Enhanced)' }
  priority: { type: 'raw:number', value: 100 }
```

### 示例3：动态治疗效果

```yaml
id: dynamic_heal_effectiveness
trigger: OnTurnStart
priority: 100
apply:
  type: addDynamicConfigModifier
  target: { base: self }
  configKey: { type: 'raw:string', value: 'heal.effectiveness' }
  modifierType: { type: 'raw:string', value: 'override' }
  observableValue:
    base: self
    chain:
      - type: selectAttribute$
        arg: attack
      - type: multiply
        arg: { type: 'raw:number', value: 0.1 }
  priority: { type: 'raw:number', value: 100 }
```

### 示例4：技能阶段特定修改

```yaml
id: skill_phase_power_boost
trigger: OnTurnStart
priority: 100
apply:
  type: addPhaseTypeConfigModifier
  target: { base: self }
  configKey: { type: 'raw:string', value: 'skill.power.modifier' }
  modifierType: { type: 'raw:string', value: 'delta' }
  value: { type: 'raw:number', value: 25 }
  phaseType: { type: 'raw:string', value: 'skill' }
  scope: { type: 'raw:string', value: 'current' }
  priority: { type: 'raw:number', value: 100 }
```

### 示例5：特定技能增强

```yaml
id: fire_blast_specific_enhancement
trigger: OnTurnStart
priority: 100
apply:
  type: addPhaseTypeConfigModifier
  target: { base: self }
  configKey: { type: 'raw:string', value: 'fire.skill.boost' }
  modifierType: { type: 'raw:string', value: 'delta' }
  value: { type: 'raw:number', value: 50 }
  phaseType: { type: 'raw:string', value: 'skill' }
  scope: { type: 'raw:string', value: 'current' }
  priority: { type: 'raw:number', value: 100 }
  phaseId: { type: 'raw:string', value: 'fire_blast' }
```

### 示例6：伤害阶段防护

```yaml
id: damage_phase_protection
trigger: OnTurnStart
priority: 100
apply:
  type: addDynamicPhaseTypeConfigModifier
  target: { base: self }
  configKey: { type: 'raw:string', value: 'damage.reduction' }
  modifierType: { type: 'raw:string', value: 'override' }
  observableValue:
    base: self
    chain:
      - type: selectAttribute$
        arg: defense
      - type: multiply
        arg: { type: 'raw:number', value: 0.01 }
  phaseType: { type: 'raw:string', value: 'damage' }
  scope: { type: 'raw:string', value: 'current' }
  priority: { type: 'raw:number', value: 100 }
```

### 示例7：配置注册

```yaml
id: register_custom_config
trigger: OnTurnStart
priority: 100
apply:
  type: registerConfig
  target: { base: self }
  configKey: { type: 'raw:string', value: 'custom.battle.mode' }
  initialValue: { type: 'raw:string', value: 'normal' }
```

## 🔄 Modifier类型详解

### Override - 完全覆盖

```yaml
modifierType: { type: 'raw:string', value: 'override' }
value: { type: 'raw:number', value: 100 }
# 原值: 50 → 结果: 100
```

### Delta - 数值增减

```yaml
modifierType: { type: 'raw:string', value: 'delta' }
value: { type: 'raw:number', value: 25 }
# 原值: 50 → 结果: 75
```

### Append - 末尾追加

```yaml
modifierType: { type: 'raw:string', value: 'append' }
value: { type: 'raw:string', value: '_enhanced' }
# 原值: "skill" → 结果: "skill_enhanced"
```

### Prepend - 开头添加

```yaml
modifierType: { type: 'raw:string', value: 'prepend' }
value: { type: 'raw:string', value: 'super_' }
# 原值: "skill" → 结果: "super_skill"
```

## 🎯 总结

现在您可以在DSL中使用config modifier功能来：

1. **动态修改配置值** - 支持数字、字符串等类型
2. **Phase-aware修改** - 只在特定phase中生效
3. **Observable响应式修改** - 基于实时数据动态更新
4. **多种修改策略** - override、delta、append、prepend
5. **优先级控制** - 通过priority参数控制修改顺序
6. **特定目标支持** - 可以指定特定phase ID

这为游戏的配置系统提供了极其灵活和强大的动态修改能力！🎊
