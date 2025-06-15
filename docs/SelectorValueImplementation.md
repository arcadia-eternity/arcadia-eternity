# SelectorValue 语法实现总结

## 概述

我们成功设计并实现了一种新的语法，让 effectDsl 能够直接从 Value 产生 selector，而不需要依赖 BaseSelector。这个新功能通过引入 `SelectorValue` 类型来实现。

## 实现的文件修改

### 1. 类型定义 (`packages/schema/src/effectDsl.ts`)

添加了新的 `SelectorValue` 类型：

```typescript
export type SelectorValue = {
  type: 'selector'
  value: Value
  chain?: Array<SelectorChain>
}
```

并将其添加到 `Value` 和 `SelectorDSL` 联合类型中。

### 2. Schema 验证 (`packages/schema/src/effectSchema.ts`)

添加了 `selectorValueSchema` 来验证新的语法结构，并将其集成到现有的 schema 系统中。

### 3. 解析器实现 (`packages/parser/src/parseEffect.ts`)

- 更新了 `parseSelector` 函数以支持 `SelectorValue` 类型
- 实现了 `createSelectorFromValue` 函数来将 Value 转换为 ChainableSelector
- 更新了 `parseValue` 函数以处理 `SelectorValue` 类型

## 核心功能

### 1. 从任意 Value 创建 Selector

```json
{
  "type": "selector",
  "value": 100,
  "chain": [
    { "type": "add", "arg": 50 },
    { "type": "multiply", "arg": 2 }
  ]
}
```

### 2. 支持所有 Value 类型

- 原始值 (number, string, boolean)
- 配置值 (RawNumberValue, RawStringValue, RawBooleanValue)
- 实体引用 (RawBaseMarkIdValue, RawBaseSkillIdValue)
- 动态值 (DynamicValue)
- 条件值 (ConditionalValue)
- 数组值 (Array<Value>)

### 3. 链式操作支持

支持所有现有的 SelectorChain 操作：
- 数学运算 (add, multiply, divide, sum)
- 数组操作 (randomPick, randomSample, limit, shuffled)
- 条件操作 (clampMax, clampMin)
- 选择操作 (select, selectPath, selectProp)
- 过滤操作 (where, whereAttr)
- 逻辑操作 (and, or, flat)

## 使用示例

### 基础数值计算

```json
{
  "type": "dealDamage",
  "target": "target",
  "value": {
    "type": "selector",
    "value": 50,
    "chain": [
      { "type": "multiply", "arg": 1.5 },
      { "type": "clampMax", "arg": 100 }
    ]
  }
}
```

### HP 比例伤害

```json
{
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
      { "type": "add", "arg": 30 },
      { "type": "clampMax", "arg": 150 }
    ]
  }
}
```

### 随机值选择

```json
{
  "type": "heal",
  "target": "self",
  "value": {
    "type": "selector",
    "value": [20, 30, 40, 50],
    "chain": [
      { "type": "randomPick", "arg": 1 }
    ]
  }
}
```

### 条件值计算

```json
{
  "type": "addAttributeModifier",
  "target": "self",
  "stat": "atk",
  "modifierType": "percent",
  "value": {
    "type": "selector",
    "value": {
      "type": "conditional",
      "condition": {
        "type": "evaluate",
        "target": "self",
        "evaluator": { "type": "compare", "operator": "<", "value": 30 }
      },
      "trueValue": 50,
      "falseValue": 20
    }
  }
}
```

## 优势

1. **灵活性**：可以从任何 Value 类型创建 selector
2. **组合性**：支持复杂的链式操作进行数据转换
3. **一致性**：与现有的 selector 语法完全兼容
4. **扩展性**：可以轻松添加新的数据源类型
5. **类型安全**：完整的 TypeScript 类型支持和 Zod schema 验证

## 向后兼容性

这个新功能完全向后兼容，不会影响现有的 effectDsl 代码。所有现有的语法仍然有效，新的 `SelectorValue` 语法是一个额外的选项。

## 测试

创建了完整的测试套件来验证新功能的正确性，包括：
- 基础 SelectorValue 验证
- 数组值处理
- 动态值处理
- 条件值处理
- 配置值处理
- 复杂的多层操作

## 文档

提供了详细的文档和示例：
- `packages/schema/docs/selector-value-syntax.md` - 语法说明文档
- `packages/schema/examples/selector-value-examples.ts` - 使用示例
- `packages/schema/test/selector-value.test.ts` - 测试用例

这个实现成功地解决了用户的需求，提供了一种直接从 Value 产生 selector 的语法，而不需要依赖 BaseSelector，大大增强了 effectDsl 的灵活性和表达能力。
