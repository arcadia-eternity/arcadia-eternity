# BattleState Modifier 信息显示功能实现

## 概述

本次改造为 BattleState 添加了 modifier 信息显示功能，让客户端能够查看到哪些值受到了 modifier 的影响。这个功能对于游戏的透明度和调试都非常有用。

## 实现的功能

### 1. 新增接口定义

在 `packages/const/src/message.ts` 中新增了以下接口：

- `ModifierInfo`: 单个修改器的详细信息
- `AttributeModifierInfo`: 单个属性的修改信息
- `EntityModifierState`: 实体（Pet/Player）的完整修改器状态
- 扩展了 `PetMessage` 和 `PlayerMessage` 接口，添加了可选的 `modifierState` 字段

### 2. AttributeSystem 增强

在 `packages/battle/src/attributeSystem.ts` 中添加了：

- `getDetailedModifierState()` 方法：提取当前活跃的 modifier 信息
- 支持识别 modifier 来源类型（mark、skill、other）
- 按优先级排序 modifier 信息，与实际应用顺序一致
- 包含基础值、当前值、修改器详情等完整信息

### 3. 实体消息更新

更新了 Pet 和 Player 的 `toMessage` 方法：

- **Pet**: 只有在显示详细信息且是自己的宠物或显示隐藏信息时才包含 modifier 状态
- **Player**: 只有在是自己或显示隐藏信息时才包含 modifier 状态

### 4. 可见性控制

实现了细粒度的可见性控制：

- 对手无法看到你的 modifier 详情，保持游戏策略性
- 自己可以看到自己宠物和玩家的完整 modifier 信息
- 观战模式或调试模式下可以显示所有信息

## 数据结构示例

```typescript
// ModifierInfo - 单个修改器信息
{
  id: "skill-atk-buff",
  type: "percent",
  value: 50,
  priority: 1,
  sourceType: "skill",
  sourceId: "skill-123",
  sourceName: "力量增幅"
}

// AttributeModifierInfo - 属性修改信息
{
  attributeName: "atk",
  baseValue: 100,
  currentValue: 170,
  modifiers: [ModifierInfo, ...],
  isModified: true
}

// EntityModifierState - 实体修改器状态
{
  attributes: [AttributeModifierInfo, ...],
  hasModifiers: true
}
```

## 使用场景

### 1. 客户端 UI 显示

客户端可以使用这些信息来：
- 显示属性值的详细计算过程
- 高亮显示被修改的属性
- 展示 modifier 来源和效果
- 提供更好的游戏体验和透明度

### 2. 调试和开发

开发者可以使用这些信息来：
- 调试 modifier 系统的行为
- 验证 modifier 应用顺序
- 检查 modifier 来源和优先级
- 分析战斗中的数值变化

### 3. 战斗分析

玩家可以使用这些信息来：
- 了解自己宠物的当前状态
- 分析 buff/debuff 的效果
- 制定更好的战斗策略

## 性能考虑

- modifier 信息只在需要时计算（按需生成）
- 使用可见性控制减少不必要的数据传输
- 信息结构紧凑，避免冗余数据

## 测试覆盖

实现了完整的测试覆盖：
- 空 modifier 状态测试
- 多个 modifier 应用测试
- modifier 来源信息测试
- clamp modifier 测试

## 向后兼容性

- 新增字段都是可选的，不影响现有代码
- 现有的 `toMessage` 方法行为保持不变
- 只有在明确请求时才包含 modifier 信息

## 未来扩展

这个基础设施为未来的功能扩展提供了可能：
- 实时 modifier 变化通知
- modifier 历史记录
- 更详细的 modifier 分析工具
- 自定义 modifier 显示规则
