# ELO评级系统

## 概述

为匹配框架引入了ELO评级系统，为每个规则集单独维护ELO评级，提供更精确的玩家技能评估和匹配质量。

## 核心特性

### 🎯 规则集分离
- 每个规则集（如休闲模式、竞技模式）独立维护ELO评级
- 玩家在不同规则集下有不同的ELO分数
- 支持无限扩展新的规则集

### 📊 标准ELO算法
- 基于经典ELO评级系统
- 期望得分计算：`1 / (1 + 10^((对手ELO - 自己ELO) / 400))`
- 新ELO = 旧ELO + K * (实际得分 - 期望得分)
- 支持胜利(1分)、失败(0分)、平局(0.5分)

### ⚙️ 动态K因子
- **新手** (< 30场): K = 32 (快速调整)
- **普通** (30-100场): K = 24 (中等调整)
- **老手** (> 100场): K = 16 (稳定调整)

### 🛡️ 安全边界
- ELO范围：100 - 3000
- 初始ELO：1200
- 自动记录历史最高ELO

## 数据库设计

### player_elo_ratings 表

```sql
CREATE TABLE player_elo_ratings (
    player_id TEXT NOT NULL,           -- 玩家ID
    rule_set_id TEXT NOT NULL,         -- 规则集ID
    elo_rating INTEGER DEFAULT 1200,   -- 当前ELO评级
    games_played INTEGER DEFAULT 0,    -- 游戏场次
    wins INTEGER DEFAULT 0,            -- 胜利次数
    losses INTEGER DEFAULT 0,          -- 失败次数
    draws INTEGER DEFAULT 0,           -- 平局次数
    highest_elo INTEGER DEFAULT 1200,  -- 历史最高ELO
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    PRIMARY KEY (player_id, rule_set_id)
);
```

### 核心函数

- `get_or_create_player_elo()` - 获取或创建ELO记录
- `update_player_elo()` - 更新单个玩家ELO
- `batch_update_player_elos()` - 批量更新ELO（战斗结束）
- `get_elo_leaderboard()` - 获取排行榜

## API端点

### 排行榜
```
GET /api/v1/elo/leaderboard/:ruleSetId?limit=50&offset=0
```

### 玩家ELO信息
```
GET /api/v1/elo/player/:playerId/:ruleSetId
GET /api/v1/elo/player/:playerId  # 所有规则集
```

### 统计信息
```
GET /api/v1/elo/statistics/:ruleSetId
```

### 战斗预测
```
GET /api/v1/elo/predict/:playerAId/:playerBId/:ruleSetId
```

### 配置信息
```
GET /api/v1/elo/config
GET /api/v1/elo/win-rate/:eloDifference
```

## 系统集成

### 战斗结束自动更新

战斗结束时，`battleReportService` 会自动：

1. 获取两个玩家的当前ELO
2. 根据战斗结果计算新ELO
3. 原子性批量更新数据库
4. 记录详细日志

```typescript
// 在 battleReportService.ts 中
if (battleData.ruleSetId && battleResult !== 'abandoned') {
  await eloService.processBattleEloUpdate(
    battleData.playerAId,
    battleData.playerBId,
    winnerId,
    battleData.ruleSetId
  )
}
```

### 匹配系统集成

匹配系统已支持规则集分离，ELO系统可以：

- 基于ELO进行更精确的匹配
- 预测战斗结果概率
- 提供匹配质量评估

## 部署步骤

### 1. 数据库迁移

在Supabase SQL编辑器中执行：

```sql
-- 执行ELO系统迁移
\i packages/database/sql/06_add_elo_system.sql
```

### 2. 服务器更新

ELO系统已集成到现有服务器中，无需额外配置。

### 3. 测试验证

```bash
# 测试ELO计算逻辑
cd packages/server && npx tsx src/test-elo.ts

# 启动服务器测试API
node dist/cli.js server --port 8102
```

## 使用示例

### 获取排行榜

```bash
curl "http://localhost:8102/api/v1/elo/leaderboard/casual_standard_ruleset?limit=10"
```

### 查看玩家ELO

```bash
curl "http://localhost:8102/api/v1/elo/player/player123/casual_standard_ruleset"
```

### 预测战斗结果

```bash
curl "http://localhost:8102/api/v1/elo/predict/player1/player2/competitive_ruleset"
```

## 配置选项

ELO系统支持运行时配置调整：

```typescript
const eloService = new EloService(repository, calculationService)

// 更新配置
eloService.updateEloConfig({
  initialElo: 1500,
  kFactor: {
    newbie: 40,
    normal: 20,
    veteran: 10
  },
  minElo: 200,
  maxElo: 2800
})
```

## 监控和日志

### 日志记录

- ELO更新详细日志
- 计算过程追踪
- 错误处理和恢复

### 性能监控

- 数据库查询优化
- 批量更新性能
- API响应时间

## 未来扩展

### 可能的增强功能

1. **季度重置** - 定期重置ELO评级
2. **衰减机制** - 长期不活跃玩家ELO衰减
3. **匹配优化** - 基于ELO的智能匹配
4. **成就系统** - ELO里程碑奖励
5. **数据分析** - ELO分布统计和趋势分析

### 扩展新规则集

添加新规则集只需：

1. 在规则系统中定义新规则集
2. ELO系统自动支持（无需代码修改）
3. 玩家首次游戏时自动创建ELO记录

## 故障排除

### 常见问题

1. **ELO记录不存在**
   - 系统会自动创建初始记录
   - 检查规则集ID是否正确

2. **ELO更新失败**
   - 检查数据库连接
   - 查看服务器日志
   - 验证战斗数据完整性

3. **API响应错误**
   - 确认数据库迁移已执行
   - 检查API路由注册
   - 验证请求参数格式

### 调试工具

```bash
# 测试ELO计算
npx tsx packages/server/src/test-elo.ts

# 检查数据库表
SELECT * FROM player_elo_ratings LIMIT 10;

# 查看API状态
curl "http://localhost:8102/api/v1/elo/config"
```
