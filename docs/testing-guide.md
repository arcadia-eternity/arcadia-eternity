# 测试指南

本文档介绍如何运行项目的各种测试，确保战报系统功能正常。

## 测试脚本概览

### 快速测试

```bash
# 运行所有测试
pnpm test

# 只运行类型检查
pnpm test:types

# 只运行单元测试
pnpm test:units

# 只运行集成测试
pnpm test:integration
```

### 专项测试

```bash
# 测试 CLI 功能
pnpm test:cli

# 测试 SQL 语法
pnpm test:sql

# 测试数据库功能（需要 Supabase 配置）
pnpm test:database

# 测试服务器启动
pnpm test:server

# 测试战报 API（需要 Supabase 配置）
pnpm test:battle-reports

# 验证端口配置一致性
pnpm test:config
```

### 开发服务器

```bash
# 启动基础游戏服务器
pnpm dev:server

# 启动带战报功能的服务器
pnpm dev:server:battle-reports

# 使用示例脚本启动
pnpm start:example
```

## 测试环境配置

### 1. 基础测试

基础测试不需要额外配置，包括：

- TypeScript 类型检查
- CLI 帮助信息测试
- 服务器启动测试

### 2. 数据库测试

数据库相关测试需要 Supabase 配置：

```bash
# 设置环境变量
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_ANON_KEY="your-anon-key"
export SUPABASE_SERVICE_KEY="your-service-key"

# 运行数据库测试
pnpm test:database
```

### 3. 战报 API 测试

战报 API 测试需要完整的 Supabase 配置：

```bash
# 运行战报 API 测试
pnpm test:battle-reports
```

## 测试详情

### 类型检查 (`test:types`)

验证 TypeScript 类型定义是否正确：

- 检查所有 `.ts` 文件的类型
- 验证接口定义
- 确保类型安全

### 单元测试 (`test:units`)

使用 Jest 运行单元测试：

- 数据库服务模拟测试
- 类型定义验证
- 基础功能测试

### CLI 测试 (`test:cli`)

测试命令行界面功能：

- 主命令帮助信息
- server 命令帮助信息
- 战报选项验证

### SQL 语法测试 (`test:sql`)

测试 SQL 文件语法正确性：

- 检查 SQL 文件是否存在
- 验证不包含已弃用的函数（如 nanoid）
- 如果配置了数据库连接，测试 SQL 语法
- 验证 PostgreSQL UUID 函数使用

### 数据库测试 (`test:database`)

测试数据库功能：

- 玩家创建和查询
- 战报记录创建和完成
- 统计信息查询
- 排行榜功能

### 服务器测试 (`test:server`)

测试服务器启动和基础功能：

- 服务器启动和关闭
- 健康检查端点
- 统计端点
- CLI 选项验证

### 战报 API 测试 (`test:battle-reports`)

测试完整的战报 API 功能：

- 所有 API 端点响应
- CORS 配置
- 错误处理
- 数据库集成

### 配置验证 (`test:config`)

验证端口配置一致性：

- CLI 默认端口
- 前端 API 端口
- 环境变量示例
- 启动脚本配置

## 测试文件结构

```text
tests/
├── setup.ts                           # Jest 测试环境设置
└── database.test.ts                   # 数据库单元测试

examples/
├── test-cli-help.sh                   # CLI 帮助测试
├── test-sql-syntax.sh                 # SQL 语法测试
├── test-server-startup.sh             # 服务器启动测试
├── test-battle-reports-api.sh         # 战报 API 测试
└── verify-port-config.sh              # 端口配置验证

packages/database/examples/
└── test-database.ts                   # 数据库功能测试
```

## 持续集成

### GitHub Actions 示例

```yaml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install -g pnpm
      - run: pnpm install
      - run: pnpm build
      - run: pnpm test:types
      - run: pnpm test:units
      - run: pnpm test:cli
      - run: pnpm test:sql
      - run: pnpm test:server
      - run: pnpm test:config
```

### 带数据库的测试

```yaml
  test-with-database:
    runs-on: ubuntu-latest
    env:
      SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
      SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
      SUPABASE_SERVICE_KEY: ${{ secrets.SUPABASE_SERVICE_KEY }}
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install -g pnpm
      - run: pnpm install
      - run: pnpm build
      - run: pnpm test:database
      - run: pnpm test:battle-reports
```

## 故障排除

### 常见问题

1. **端口冲突**

   ```bash
   # 检查端口使用情况
   lsof -i :8102
   
   # 杀死占用端口的进程
   kill -9 <PID>
   ```

2. **权限问题**

   ```bash
   # 给脚本执行权限
   chmod +x examples/*.sh
   ```

3. **依赖问题**

   ```bash
   # 重新安装依赖
   pnpm install
   
   # 重新构建
   pnpm build
   ```

4. **数据库连接失败**

   ```bash
   # 检查环境变量
   echo $SUPABASE_URL
   echo $SUPABASE_ANON_KEY

   # 测试连接
   curl -H "apikey: $SUPABASE_ANON_KEY" "$SUPABASE_URL/rest/v1/"
   ```

5. **SQL 函数错误**

   ```bash
   # 如果遇到 "function nanoid() does not exist" 错误
   # 确保使用的是更新后的 SQL 文件，应该使用：
   # gen_random_uuid()::text 而不是 nanoid()

   # 检查 SQL 文件内容
   grep -n "nanoid" packages/database/sql/*.sql
   # 应该没有输出，如果有则需要更新 SQL 文件
   ```

### 调试技巧

1. **查看详细日志**

   ```bash
   # 启用详细输出
   NODE_ENV=development pnpm test:server
   ```

2. **单独运行测试**

   ```bash
   # 直接运行测试脚本
   bash examples/test-server-startup.sh
   ```

3. **检查临时文件**

   ```bash
   # 查看测试日志
   cat /tmp/server-test.log
   cat /tmp/battle-reports-test.log
   ```

## 最佳实践

1. **测试前构建**：确保运行测试前项目已构建
2. **环境隔离**：使用不同端口避免冲突
3. **清理资源**：测试后清理临时文件和进程
4. **错误处理**：测试脚本包含适当的错误处理
5. **文档更新**：添加新测试时更新文档

## 贡献指南

添加新测试时请：

1. 遵循现有的命名约定
2. 添加适当的错误处理
3. 包含清理逻辑
4. 更新 package.json 脚本
5. 更新本文档
