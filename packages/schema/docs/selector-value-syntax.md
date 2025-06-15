# SelectorValue 语法设计

## 概述

新的 `SelectorValue` 语法允许 effectDsl 直接从 Value 产生 selector，而不需要依赖 BaseSelector。这提供了更灵活的数据选择方式。

## 语法结构

```typescript
export type SelectorValue = {
  type: 'selector'
  value: Value
  chain?: Array<SelectorChain>
}
```

## 使用场景

### 1. 从数值创建 selector

```json
{
  "type": "selector",
  "value": 100,
  "chain": [
    { "type": "add", "arg": 50 }
  ]
}
```

这会创建一个返回 `[150]` 的 selector。

### 2. 从数组创建 selector

```json
{
  "type": "selector",
  "value": [10, 20, 30],
  "chain": [
    { "type": "multiply", "arg": 2 }
  ]
}
```

这会创建一个返回 `[20, 40, 60]` 的 selector。

### 3. 从配置值创建 selector

```json
{
  "type": "selector",
  "value": {
    "type": "raw:number",
    "value": 75,
    "configId": "damage_base"
  },
  "chain": [
    { "type": "clampMax", "arg": 200 }
  ]
}
```

### 4. 从动态值创建 selector

```json
{
  "type": "selector",
  "value": {
    "type": "dynamic",
    "selector": {
      "base": "self",
      "chain": [
        { "type": "selectPath", "arg": "currentHp" }
      ]
    }
  },
  "chain": [
    { "type": "divide", "arg": 10 }
  ]
}
```

### 5. 从条件值创建 selector

```json
{
  "type": "selector",
  "value": {
    "type": "conditional",
    "condition": {
      "type": "evaluate",
      "target": "self",
      "evaluator": { "type": "compare", "operator": ">", "value": 50 }
    },
    "trueValue": 100,
    "falseValue": 50
  },
  "chain": [
    { "type": "multiply", "arg": 1.5 }
  ]
}
```

## 实际应用示例

### 伤害计算效果

```json
{
  "id": "damage_with_hp_scaling",
  "trigger": "OnDealDamage",
  "priority": 100,
  "apply": {
    "type": "dealDamage",
    "target": "target",
    "value": {
      "type": "selector",
      "value": {
        "type": "dynamic",
        "selector": {
          "base": "self",
          "chain": [{ "type": "selectPath", "arg": "currentHp" }]
        }
      },
      "chain": [
        { "type": "divide", "arg": 10 },
        { "type": "add", "arg": 50 },
        { "type": "clampMax", "arg": 200 }
      ]
    }
  }
}
```

这个效果会：
1. 获取自身当前HP
2. 除以10
3. 加上50
4. 限制最大值为200
5. 用结果作为伤害值

### 多值处理效果

```json
{
  "id": "multi_target_heal",
  "trigger": "OnTurnStart",
  "priority": 100,
  "apply": {
    "type": "heal",
    "target": "selfTeam",
    "value": {
      "type": "selector",
      "value": [20, 30, 40],
      "chain": [
        { "type": "randomPick", "arg": 1 }
      ]
    }
  }
}
```

这个效果会从 `[20, 30, 40]` 中随机选择一个值作为治疗量。

## 优势

1. **灵活性**：可以从任何 Value 类型创建 selector
2. **组合性**：支持链式操作进行数据转换
3. **一致性**：与现有的 selector 语法保持一致
4. **扩展性**：可以轻松添加新的数据源类型

## 类型推断

SelectorValue 创建的 selector 初始类型为 `'any'`，但可以通过链式操作进行类型推断：

- 数值操作（add, multiply, divide 等）会推断为 `number` 类型
- 数组操作会保持数组类型
- 特定的选择操作会推断为相应的实体类型

## 与现有语法的兼容性

SelectorValue 完全兼容现有的 effectDsl 语法，可以在任何需要 SelectorDSL 的地方使用。
