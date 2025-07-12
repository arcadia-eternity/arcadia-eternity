# @arcadia-eternity/rules

游戏规则系统包，提供灵活、可扩展的规则管理和验证功能。

## 功能特性

- 🎯 **灵活的规则系统** - 支持各种游戏规则的定义和组合
- 🔧 **可扩展架构** - 易于添加新的规则类型和规则集
- ✅ **完整的验证** - 队伍、精灵、技能、印记的全面验证
- 🎮 **多种游戏模式** - 预定义的标准、竞技、休闲等模式
- 🔗 **系统集成** - 与战斗系统、计时器、队伍构建器无缝集成
- 📊 **详细反馈** - 提供详细的错误信息和修复建议

## 安装

```bash
npm install @arcadia-eternity/rules
```

## 快速开始

### 基本使用

```typescript
import { createRuleSystemWithDefaults, getRecommendedRuleSets } from '@arcadia-eternity/rules'

// 创建规则系统
const { ruleSystem, registry } = createRuleSystemWithDefaults()

// 获取推荐的规则集
const ruleSetIds = getRecommendedRuleSets('competitive')

// 激活规则集
for (const ruleSetId of ruleSetIds) {
  ruleSystem.activateRuleSet(ruleSetId)
}

// 验证队伍
const validation = ruleSystem.validateTeam(team)
if (!validation.isValid) {
  console.log('验证失败:', validation.errors)
}
```

### 战斗系统集成

```typescript
import { BattleIntegration } from '@arcadia-eternity/rules'

const battleIntegration = new BattleIntegration()

// 准备战斗
const result = await battleIntegration.prepareBattle(
  playerATeam,
  playerBTeam,
  ['competitive_ruleset'],
  { allowFaintSwitch: true }
)

if (result.validation.isValid) {
  // 创建战斗实例
  const battle = new Battle(
    playerA,
    playerB,
    result.battleOptions
  )
}
```

### 队伍构建器集成

```typescript
import { TeamBuilderIntegration } from '@arcadia-eternity/rules'

const teamBuilder = new TeamBuilderIntegration()

// 验证队伍
const validation = teamBuilder.validateTeam(team, ['casual_standard_ruleset'])

// 获取构建建议
const suggestions = teamBuilder.getTeamBuildingSuggestions(team, ['casual_standard_ruleset'])

// 自动修复队伍
const { fixedTeam, changes } = teamBuilder.autoFixTeam(team, ['casual_standard_ruleset'])
```

## 核心概念

### 规则 (Rule)

规则是系统的基本单元，定义了特定的游戏限制或修改：

```typescript
import { AbstractRule } from '@arcadia-eternity/rules'

class CustomRule extends AbstractRule {
  validateTeam(team: Team): ValidationResult {
    // 实现验证逻辑
  }
  
  modifyPet(pet: PetSchemaType): void {
    // 实现修改逻辑
  }
}
```

### 规则集 (RuleSet)

规则集是规则的集合，代表特定的游戏模式：

```typescript
import { RuleSetImpl } from '@arcadia-eternity/rules'

const customRuleSet = new RuleSetImpl('custom_rules', '自定义规则集')
customRuleSet.addRule(new CustomRule())
```

### 规则系统 (RuleSystem)

规则系统管理规则集的激活和应用：

```typescript
const ruleSystem = new RuleSystem()
ruleSystem.activateRuleSet('competitive_ruleset')
const validation = ruleSystem.validateTeam(team)
```

## 预定义规则集

### 可用规则集

- `casual_standard_ruleset` - 休闲标准规则，适合日常对战
- `competitive_ruleset` - 竞技规则，严格的竞技对战规则集

## 规则类型

### 基础规则

- **TeamSizeRule** - 队伍大小限制
- **LevelLimitRule** - 等级限制
- **BanRule** - 禁用特定内容

### 竞技规则

- **EVLimitRule** - 学习力限制
- **TimerRule** - 计时器配置
- **PetSpeciesUniqueRule** - 精灵种族唯一性检查

### 特殊规则

- **ElementRestrictionRule** - 属性限制

## 系统集成

### 战斗系统集成

```typescript
import { BattleIntegration } from '@arcadia-eternity/rules'

const integration = new BattleIntegration()
// 战斗准备、规则应用、操作验证
```

### 计时器系统集成

```typescript
import { TimerIntegration } from '@arcadia-eternity/rules'

const integration = new TimerIntegration()
// 计时器配置修改、验证
```

### 队伍构建器集成

```typescript
import { TeamBuilderIntegration } from '@arcadia-eternity/rules'

const integration = new TeamBuilderIntegration()
// 队伍验证、构建建议、自动修复
```

## 自定义规则

### 创建自定义规则

```typescript
import { AbstractRule, ValidationResult } from '@arcadia-eternity/rules'

class MyCustomRule extends AbstractRule {
  constructor() {
    super('my_custom_rule', '我的自定义规则', {
      description: '这是一个自定义规则示例',
      tags: ['custom', 'example'],
    })
  }

  validateTeam(team: Team): ValidationResult {
    // 实现验证逻辑
    if (team.length > 3) {
      return createFailureResult([{
        type: ValidationErrorType.TEAM_VALIDATION,
        code: 'TOO_MANY_PETS',
        message: '队伍精灵数量不能超过3只',
      }])
    }
    return createSuccessResult()
  }
}
```

### 注册自定义规则

```typescript
import { RuleRegistry } from '@arcadia-eternity/rules'

const registry = RuleRegistry.getInstance()
registry.registerRule(new MyCustomRule())
```

## API 文档

详细的 API 文档请参考 TypeScript 类型定义文件。

## 示例

查看 `src/examples/` 目录中的完整示例代码。

## 许可证

MIT License
