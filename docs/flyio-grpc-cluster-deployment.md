# Fly.io gRPC 集群部署指南

本文档介绍如何在 Fly.io 上部署支持 gRPC 服务发现的集群服务。

## 概述

在 Fly.io 环境中，集群服务通过以下方式实现互相发现和 gRPC 通信：

1. **Redis 服务注册**: 所有实例将自己的信息注册到共享的 Redis 实例
2. **内部网络通信**: 使用 Fly.io 的内部网络进行 gRPC 通信
3. **服务发现**: 通过 `FlyIoServiceDiscoveryManager` 实现智能的服务发现和负载均衡
4. **区域优先**: 优先选择同区域的实例进行通信以降低延迟

## 架构组件

### 1. FlyIoServiceDiscoveryManager

扩展了基础的 `ServiceDiscoveryManager`，添加了 Fly.io 特定的功能：

- 同区域实例优先选择
- Fly.io 内部网络地址解析
- gRPC 健康检查
- 集群拓扑信息

### 2. BattleRpcClient

支持通过服务发现获取 gRPC 客户端：

- `getOptimalClient()`: 获取最佳 gRPC 客户端
- `getClientByInstanceId()`: 获取指定实例的客户端
- `getAllAvailableClients()`: 获取所有可用客户端

### 3. 配置更新

- `fly.toml`: 添加了 gRPC 端口配置和 Fly.io 环境变量
- 集群配置: 支持 `grpcPort` 和 `isFlyIo` 标识

## 部署步骤

### 1. 准备环境

确保已安装必要工具：

```bash
# 安装 Fly CLI
curl -L https://fly.io/install.sh | sh

# 登录 Fly.io
fly auth login

# 检查 Docker
docker --version
```

### 2. 配置环境变量

设置必要的环境变量：

```bash
export REDIS_HOST="your-redis-host"
export REDIS_PASSWORD="your-redis-password"
export JWT_SECRET="your-jwt-secret"

# 可选：邮件配置
export SMTP_HOST="smtp.example.com"
export SMTP_USER="your-smtp-user"
export SMTP_PASS="your-smtp-password"

# 可选：Supabase 配置
export SUPABASE_URL="your-supabase-url"
export SUPABASE_ANON_KEY="your-supabase-anon-key"
export SUPABASE_SERVICE_KEY="your-supabase-service-key"
```

### 3. 使用部署脚本

运行自动化部署脚本：

```bash
# 部署 3 个实例（默认）
./tools/deploy-flyio-cluster.sh

# 部署 5 个实例
./tools/deploy-flyio-cluster.sh 5
```

### 4. 手动部署（可选）

如果需要手动控制部署过程：

```bash
# 1. 构建并推送镜像
docker build -t ghcr.io/your-org/your-app:latest .
docker push ghcr.io/your-org/your-app:latest

# 2. 设置密钥
fly secrets set REDIS_HOST="your-redis-host"
fly secrets set REDIS_PASSWORD="your-redis-password"
fly secrets set JWT_SECRET="your-jwt-secret"

# 3. 部署应用
fly deploy --image ghcr.io/your-org/your-app:latest

# 4. 扩展实例
fly scale count 3
```

## 配置说明

### fly.toml 配置

```toml
# gRPC 服务配置
[[services]]
internal_port = 50051
protocol = "tcp"
processes = ['app']

# 内部 gRPC 端口，不对外暴露
[[services.ports]]
port = 50051
handlers = []

[env]
# gRPC configuration for Fly.io
GRPC_PORT = "50051"
GRPC_BIND_ADDRESS = "0.0.0.0"
# Fly.io 内部网络发现
FLY_APP_NAME = "test-battle"
FLY_REGION = "hkg"
```

### 环境变量

| 变量名 | 描述 | 默认值 |
|--------|------|--------|
| `GRPC_PORT` | gRPC 服务端口 | `50051` |
| `GRPC_BIND_ADDRESS` | gRPC 绑定地址 | `0.0.0.0` |
| `FLY_APP_NAME` | Fly.io 应用名称 | - |
| `FLY_REGION` | Fly.io 区域 | - |
| `FLY_PRIVATE_IP` | Fly.io 私有 IP（自动设置） | - |

## 服务发现机制

### 1. 实例注册

每个实例启动时会：

- 将自己的信息注册到 Redis
- 包含 gRPC 端口和地址信息
- 定期发送心跳更新状态

### 2. 地址解析

在 Fly.io 环境中：

- 使用内部网络地址：`{instance-id}.internal:{grpc-port}`
- 非 Fly.io 环境使用标准地址：`{host}:{grpc-port}`

### 3. 负载均衡

支持多种负载均衡策略：

- `WeightedLoadStrategy`: 基于权重的负载均衡
- `RoundRobinStrategy`: 轮询策略
- `LeastConnectionsStrategy`: 最少连接策略

### 4. 区域优先

在 Fly.io 环境中，优先选择同区域的实例：

```javascript
const instance = await serviceDiscovery.getOptimalGrpcInstance(true) // 优先同区域
```

## 测试和验证

### 1. 使用测试脚本

```bash
# 测试 gRPC 服务发现和通信
npx tsx tools/test-flyio-grpc.ts
```

### 2. 检查实例状态

```bash
# 查看应用状态
fly status

# 查看实例日志
fly logs

# 查看特定实例日志
fly logs --instance <instance-id>
```

### 3. 健康检查

```bash
# 检查 HTTP 健康端点
curl https://your-app.fly.dev/health

# 检查集群状态
curl https://your-app.fly.dev/cluster/status
```

## 故障排除

### 1. gRPC 连接问题

- 检查 `GRPC_PORT` 配置是否正确
- 确认 `fly.toml` 中的服务配置
- 查看实例日志中的 gRPC 服务器启动信息

### 2. 服务发现问题

- 检查 Redis 连接配置
- 确认实例是否正确注册到 Redis
- 查看服务发现管理器的日志

### 3. 网络连接问题

- 确认实例间可以通过内部网络通信
- 检查 Fly.io 网络配置
- 验证 gRPC 端口是否正确绑定

### 4. 常见错误

**错误**: `Proto file not found`
**解决**: 确保 proto 文件在正确的路径，检查 Docker 镜像构建

**错误**: `No gRPC instances available`
**解决**: 检查实例是否正确注册，确认 gRPC 端口配置

**错误**: `Service discovery not configured`
**解决**: 确认 `FlyIoServiceDiscoveryManager` 正确初始化

## 监控和维护

### 1. 监控指标

- 实例健康状态
- gRPC 连接数量
- 服务发现延迟
- 负载均衡分布

### 2. 日志聚合

使用 `LogAggregationManager` 收集和分析集群日志

### 3. 性能追踪

使用 `PerformanceTracker` 监控集群性能指标

## 最佳实践

1. **区域部署**: 在多个区域部署实例以提高可用性
2. **健康检查**: 配置适当的健康检查间隔
3. **资源限制**: 根据负载设置合适的实例数量
4. **监控告警**: 设置关键指标的监控告警
5. **备份策略**: 定期备份 Redis 数据
6. **安全配置**: 使用 TLS 加密 Redis 连接

## 相关文档

- [Fly.io 官方文档](https://fly.io/docs/)
- [gRPC 官方文档](https://grpc.io/docs/)
- [集群架构文档](./cluster-architecture.md)
- [服务发现文档](./service-discovery.md)
