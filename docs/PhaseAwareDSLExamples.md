# Phase-Aware DSL Examples

## 🎯 概述

现在effectBuilder完全支持phase-aware功能的DSL语法！您可以在DSL中使用新的phase-aware参数来创建精确控制的效果。

## 🆕 新增的DSL参数

所有支持phase-aware的operator现在都接受以下可选参数：

```typescript
{
  // 原有参数保持不变...

  // 🆕 Phase-aware参数 (全部可选)
  phaseType?: Value,    // 'turn' | 'skill' | 'damage' | 'heal' | 'effect' | 'switch' | 'mark' | 'rage' | 'battle'
  scope?: Value,        // 'current' | 'any' | 'next'
  phaseId?: Value,      // 特定phase的ID (如技能ID)
}
```

## 📋 支持的Operators

### 1. addAttributeModifier

```yaml
type: addAttributeModifier
target: { base: self }
stat: { type: 'raw:string', value: 'attack' }
modifierType: { type: 'raw:string', value: 'delta' }
value: { type: 'raw:number', value: 50 }
priority: { type: 'raw:number', value: 100 }
# 🆕 Phase-aware参数
phaseType: { type: 'raw:string', value: 'skill' }
scope: { type: 'raw:string', value: 'current' }
```

### 2. addDynamicAttributeModifier

```yaml
type: addDynamicAttributeModifier
target: { base: self }
stat: { type: 'raw:string', value: 'defense' }
modifierType: { type: 'raw:string', value: 'percent' }
observableValue:
  base: self
  chain:
    - type: selectAttribute$
      arg: attack
    - type: multiply
      arg: { type: 'raw:number', value: 0.5 }
priority: { type: 'raw:number', value: 100 }
# 🆕 Phase-aware参数
phaseType: { type: 'raw:string', value: 'damage' }
scope: { type: 'raw:string', value: 'current' }
```

### 3. addClampModifier (合并后的统一operator)

```yaml
type: addClampModifier
target: { base: self }
stat: { type: 'raw:string', value: 'speed' }
minValue: { type: 'raw:number', value: 50 } # 可选
maxValue: { type: 'raw:number', value: 200 } # 可选
priority: { type: 'raw:number', value: 100 }
# 🆕 Phase-aware参数
phaseType: { type: 'raw:string', value: 'turn' }
scope: { type: 'raw:string', value: 'current' }
```

### 4. addSkillAttributeModifier

```yaml
type: addSkillAttributeModifier
target:
  base: self
  chain:
    - type: select
      arg: skills
attribute: { type: 'raw:string', value: 'power' }
modifierType: { type: 'raw:string', value: 'delta' }
value: { type: 'raw:number', value: 25 }
priority: { type: 'raw:number', value: 100 }
# 🆕 Phase-aware参数
phaseType: { type: 'raw:string', value: 'skill' }
scope: { type: 'raw:string', value: 'current' }
```

## 🎮 实际使用示例

### 示例1：技能增强印记

```yaml
id: skill_attack_boost_mark
trigger: OnTurnStart
priority: 100
apply:
  type: addAttributeModifier
  target: { base: self }
  stat: { type: 'raw:string', value: 'attack' }
  modifierType: { type: 'raw:string', value: 'delta' }
  value: { type: 'raw:number', value: 50 }
  priority: { type: 'raw:number', value: 100 }
  # 只在使用技能时生效
  phaseType: { type: 'raw:string', value: 'skill' }
  scope: { type: 'raw:string', value: 'current' }
```

### 示例2：防护印记

```yaml
id: damage_defense_boost_mark
trigger: OnTurnStart
priority: 100
apply:
  type: addAttributeModifier
  target: { base: self }
  stat: { type: 'raw:string', value: 'defense' }
  modifierType: { type: 'raw:string', value: 'delta' }
  value: { type: 'raw:number', value: 30 }
  priority: { type: 'raw:number', value: 100 }
  # 只在受到伤害时生效
  phaseType: { type: 'raw:string', value: 'damage' }
  scope: { type: 'raw:string', value: 'current' }
```

### 示例3：特定技能增强

```yaml
id: fire_blast_power_boost
trigger: OnTurnStart
priority: 100
apply:
  type: addSkillAttributeModifier
  target:
    base: self
    chain:
      - type: select
        arg: skills
  attribute: { type: 'raw:string', value: 'power' }
  modifierType: { type: 'raw:string', value: 'delta' }
  value: { type: 'raw:number', value: 100 }
  priority: { type: 'raw:number', value: 100 }
  # 只对火焰爆炸技能生效
  phaseType: { type: 'raw:string', value: 'skill' }
  scope: { type: 'raw:string', value: 'current' }
  phaseId: { type: 'raw:string', value: 'fire_blast' }
```

### 示例4：动态属性修改

```yaml
id: reactive_speed_boost
trigger: OnTurnStart
priority: 100
apply:
  type: addDynamicAttributeModifier
  target: { base: self }
  stat: { type: 'raw:string', value: 'speed' }
  modifierType: { type: 'raw:string', value: 'percent' }
  observableValue:
    base: self
    chain:
      - type: selectAttribute$
        arg: attack
      - type: multiply
        arg: { type: 'raw:number', value: 0.1 }
  priority: { type: 'raw:number', value: 100 }
  # 只在回合中生效
  phaseType: { type: 'raw:string', value: 'turn' }
  scope: { type: 'raw:string', value: 'current' }
```

### 示例5：限制属性范围

```yaml
id: skill_attack_clamp
trigger: OnTurnStart
priority: 100
apply:
  type: addClampModifier
  target: { base: self }
  stat: { type: 'raw:string', value: 'attack' }
  minValue: { type: 'raw:number', value: 50 }
  maxValue: { type: 'raw:number', value: 200 }
  priority: { type: 'raw:number', value: 100 }
  # 只在技能使用时限制范围
  phaseType: { type: 'raw:string', value: 'skill' }
  scope: { type: 'raw:string', value: 'current' }
```

### 示例6：最小值限制

```yaml
id: min_defense_protection
trigger: OnTurnStart
priority: 100
apply:
  type: addClampModifier
  target: { base: self }
  stat: { type: 'raw:string', value: 'defense' }
  minValue: { type: 'raw:number', value: 30 }
  # maxValue省略 - 只限制最小值
  priority: { type: 'raw:number', value: 100 }
  phaseType: { type: 'raw:string', value: 'damage' }
  scope: { type: 'raw:string', value: 'current' }
```

### 示例7：最大值限制

```yaml
id: max_attack_cap
trigger: OnTurnStart
priority: 100
apply:
  type: addClampModifier
  target: { base: self }
  stat: { type: 'raw:string', value: 'attack' }
  # minValue省略 - 只限制最大值
  maxValue: { type: 'raw:number', value: 999 }
  priority: { type: 'raw:number', value: 100 }
  phaseType: { type: 'raw:string', value: 'skill' }
  scope: { type: 'raw:string', value: 'current' }
```

## ✅ 向后兼容性

所有现有的DSL都保持完全兼容！新的phase-aware参数都是可选的：

```yaml
# 这个DSL仍然有效，行为与之前完全相同
id: regular_attack_boost
trigger: OnTurnStart
priority: 100
apply:
  type: addAttributeModifier
  target: { base: self }
  stat: { type: 'raw:string', value: 'attack' }
  modifierType: { type: 'raw:string', value: 'delta' }
  value: { type: 'raw:number', value: 30 }
  priority: { type: 'raw:number', value: 100 }
  # 没有phase参数 - 使用常规binding模式
```

## 🎯 总结

现在您可以在DSL中使用phase-aware功能来创建：

1. **精确时机控制** - modifier只在特定phase中生效
2. **特定技能增强** - 通过phaseId指定特定技能
3. **灵活的clamp操作** - 支持min-only、max-only或both
4. **动态响应式modifier** - 基于Observable的实时更新
5. **完全向后兼容** - 现有DSL无需修改

这为游戏效果系统提供了极其精确和灵活的控制能力！🎊
