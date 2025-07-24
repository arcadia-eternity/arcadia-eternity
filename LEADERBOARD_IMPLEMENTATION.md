# ELO排行榜功能实现

## 概述

重新启用了排行榜功能，通过ELO评分系统进行排名。不同规则集有不同的排行榜，只有启用ELO匹配策略的规则集才会显示排行榜。

## 实现的功能

### 1. 后端API

#### 新增规则集管理API (`/api/v1/rulesets`)

- `GET /api/v1/rulesets` - 获取所有规则集
- `GET /api/v1/rulesets/elo-enabled` - 获取启用ELO的规则集
- `GET /api/v1/rulesets/:ruleSetId` - 获取单个规则集详情

#### 现有ELO排行榜API (`/api/v1/elo`)

- `GET /api/v1/elo/leaderboard/:ruleSetId` - 获取指定规则集的ELO排行榜
- `GET /api/v1/elo/player/:playerId/:ruleSetId` - 获取玩家在指定规则集下的ELO信息
- `GET /api/v1/elo/statistics/:ruleSetId` - 获取规则集的ELO统计信息

### 2. 前端功能

#### 排行榜组件更新

- 添加了规则集选择器，只显示启用ELO的规则集
- 新增ELO评分列，显示当前评分和历史最高评分
- 适配ELO排行榜数据格式（`games_played` vs `total_battles`）
- 当没有启用ELO的规则集时显示提示信息

#### 状态管理更新

- 新增规则集相关状态：`ruleSets`, `eloEnabledRuleSets`, `selectedRuleSetId`
- 修改排行榜获取逻辑，支持按规则集获取ELO排行榜
- 添加规则集获取和管理方法

#### 服务层更新

- 新增规则集相关API调用方法
- 更新排行榜获取方法，调用ELO排行榜API
- 添加相关TypeScript类型定义

### 3. 数据类型

#### 新增类型定义

```typescript
// 规则集信息
interface RuleSetInfo {
  id: string
  name: string
  description?: string
  version: string
  author?: string
  tags: string[]
  enabled: boolean
  ruleCount: number
  matchingConfig?: MatchingConfig
  eloConfig?: EloConfig | null
}

// 规则集详情
interface RuleSetDetails extends RuleSetInfo {
  isEloEnabled: boolean
  rules: RuleInfo[]
}
```

#### ELO排行榜数据格式

```typescript
interface EloLeaderboardEntry {
  player_id: string
  player_name: string
  elo_rating: number        // 当前ELO评分
  games_played: number      // 游戏场次
  wins: number             // 胜场
  losses: number           // 负场
  draws: number            // 平局
  win_rate: number         // 胜率
  highest_elo: number      // 历史最高ELO
}
```

## 规则集配置

### 当前规则集

1. **休闲规则集** (`casual_standard_ruleset`)
   - 匹配策略: FIFO
   - 不启用ELO排行榜

2. **竞技规则集** (`competitive_ruleset`)
   - 匹配策略: ELO
   - 启用ELO排行榜
   - ELO配置:
     - 初始范围: ±100
     - 扩展速度: +15/秒
     - 最大差距: ±400
     - 最大等待时间: 180秒

## 使用流程

### 前端用户体验

1. 用户访问排行榜页面
2. 系统自动获取启用ELO的规则集列表
3. 如果有启用ELO的规则集：
   - 显示规则集选择器
   - 默认选择第一个规则集
   - 显示该规则集的ELO排行榜
4. 如果没有启用ELO的规则集：
   - 显示"暂无排行榜"提示

### 排行榜显示内容

- 排名（前三名有特殊图标）
- 玩家名称和ID
- ELO评分（当前评分 + 历史最高评分）
- 游戏场次
- 胜场/负场/平局
- 胜率（带颜色和进度条）

## 技术实现细节

### 后端架构

- 使用现有的ELO系统和数据库表
- 通过 `MatchingConfigManager` 判断规则集是否启用ELO
- 复用现有的ELO排行榜查询逻辑

### 前端架构

- 使用Pinia进行状态管理
- 组件化设计，排行榜组件独立
- 响应式数据绑定，自动更新

### 数据库

- 复用现有的 `player_elo_ratings` 表
- 按规则集ID分离排行榜数据
- 支持分页查询

## 测试验证

创建了测试脚本 `packages/server/src/test-leaderboard.ts` 来验证：

- ✅ 规则系统初始化
- ✅ 规则集获取和分类
- ✅ ELO配置识别
- ✅ 排行榜API调用逻辑

## 部署说明

1. 确保数据库已初始化ELO相关表
2. 确保规则系统正确配置
3. 重新构建并部署后端和前端
4. 验证API端点可访问

## 后续扩展

1. 可以添加更多规则集，只需配置 `matchingConfig.strategy = 'elo'`
2. 可以为不同规则集配置不同的ELO参数
3. 可以添加排行榜历史记录功能
4. 可以添加玩家ELO变化趋势图
