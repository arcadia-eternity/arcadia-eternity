# CLI 战报功能使用指南

本文档介绍如何使用 CLI 启动带有战报功能的游戏服务器。

## 快速开始

### 1. 基本启动（不带战报功能）

```bash
# 启动基础游戏服务器
node dist/cli.js server --port 8102
```

### 2. 启动带战报功能的服务器

```bash
# 使用环境变量配置
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_ANON_KEY="your-anon-key"
export SUPABASE_SERVICE_KEY="your-service-key"

node dist/cli.js server \
  --port 8102 \
  --enable-battle-reports \
  --cors-origin "http://localhost:3000,http://localhost:5173"
```

### 3. 使用命令行参数配置

```bash
node dist/cli.js server \
  --port 8102 \
  --enable-battle-reports \
  --supabase-url "https://your-project.supabase.co" \
  --supabase-anon-key "your-anon-key" \
  --supabase-service-key "your-service-key" \
  --cors-origin "http://localhost:3000,http://localhost:5173"
```

## 命令行选项

### 基础选项

- `-p, --port <number>`: 服务器端口（默认：8102）
- `--cors-origin <origins>`: CORS 允许的源，逗号分隔（默认：<http://localhost:3000,http://localhost:5173）>

### 战报功能选项

- `--enable-battle-reports`: 启用战报功能和 API
- `--supabase-url <url>`: Supabase 项目 URL
- `--supabase-anon-key <key>`: Supabase 匿名密钥
- `--supabase-service-key <key>`: Supabase 服务密钥（可选，用于绕过 RLS）

## 环境变量

可以使用以下环境变量代替命令行参数：

```bash
# Supabase 配置
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key

# 服务器配置
PORT=8102
CORS_ORIGIN=http://localhost:3000,http://localhost:5173
```

## 使用启动脚本

项目提供了便捷的启动脚本：

```bash
# 使脚本可执行
chmod +x examples/start-server-with-battle-reports.sh

# 运行脚本
./examples/start-server-with-battle-reports.sh
```

脚本会自动：

- 检查依赖
- 验证配置
- 构建项目（如需要）
- 启动服务器

## 服务器功能

启动成功后，服务器将提供以下功能：

### 基础功能

- **游戏服务器**: WebSocket 连接用于实时对战
- **健康检查**: `GET /health` - 服务器状态检查
- **服务器统计**: `GET /api/stats` - 服务器运行统计

### 战报功能（启用时）

- **战报记录**: 自动记录所有战斗过程
- **玩家统计**: 自动更新玩家胜负记录
- **战报 API**: RESTful API 用于查询战报数据

## 战报 API 端点

当启用战报功能时，以下 API 端点可用：

### 战报相关

```
GET /api/v1/battles              # 获取战报列表
GET /api/v1/battles/:id          # 获取单个战报详情
GET /api/v1/players/:id/battles  # 获取玩家战报记录
```

### 玩家相关

```
GET /api/v1/players/:id          # 获取玩家信息
GET /api/v1/players/:id/stats    # 获取玩家统计
GET /api/v1/players?search=name  # 搜索玩家
```

### 排行榜和统计

```
# GET /api/v1/leaderboard          # 获取排行榜 (暂时禁用)
GET /api/v1/statistics           # 获取战报统计信息
```

## 配置 Supabase

### 1. 创建 Supabase 项目

1. 访问 [Supabase](https://supabase.com)
2. 创建新项目
3. 获取项目 URL 和 API 密钥

### 2. 执行数据库迁移

在 Supabase SQL 编辑器中依次执行：

```sql
-- 1. 创建表结构
\i packages/database/sql/01_create_tables.sql

-- 2. 设置 RLS 策略
\i packages/database/sql/02_rls_policies.sql

-- 3. 创建函数
\i packages/database/sql/03_functions.sql
```

### 3. 获取密钥

- **项目 URL**: 在项目设置 > API 中找到
- **匿名密钥**: 在项目设置 > API 中找到 `anon` 密钥
- **服务密钥**: 在项目设置 > API 中找到 `service_role` 密钥

## 故障排除

### 常见问题

1. **战报功能未启用**

   ```
   [⚠️] 战报功能需要Supabase配置，已禁用
   ```

   **解决方案**: 确保设置了 `SUPABASE_URL` 和 `SUPABASE_ANON_KEY`

2. **CORS 错误**

   ```
   Access to fetch at 'http://localhost:8102/api/v1/battles' from origin 'http://localhost:3000' has been blocked by CORS policy
   ```

   **解决方案**: 检查 `--cors-origin` 参数是否包含前端域名

3. **数据库连接失败**

   ```
   Failed to create battle record: Invalid API key
   ```

   **解决方案**: 验证 Supabase URL 和密钥是否正确

### 调试技巧

1. **启用详细日志**

   ```bash
   NODE_ENV=development node dist/cli.js server --enable-battle-reports
   ```

2. **检查健康状态**

   ```bash
   curl http://localhost:8102/health
   ```

3. **测试 API 连接**

   ```bash
   curl http://localhost:8102/api/v1/statistics
   ```

## 生产部署建议

### 环境变量配置

```bash
NODE_ENV=production
PORT=8102
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key
CORS_ORIGIN=https://your-frontend-domain.com
```

### 安全考虑

- 使用 HTTPS
- 限制 CORS 源到实际域名
- 定期轮换 API 密钥
- 监控 API 使用情况

### 性能优化

- 使用负载均衡器
- 配置 CDN
- 启用数据库连接池
- 监控服务器资源使用

## 示例配置文件

创建 `.env` 文件：

```bash
# 服务器配置
NODE_ENV=development
PORT=8102

# CORS 配置
CORS_ORIGIN=http://localhost:3000,http://localhost:5173

# Supabase 配置
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_KEY=your-service-key
```

然后启动服务器：

```bash
node dist/cli.js server --enable-battle-reports
```

这样就可以使用环境变量中的配置启动带有完整战报功能的游戏服务器了。
