# 团队选择器 (Team Selectors)

本文档介绍新增的团队选择器功能，允许选择己方全队和敌方全队的精灵。

## 新增选择器

### `selfTeam` - 己方全队

选择效果拥有者的全队精灵（包括存活和濒死的精灵）。

### `opponentTeam` - 敌方全队  

选择效果拥有者对手的全队精灵（包括存活和濒死的精灵）。

## 基本用法

### 直接使用

```typescript
import { BaseSelector } from '@arcadia-eternity/effect-builder'

// 选择己方全队
const selfTeam = BaseSelector.selfTeam

// 选择敌方全队
const opponentTeam = BaseSelector.opponentTeam
```

### DSL中使用

```typescript
// 治疗己方全队
{
  type: 'heal',
  target: 'selfTeam',
  value: 50
}

// 对敌方全队造成伤害
{
  type: 'dealDamage',
  target: 'opponentTeam', 
  value: 30
}
```

## 链式操作

团队选择器支持所有标准的链式操作：

### 筛选存活的精灵

```typescript
{
  base: 'selfTeam',
  chain: [
    {
      type: 'where',
      arg: {
        type: 'compare',
        operator: '>',
        value: 0  // HP > 0
      }
    }
  ]
}
```

### 随机选择

```typescript
{
  base: 'opponentTeam',
  chain: [
    {
      type: 'randomPick',
      arg: 2  // 随机选择2个
    }
  ]
}
```

### 限制数量

```typescript
{
  base: 'selfTeam',
  chain: [
    {
      type: 'limit',
      arg: 3  // 最多3个
    }
  ]
}
```

## 实际应用示例

### 1. 群体治疗技能

```typescript
{
  id: 'group_heal',
  trigger: 'OnSkillUse',
  operator: {
    type: 'heal',
    target: 'selfTeam',
    value: 100
  }
}
```

### 2. 全体攻击技能

```typescript
{
  id: 'aoe_attack',
  trigger: 'OnSkillUse', 
  operator: {
    type: 'dealDamage',
    target: 'opponentTeam',
    value: 80
  }
}
```

### 3. 团队增益效果

```typescript
{
  id: 'team_buff',
  trigger: 'OnBattleStart',
  operator: {
    type: 'addMark',
    target: 'selfTeam',
    mark: { type: 'entity:baseMark', value: 'mark_attack_boost' },
    duration: 5
  }
}
```

### 4. 基于团队状态的动态效果

```typescript
{
  id: 'team_synergy',
  trigger: 'OnTurnStart',
  operator: {
    type: 'addRage',
    target: 'self',
    value: {
      type: 'dynamic',
      selector: {
        base: 'selfTeam',
        chain: [
          {
            type: 'where',
            arg: { type: 'compare', operator: '>', value: 0 }
          },
          {
            type: 'length'
          },
          {
            type: 'multiply',
            arg: 5
          }
        ]
      }
    }
  }
}
```

## 与现有选择器的区别

| 选择器 | 选择范围 | 数量 |
|--------|----------|------|
| `self` | 己方当前出战精灵 | 1个 |
| `opponent` | 敌方当前出战精灵 | 1个 |
| `selfTeam` | 己方全队精灵 | 多个 |
| `opponentTeam` | 敌方全队精灵 | 多个 |

## 注意事项

1. **包含所有精灵**: 团队选择器会选择队伍中的所有精灵，包括濒死的精灵
2. **链式筛选**: 如果只需要存活的精灵，请使用 `where` 条件进行筛选
3. **性能考虑**: 团队选择器可能返回多个目标，在设计效果时要考虑性能影响
4. **上下文依赖**: 选择器的行为依赖于效果的上下文（技能使用或印记效果）

## 技术实现

团队选择器的实现遵循现有的选择器模式：

- 支持 `UseSkillContext` 和 `Pet ownership` 两种上下文
- 返回 `Pet[]` 数组
- 使用扩展运算符 `[...team]` 创建副本避免直接修改原数组
- 完全兼容现有的链式操作系统
