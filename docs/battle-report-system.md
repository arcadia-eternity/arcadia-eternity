# 游戏战报系统完整指南

本文档提供了游戏战报系统的完整实现指南，包括数据库设计、后端 API、前端组件和部署说明。

## 系统架构

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Vue 3 前端    │    │  Node.js 后端   │    │ Supabase 数据库 │
│                 │    │                 │    │                 │
│ - 战报列表      │◄──►│ - REST API      │◄──►│ - PostgreSQL    │
│ - 战报详情      │    │ - Socket.IO     │    │ - RLS 策略      │
│ - 排行榜        │    │ - 战报服务      │    │ - 触发器        │
│ - 玩家统计      │    │ - 实时战斗      │    │ - 函数          │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 技术栈

- **前端**: Vue 3 + TypeScript + Element Plus + Tailwind CSS
- **后端**: Node.js + Express + TypeScript + Socket.IO
- **数据库**: Supabase (PostgreSQL)
- **ORM**: 直接使用 Supabase JS 客户端
- **构建工具**: Vite + Rollup
- **包管理**: pnpm (monorepo)

## 快速开始

### 1. 环境准备

```bash
# 安装依赖
pnpm install

# 复制环境变量
cp .env.example .env
cp packages/web-ui/.env.example packages/web-ui/.env
```

### 2. 配置 Supabase

1. 创建 Supabase 项目
2. 执行数据库迁移脚本
3. 配置环境变量

```bash
# 在 Supabase SQL 编辑器中依次执行
packages/database/sql/01_create_tables.sql
packages/database/sql/02_rls_policies.sql
packages/database/sql/03_functions.sql
```

### 3. 启动开发服务器

```bash
# 构建所有包
pnpm build

# 启动后端服务器
node dist/cli.js server --port 3001

# 启动前端开发服务器
pnpm web:dev
```

## 数据库设计

### 表结构

#### players 表
```sql
CREATE TABLE players (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'::jsonb
);
```

#### player_stats 表
```sql
CREATE TABLE player_stats (
    player_id TEXT PRIMARY KEY REFERENCES players(id),
    total_battles INTEGER DEFAULT 0,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    draws INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### battle_records 表
```sql
CREATE TABLE battle_records (
    id TEXT PRIMARY KEY DEFAULT nanoid(),
    player_a_id TEXT NOT NULL REFERENCES players(id),
    player_a_name TEXT NOT NULL,
    player_b_id TEXT NOT NULL REFERENCES players(id),
    player_b_name TEXT NOT NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    winner_id TEXT REFERENCES players(id),
    battle_result TEXT NOT NULL,
    end_reason TEXT NOT NULL,
    battle_messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    final_state JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 关键特性

1. **自动统计更新**: 使用触发器自动更新玩家统计
2. **数据一致性**: 约束确保数据完整性
3. **性能优化**: 索引优化常用查询
4. **安全策略**: RLS 保护敏感数据

## API 接口

### 战报相关

```typescript
// 获取战报列表
GET /api/v1/battles?limit=20&offset=0

// 获取战报详情
GET /api/v1/battles/:id

// 获取玩家战报
GET /api/v1/players/:playerId/battles?limit=20&offset=0
```

### 玩家相关

```typescript
// 获取玩家信息
GET /api/v1/players/:playerId

// 获取玩家统计
GET /api/v1/players/:playerId/stats

// 搜索玩家
GET /api/v1/players?search=keyword&limit=20
```

### 排行榜和统计

```typescript
// 获取排行榜
GET /api/v1/leaderboard?limit=50&offset=0

// 获取战报统计
GET /api/v1/statistics
```

## 前端组件

### 组件结构

```
src/components/battleReport/
├── BattleRecordList.vue      # 战报列表
├── BattleRecordDetail.vue    # 战报详情
├── Leaderboard.vue           # 排行榜
└── PlayerBattleRecords.vue   # 玩家战报
```

### 状态管理

```typescript
// stores/battleReport.ts
export const useBattleReportStore = defineStore('battleReport', () => {
  // 状态
  const battleRecords = ref<BattleRecord[]>([])
  const leaderboard = ref<LeaderboardEntry[]>([])
  
  // 方法
  const fetchBattleRecords = async () => { /* ... */ }
  const fetchLeaderboard = async () => { /* ... */ }
  
  return {
    battleRecords,
    leaderboard,
    fetchBattleRecords,
    fetchLeaderboard
  }
})
```

### 路由配置

```typescript
const routes = [
  { path: '/battle-reports', component: BattleRecordList },
  { path: '/battle-reports/:id', component: BattleRecordDetail },
  { path: '/leaderboard', component: Leaderboard },
  { path: '/players/:playerId/battles', component: PlayerBattleRecords }
]
```

## 服务器集成

### 战报服务

```typescript
export class BattleReportService {
  async startBattleRecord(battleId: string, playerA: string, playerB: string) {
    // 创建战报记录
  }
  
  recordBattleMessage(battleId: string, message: BattleMessage) {
    // 记录战斗消息
  }
  
  async completeBattleRecord(battleId: string, result: BattleResult) {
    // 完成战报
  }
}
```

### 服务器配置

```typescript
// 创建服务器时传入战报配置
const battleServer = new BattleServer(io, {
  enableReporting: true,
  enableApi: true,
  database: {
    supabaseUrl: process.env.SUPABASE_URL!,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY!,
    supabaseServiceKey: process.env.SUPABASE_SERVICE_KEY
  }
})
```

## 部署指南

### 1. 数据库部署

1. 创建 Supabase 项目
2. 执行迁移脚本
3. 配置 RLS 策略
4. 设置定期清理任务

### 2. 后端部署

```bash
# 构建项目
pnpm build

# 设置环境变量
export SUPABASE_URL="your_url"
export SUPABASE_ANON_KEY="your_key"
export SUPABASE_SERVICE_KEY="your_service_key"

# 启动服务器
node dist/cli.js server --port 3001
```

### 3. 前端部署

```bash
# 构建前端
pnpm --filter @arcadia-eternity/web-ui run build

# 部署到静态托管服务
# (Vercel, Netlify, 等)
```

### 4. 环境变量配置

```bash
# 生产环境
NODE_ENV=production
PORT=3001
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_KEY=your_service_key
CORS_ORIGIN=https://your-frontend-domain.com
```

## 性能优化

### 数据库优化

1. **索引策略**
   - 时间字段降序索引
   - 复合索引优化查询
   - 外键自动索引

2. **查询优化**
   - 使用数据库函数
   - 分页查询
   - 预计算统计

3. **缓存策略**
   - Redis 缓存热点数据
   - CDN 缓存静态资源
   - 浏览器缓存优化

### 前端优化

1. **代码分割**
   - 路由级别懒加载
   - 组件按需导入
   - 第三方库分离

2. **数据管理**
   - 虚拟滚动大列表
   - 分页加载数据
   - 状态持久化

## 监控和维护

### 监控指标

1. **性能指标**
   - API 响应时间
   - 数据库查询性能
   - 前端加载时间

2. **业务指标**
   - 战报创建成功率
   - 用户活跃度
   - 错误率统计

### 维护任务

1. **定期清理**
   - 清理废弃战报
   - 压缩历史数据
   - 清理临时文件

2. **数据备份**
   - 定期数据库备份
   - 关键数据导出
   - 灾难恢复计划

## 故障排除

### 常见问题

1. **数据库连接失败**
   - 检查网络连接
   - 验证凭据配置
   - 确认服务状态

2. **API 请求失败**
   - 检查 CORS 配置
   - 验证请求格式
   - 查看服务器日志

3. **前端显示异常**
   - 检查控制台错误
   - 验证数据格式
   - 确认路由配置

### 调试技巧

```typescript
// 启用详细日志
const logger = pino({ level: 'debug' })

// 数据库查询调试
const { data, error } = await supabase
  .from('battle_records')
  .select('*')
  .explain({ analyze: true })

// 前端状态调试
console.log('Store state:', toRaw(battleReportStore.$state))
```

## 扩展功能

### 可能的扩展

1. **高级统计**
   - 技能使用统计
   - 宠物胜率分析
   - 战斗时长分布

2. **社交功能**
   - 好友系统
   - 战报分享
   - 评论系统

3. **数据分析**
   - 战斗回放
   - 策略分析
   - 平衡性调整

### 实现建议

1. 保持向后兼容
2. 渐进式增强
3. 性能优先
4. 用户体验至上

## 总结

本战报系统提供了完整的游戏数据记录和分析功能，具有以下优势：

- **完整性**: 覆盖战报记录的全生命周期
- **可扩展性**: 模块化设计便于功能扩展
- **性能**: 优化的数据库设计和查询策略
- **安全性**: 完善的权限控制和数据保护
- **易用性**: 直观的用户界面和 API 设计

通过本系统，玩家可以查看详细的战斗记录，分析战斗策略，参与排行榜竞争，为游戏增加了丰富的数据驱动功能。
