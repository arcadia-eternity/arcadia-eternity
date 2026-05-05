# ELO匹配系统集成指南

## 概述

已成功为匹配框架集成ELO评级系统，支持为特定规则集启用ELO匹配功能。系统采用策略模式设计，支持灵活的匹配算法配置。

## 核心特性

### 🎯 规则集级别的匹配策略

- **休闲模式** (`casual_standard_ruleset`): FIFO匹配 - 简单快速
- **竞技模式** (`competitive_ruleset`): ELO匹配 - 技能平衡
- **自定义规则集**: 可配置任意匹配策略

### 📊 智能匹配算法

- **FIFO策略**: 按加入时间顺序匹配，适合休闲游戏
- **ELO策略**: 基于技能评级匹配，确保公平竞技

### ⚙️ 灵活配置系统

- 可为每个规则集单独配置匹配策略
- ELO匹配支持动态参数调整
- 向后兼容现有匹配系统

## 系统架构

### 匹配策略接口

```typescript
interface MatchingStrategy {
  findMatch(queue: MatchmakingEntry[], config: MatchingConfig): Promise<MatchResult | null>
  evaluateMatch(player1: MatchmakingEntry, player2: MatchmakingEntry, config: MatchingConfig): Promise<MatchQuality>
  isMatchAcceptable(player1: MatchmakingEntry, player2: MatchmakingEntry, config: MatchingConfig): Promise<boolean>
}
```

### 匹配配置

```typescript
interface MatchingConfig {
  strategy: 'fifo' | 'elo'
  eloConfig?: {
    initialRange: number // 初始ELO匹配范围
    rangeExpansionPerSecond: number // 每秒扩大的范围
    maxEloDifference: number // 最大ELO差距
    maxWaitTime: number // 最大等待时间(秒)
  }
}
```

## 当前配置

### 休闲规则集 (casual_standard_ruleset)

```typescript
{
  strategy: 'fifo'
  // 按加入时间顺序匹配，快速配对
}
```

### 竞技规则集 (competitive_ruleset)

```typescript
{
  strategy: 'elo',
  eloConfig: {
    initialRange: 100,           // ±100 ELO初始匹配范围
    rangeExpansionPerSecond: 15, // 每秒扩大15 ELO范围
    maxEloDifference: 400,       // 最大±400 ELO差距
    maxWaitTime: 180            // 最大等待3分钟
  }
}
```

## ELO匹配算法

### 匹配范围计算

```
当前可接受范围 = 初始范围 + (等待时间秒数 × 扩展速度)
最终范围 = min(当前可接受范围, 最大ELO差距)
```

### 匹配质量评估

- **ELO相似性**: ELO差距越小，匹配质量越高
- **等待时间**: 等待时间相近的玩家优先匹配
- **综合评分**: ELO权重80% + 等待时间权重20%

### 示例场景

玩家A (ELO: 1500) 等待60秒：

- 可接受范围: 100 + (60 × 15) = 1000
- 实际范围: min(1000, 400) = 400
- 匹配对象: ELO 1100-1900 的玩家

## 使用方法

### 为新规则集启用ELO匹配

1. **修改规则集定义**:

```typescript
export function createCustomRuleSet(): RuleSetImpl {
  const ruleSet = new RuleSetImpl('custom_ruleset', '自定义规则集', {
    // ... 其他配置
    matchingConfig: {
      strategy: 'elo',
      eloConfig: {
        initialRange: 150,
        rangeExpansionPerSecond: 20,
        maxEloDifference: 500,
        maxWaitTime: 240,
      },
    },
  })
  return ruleSet
}
```

2. **注册规则集**:

```typescript
registry.registerRuleSet(createCustomRuleSet())
```

### 运行时配置修改

```typescript
const configManager = MatchingConfigManager.getInstance()

// 临时修改匹配配置
configManager.setMatchingConfig('custom_ruleset', {
  strategy: 'elo',
  eloConfig: {
    initialRange: 200,
    rangeExpansionPerSecond: 25,
    maxEloDifference: 600,
    maxWaitTime: 300,
  },
})
```

## API接口

### 查询匹配配置

```bash
# 获取规则集匹配配置
curl "http://localhost:8102/api/v1/elo/config"

# 获取ELO排行榜
curl "http://localhost:8102/api/v1/elo/leaderboard/competitive_ruleset"

# 预测匹配结果
curl "http://localhost:8102/api/v1/elo/predict/player1/player2/competitive_ruleset"
```

### 匹配质量监控

系统会记录详细的匹配日志：

```json
{
  "ruleSetId": "competitive_ruleset",
  "strategy": "ELO",
  "matchQuality": {
    "score": 0.85,
    "eloDifference": 120,
    "waitTimeDifference": 15000,
    "acceptable": true
  },
  "player1": { "playerId": "player_a", "elo": 1450 },
  "player2": { "playerId": "player_b", "elo": 1330 }
}
```

## 测试验证

### 运行测试脚本

```bash
# 测试ELO计算逻辑
cd packages/server && npx tsx src/test-elo.ts

# 测试匹配策略
cd packages/server && npx tsx src/test-elo-matching.ts
```

### 测试结果示例

```
✓ 休闲规则集: FIFO匹配 (禁用ELO)
✓ 竞技规则集: ELO匹配 (启用ELO)
✓ 匹配策略工厂: 支持 fifo, elo
✓ 配置验证: 通过
```

## 部署步骤

### 1. 数据库迁移

```sql
-- 在Supabase SQL编辑器中执行
\i packages/database/sql/06_add_elo_system.sql
```

### 2. 服务器重启

```bash
# 重新构建并启动服务器
npm run build
node dist/cli.js server --port 8102
```

### 3. 验证功能

```bash
# 检查ELO API
curl "http://localhost:8102/api/v1/elo/config"

# 检查匹配配置
# 观察服务器日志中的匹配策略信息
```

## 监控和调优

### 关键指标

- **匹配成功率**: 不同策略的匹配成功率对比
- **匹配质量**: ELO差距分布和匹配满意度
- **等待时间**: 平均匹配等待时间
- **队列大小**: 不同规则集的队列长度

### 性能优化

- **ELO缓存**: 玩家ELO评级缓存机制
- **匹配算法**: 根据队列大小动态调整匹配参数
- **负载均衡**: 跨实例的匹配负载分布

## 故障排除

### 常见问题

1. **ELO匹配不工作**
   - 检查规则集配置是否正确
   - 确认ELO数据库表已创建
   - 验证玩家ELO记录存在

2. **匹配时间过长**
   - 调整ELO匹配参数
   - 增加rangeExpansionPerSecond
   - 减少maxEloDifference

3. **匹配质量差**
   - 检查ELO评级是否准确
   - 调整匹配质量权重
   - 增加initialRange

### 调试工具

```bash
# 查看匹配配置
curl "http://localhost:8102/api/v1/elo/config"

# 查看ELO统计
curl "http://localhost:8102/api/v1/elo/statistics/competitive_ruleset"

# 测试匹配策略
npx tsx packages/server/src/test-elo-matching.ts
```

## 未来扩展

### 计划功能

1. **动态匹配参数**: 根据队列状态自动调整匹配参数
2. **匹配预测**: 基于历史数据预测匹配成功率
3. **多维度匹配**: 结合ELO、延迟、地区等多个因素
4. **匹配分析**: 详细的匹配质量分析和报告

### 新策略支持

系统设计支持轻松添加新的匹配策略：

```typescript
class CustomMatchingStrategy extends AbstractMatchingStrategy {
  readonly name = 'Custom'

  async findMatch(queue: MatchmakingEntry[], config: MatchingConfig) {
    // 自定义匹配逻辑
  }
}
```

## 总结

ELO匹配系统已成功集成到现有匹配框架中，提供了：

- ✅ **灵活配置**: 每个规则集可独立配置匹配策略
- ✅ **智能匹配**: ELO评级确保技能平衡的对战
- ✅ **向后兼容**: 现有FIFO匹配继续正常工作
- ✅ **易于扩展**: 支持添加新的匹配策略
- ✅ **完整监控**: 详细的匹配质量日志和API

竞技模式现在使用ELO匹配，而休闲模式继续使用快速的FIFO匹配，为不同类型的玩家提供最佳的游戏体验。
