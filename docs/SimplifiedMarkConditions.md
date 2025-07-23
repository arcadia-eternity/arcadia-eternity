# 简化版印记判断语法

## 概述

为了简化condition系统中判断印记存在的语法，我们新增了两个专用的condition类型：
- `selfHasMark` - 判断自己是否有指定baseId的印记
- `opponentHasMark` - 判断对手是否有指定baseId的印记

## 语法对比

### 旧语法（复杂）

```yaml
condition:
  type: evaluate
  target:
    base: selfMarks
    chain:
      - type: whereAttr
        extractor:
          type: base
          arg: baseId
        evaluator:
          type: same
          value: mark_liuxie
  evaluator:
    type: exist
```

或者：

```yaml
condition:
  type: evaluate
  target:
    base: selfMarks
    chain:
      - type: selectPath
        arg: baseId
      - type: where
        arg:
          type: same
          value: mark_meihuo
  evaluator:
    type: exist
```

### 新语法（简化）

```yaml
condition:
  type: selfHasMark
  baseId: mark_liuxie
```

```yaml
condition:
  type: opponentHasMark
  baseId: mark_meihuo
```

## 使用示例

### 基本用法

```yaml
# 自己有流血印记时，技能伤害翻倍
- id: effect_double_damage_if_bleeding
  trigger: OnSkillUse
  priority: 100
  apply:
    type: dealDamage
    target: { base: target }
    value: 100
  condition:
    type: selfHasMark
    baseId: mark_liuxie

# 对手有樱花印记时，技能必中
- id: effect_sure_hit_if_opponent_has_sakura
  trigger: AfterUseSkillCheck
  priority: 100
  apply:
    type: setSureHit
    target: useSkillContext
    priority: 2
  condition:
    type: opponentHasMark
    baseId: mark_yinghua
```

### 组合使用

```yaml
# 自己有能量印记且对手有中毒印记时触发
- id: effect_combo_condition
  trigger: OnSkillUse
  priority: 100
  apply:
    type: dealDamage
    target: { base: target }
    value: 150
  condition:
    type: every
    conditions:
      - type: selfHasMark
        baseId: mark_nengliang
      - type: opponentHasMark
        baseId: mark_zhongdu
```

### 否定判断

```yaml
# 自己没有能量印记时，添加能量印记
- id: effect_add_energy_if_missing
  trigger: OnSkillUse
  priority: 100
  apply:
    type: addMark
    target: { base: self }
    mark: { type: 'entity:baseMark', value: 'mark_nengliang' }
  condition:
    type: not
    condition:
      type: selfHasMark
      baseId: mark_nengliang
```

### 动态baseId

```yaml
# 根据技能ID动态判断对应的印记
- id: effect_dynamic_mark_check
  trigger: OnSkillUse
  priority: 100
  apply:
    type: heal
    target: { base: self }
    value: 30
  condition:
    type: selfHasMark
    baseId:
      type: dynamic
      selector:
        base: useSkillContext
        chain:
          - type: selectPath
            arg: skill
          - type: selectPath
            arg: baseId
          - type: replace
            arg: 'skill_'
            with: 'mark_'
```

## 实现细节

### 新增的Condition函数

```typescript
// 检查自己是否有指定baseId的印记
selfHasMark: (baseId: ValueSource<string>): Condition => {
  return context => {
    if (context.source.owner instanceof Pet) {
      const _baseId = GetValueFromSource(context, baseId)
      if (_baseId.length === 0) return false
      return context.source.owner.marks.some(mark => mark.baseId === _baseId[0])
    }
    return false
  }
}

// 检查对手是否有指定baseId的印记
opponentHasMark: (baseId: ValueSource<string>): Condition => {
  return context => {
    let opponentPet: Pet
    if (context.parent instanceof UseSkillContext) {
      opponentPet = context.parent.actualTarget!
    } else if (context.source.owner instanceof Pet) {
      opponentPet = context.battle.getOpponent(context.source.owner.owner!).activePet
    } else {
      return false
    }
    
    const _baseId = GetValueFromSource(context, baseId)
    if (_baseId.length === 0) return false
    return opponentPet.marks.some(mark => mark.baseId === _baseId[0])
  }
}
```

### DSL Schema支持

```typescript
// 在ConditionDSL中新增的类型
| {
    type: 'selfHasMark'
    baseId: Value
  }
| {
    type: 'opponentHasMark'
    baseId: Value
  }
```

## 优势

1. **简洁性**：将原本需要7-10行的复杂condition简化为2-3行
2. **可读性**：语义更加清晰，一眼就能看出是在判断印记存在
3. **维护性**：减少了嵌套结构，降低了出错概率
4. **一致性**：提供了统一的印记判断接口

## 兼容性

- 新语法与现有的condition系统完全兼容
- 旧的复杂语法仍然可以正常使用
- 可以在同一个effect中混合使用新旧语法

## 使用建议

- 对于简单的印记存在判断，推荐使用新的简化语法
- 对于需要获取印记属性（如stack数量）的场景，仍需使用原有的selector链式语法
- 在复杂的逻辑判断中，可以将简化语法与其他condition类型组合使用
