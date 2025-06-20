# Arcadia Eternity 集群部署指南

本文档介绍如何部署和管理 Arcadia Eternity 的集群架构。

## 概述

集群架构提供以下功能：
- **水平扩展**：支持多个应用实例
- **高可用性**：实例故障自动转移
- **负载均衡**：智能分发请求
- **状态同步**：Redis集群状态管理
- **实时通信**：跨实例Socket.IO支持
- **监控告警**：Prometheus + Grafana监控

## 架构组件

### 核心组件
- **应用实例**：多个ServerV2实例
- **Redis**：集群状态存储和消息队列
- **负载均衡器**：Nginx或云负载均衡
- **监控系统**：Prometheus + Grafana

### 集群功能
- **服务发现**：自动实例注册和发现
- **分布式锁**：确保操作原子性
- **会话管理**：跨实例会话同步
- **房间管理**：战斗房间状态共享
- **匹配队列**：集群级别的匹配系统

## 本地开发测试

### 前置要求
- Docker 和 Docker Compose
- 至少 4GB 可用内存

### 快速开始

1. **启动基础集群**：
   ```bash
   ./scripts/test-cluster-local.sh start
   ```

2. **启动包含监控的集群**：
   ```bash
   ./scripts/test-cluster-local.sh start monitoring
   ```

3. **测试集群功能**：
   ```bash
   ./scripts/test-cluster-local.sh test
   ```

4. **查看日志**：
   ```bash
   ./scripts/test-cluster-local.sh logs
   ```

5. **停止集群**：
   ```bash
   ./scripts/test-cluster-local.sh stop
   ```

### 访问端点

- **负载均衡器**：http://localhost
- **应用实例**：
  - app1: http://localhost:8102
  - app2: http://localhost:8103
  - app3: http://localhost:8104
- **监控服务**：
  - Prometheus: http://localhost:9090
  - Grafana: http://localhost:3001 (admin/admin)
- **Redis**: localhost:6379

## 生产环境部署

### Fly.io 部署

#### 前置要求
- Fly.io 账户和 flyctl CLI
- Redis 服务（推荐 Upstash 或 Redis Cloud）

#### 部署步骤

1. **设置环境变量**：
   ```bash
   export REDIS_HOST="your-redis-host.com"
   export REDIS_PASSWORD="your-redis-password"
   export SUPABASE_URL="your-supabase-url"
   export SUPABASE_ANON_KEY="your-supabase-anon-key"
   export SUPABASE_SERVICE_KEY="your-supabase-service-key"
   export EMAIL_SMTP_PASS="your-smtp-password"
   ```

2. **执行部署**：
   ```bash
   ./scripts/deploy-cluster.sh 3  # 部署3个实例
   ```

3. **验证部署**：
   ```bash
   flyctl status
   curl https://your-app.fly.dev/health
   curl https://your-app.fly.dev/cluster/status
   ```

#### 扩展实例
```bash
flyctl scale count 5  # 扩展到5个实例
```

#### 查看日志
```bash
flyctl logs
```

### 其他云平台

#### AWS ECS
1. 创建 ECS 集群
2. 配置 Application Load Balancer
3. 设置 ElastiCache Redis
4. 部署任务定义

#### Google Cloud Run
1. 构建容器镜像
2. 配置 Cloud Load Balancing
3. 设置 Memorystore Redis
4. 部署服务

#### Azure Container Instances
1. 创建容器组
2. 配置 Application Gateway
3. 设置 Azure Cache for Redis
4. 部署容器

## 配置说明

### 环境变量

#### 集群配置
```bash
CLUSTER_ENABLED=true                    # 启用集群模式
CLUSTER_INSTANCE_ID=app1               # 实例ID（自动生成）
CLUSTER_INSTANCE_HOST=app1             # 实例主机名
CLUSTER_INSTANCE_REGION=hkg            # 实例区域
CLUSTER_HEARTBEAT_INTERVAL=30000       # 心跳间隔（毫秒）
CLUSTER_HEALTH_CHECK_INTERVAL=60000    # 健康检查间隔
CLUSTER_FAILOVER_TIMEOUT=120000        # 故障转移超时
```

#### Redis配置
```bash
REDIS_HOST=localhost                    # Redis主机
REDIS_PORT=6379                        # Redis端口
REDIS_PASSWORD=                         # Redis密码
REDIS_DB=0                             # Redis数据库
REDIS_KEY_PREFIX=arcadia:              # 键前缀
```

#### 监控配置
```bash
PROMETHEUS_ENABLED=true                 # 启用Prometheus指标
METRICS_INTERVAL=30000                 # 指标收集间隔
LOG_AGGREGATION_ENABLED=true           # 启用日志聚合
```

### 负载均衡配置

#### Nginx配置要点
- **粘性会话**：WebSocket连接使用ip_hash
- **健康检查**：定期检查实例状态
- **限流**：API请求限流保护
- **压缩**：启用gzip压缩
- **缓存**：静态资源缓存

#### 云负载均衡
- **会话亲和性**：确保WebSocket连接稳定
- **健康检查**：配置/health端点检查
- **SSL终止**：在负载均衡器层处理HTTPS
- **跨区域**：多区域部署提高可用性

## 监控和告警

### Prometheus指标

#### 应用指标
- `http_request_duration_seconds`：HTTP请求延迟
- `http_requests_total`：HTTP请求总数
- `socket_connections_active`：活跃Socket连接
- `battle_rooms_active`：活跃战斗房间
- `matchmaking_queue_size`：匹配队列大小
- `redis_operation_duration_seconds`：Redis操作延迟

#### 系统指标
- `nodejs_memory_usage_bytes`：内存使用量
- `nodejs_cpu_usage_percent`：CPU使用率
- `nodejs_uptime_seconds`：运行时间

### 告警规则

#### 关键告警
- **高CPU使用率**：> 80%
- **高内存使用**：> 1GB
- **Redis响应慢**：> 100ms
- **实例不健康**：< 1个健康实例
- **队列积压**：> 100人排队

#### 告警通知
- **Slack**：集成Slack通知
- **邮件**：SMTP邮件告警
- **Webhook**：自定义webhook通知

### Grafana仪表板

#### 系统概览
- 实例状态和负载
- 请求量和响应时间
- 错误率趋势

#### 业务指标
- 在线玩家数
- 战斗房间统计
- 匹配队列状态

#### 性能分析
- 数据库查询性能
- Redis操作延迟
- 内存和CPU使用

## 故障排除

### 常见问题

#### 实例无法启动
1. 检查Redis连接
2. 验证环境变量
3. 查看启动日志

#### 集群状态异常
1. 检查Redis连接
2. 验证实例注册
3. 检查网络连通性

#### WebSocket连接失败
1. 检查负载均衡配置
2. 验证粘性会话
3. 检查防火墙设置

#### 性能问题
1. 检查Redis性能
2. 分析慢查询
3. 监控资源使用

### 日志分析

#### 日志级别
- **ERROR**：错误和异常
- **WARN**：警告信息
- **INFO**：一般信息
- **DEBUG**：调试信息

#### 关键日志
- 实例注册/注销
- 集群状态变化
- 房间创建/销毁
- 匹配成功/失败

## 最佳实践

### 部署策略
1. **蓝绿部署**：零停机更新
2. **滚动更新**：逐步替换实例
3. **金丝雀发布**：小流量验证

### 扩展策略
1. **自动扩展**：基于CPU/内存使用率
2. **预测扩展**：基于历史数据
3. **手动扩展**：高峰期手动调整

### 安全考虑
1. **网络隔离**：VPC/子网隔离
2. **访问控制**：IAM权限管理
3. **数据加密**：传输和存储加密
4. **定期更新**：及时更新依赖

### 备份恢复
1. **Redis备份**：定期备份集群状态
2. **配置备份**：版本控制配置文件
3. **灾难恢复**：跨区域备份策略

## 成本优化

### 资源优化
1. **实例规格**：根据负载选择合适规格
2. **自动缩放**：非高峰期减少实例
3. **预留实例**：长期使用考虑预留

### 监控成本
1. **资源使用率**：监控CPU/内存使用
2. **网络流量**：优化数据传输
3. **存储成本**：定期清理日志和指标

## 支持和维护

### 定期维护
1. **依赖更新**：定期更新依赖包
2. **安全补丁**：及时应用安全更新
3. **性能优化**：定期性能调优

### 监控检查
1. **每日检查**：实例状态和告警
2. **每周检查**：性能趋势分析
3. **每月检查**：容量规划评估

### 文档更新
1. **运维手册**：保持文档最新
2. **故障手册**：记录故障处理经验
3. **变更记录**：记录重要变更
