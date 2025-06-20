# CLI Redis 配置指南

本文档介绍如何通过命令行参数配置 Redis 连接和集群设置。

## Redis 配置选项

### 基础连接配置

```bash
# Redis 服务器地址和端口
--redis-host <host>          # Redis服务器地址 (默认: localhost)
--redis-port <port>          # Redis服务器端口 (默认: 6379)
--redis-password <password>  # Redis密码 (可选)
--redis-db <db>              # Redis数据库编号 (默认: 0)
```

### 高级配置

```bash
# 键前缀和重试配置
--redis-key-prefix <prefix>     # Redis键前缀 (默认: arcadia:)
--redis-max-retries <retries>   # Redis最大重试次数 (默认: 3)
--redis-retry-delay <delay>     # Redis重试延迟毫秒 (默认: 100)

# 连接行为配置
--redis-enable-ready-check      # Redis启用就绪检查 (默认: true)
--redis-lazy-connect           # Redis延迟连接 (默认: true)
```

## 集群配置选项

### 基础集群配置

```bash
# 集群开关和实例配置
--cluster-enabled                    # 启用集群模式 (默认: true)
--cluster-instance-id <id>           # 集群实例ID (自动生成)
--cluster-instance-host <host>       # 集群实例主机名 (默认: localhost)
--cluster-instance-region <region>   # 集群实例区域 (可选)
```

### 集群健康检查配置

```bash
# 心跳和健康检查间隔
--cluster-heartbeat-interval <interval>      # 集群心跳间隔毫秒 (默认: 30000)
--cluster-health-check-interval <interval>   # 集群健康检查间隔毫秒 (默认: 60000)
--cluster-failover-timeout <timeout>         # 集群故障转移超时毫秒 (默认: 120000)
```

## 使用示例

### 基础启动

```bash
# 使用默认配置启动
pnpm cli server

# 或使用构建后的CLI
node dist/cli.js server
```

### 自定义 Redis 配置

```bash
# 连接到远程 Redis
pnpm cli server \
  --redis-host redis.example.com \
  --redis-port 6380 \
  --redis-password mypassword \
  --redis-db 1
```

### 自定义集群配置

```bash
# 配置集群实例
pnpm cli server \
  --cluster-instance-id app-prod-1 \
  --cluster-instance-host app1.example.com \
  --cluster-instance-region us-east-1 \
  --cluster-heartbeat-interval 15000
```

### 完整配置示例

```bash
# 生产环境配置示例
pnpm cli server \
  --port 8102 \
  --redis-host redis-cluster.example.com \
  --redis-port 6379 \
  --redis-password "secure-password" \
  --redis-key-prefix "prod:arcadia:" \
  --cluster-instance-id "app-prod-1" \
  --cluster-instance-host "app1.prod.example.com" \
  --cluster-instance-region "us-east-1" \
  --enable-battle-reports \
  --supabase-url "https://your-project.supabase.co" \
  --supabase-anon-key "your-anon-key"
```

## 配置优先级

配置参数的优先级顺序（从高到低）：

1. **命令行参数** - 最高优先级
2. **环境变量** - 中等优先级  
3. **默认值** - 最低优先级

例如：

```bash
# 环境变量
export REDIS_HOST=env-redis.com

# 命令行参数会覆盖环境变量
pnpm cli server --redis-host cli-redis.com
# 实际使用: cli-redis.com
```

## 环境变量对照表

| CLI 参数 | 环境变量 | 默认值 |
|---------|---------|--------|
| `--redis-host` | `REDIS_HOST` | `localhost` |
| `--redis-port` | `REDIS_PORT` | `6379` |
| `--redis-password` | `REDIS_PASSWORD` | (无) |
| `--redis-db` | `REDIS_DB` | `0` |
| `--redis-key-prefix` | `REDIS_KEY_PREFIX` | `arcadia:` |
| `--cluster-enabled` | `CLUSTER_ENABLED` | `true` |
| `--cluster-instance-id` | `CLUSTER_INSTANCE_ID` | (自动生成) |

## 故障排除

### Redis 连接失败

```bash
# 检查 Redis 连接
redis-cli -h your-redis-host -p your-redis-port ping

# 查看详细错误信息
pnpm cli server --redis-host your-redis-host 2>&1 | grep -i redis
```

### 集群配置问题

```bash
# 检查集群状态
curl http://localhost:8102/cluster/status

# 查看集群日志
pnpm cli server | grep -i cluster
```

## Redis 前缀修复说明

### 修复的问题

在之前的版本中，Redis 键前缀配置存在以下问题：

1. **Socket.IO 适配器键冲突** - Socket.IO 适配器使用硬编码的 `socket.io` 键名，没有应用配置的前缀
2. **跨实例通信频道冲突** - 实例间通信使用的频道名没有前缀，可能导致不同应用间的消息串扰

### 修复内容

✅ **Socket.IO 适配器前缀** - 现在 Socket.IO 适配器会自动使用配置的键前缀
✅ **跨实例通信前缀** - 实例间通信频道名现在正确使用前缀
✅ **一致性保证** - 所有 Redis 操作都使用统一的键前缀

### 验证方法

```bash
# 使用自定义前缀启动服务器
pnpm cli server --redis-key-prefix "myapp:prod:"

# 检查 Redis 中的实际键名
redis-cli keys "myapp:prod:*"
```

## 相关文档

- [集群架构文档](./cluster-architecture.md)
- [集群部署指南](./cluster-deployment.md)
- [环境变量配置](./.env.example)
