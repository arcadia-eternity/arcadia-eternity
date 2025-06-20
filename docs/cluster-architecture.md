# ServerV2 集群架构设计

## 概述

本文档描述了将 ServerV2 从单实例架构重构为支持集群的分布式架构的设计方案。

## 当前架构限制

### 单实例架构问题

1. **内存状态管理**：战斗房间、玩家连接、匹配队列存储在单进程内存中
2. **Socket.IO单实例**：WebSocket连接绑定到单个服务器实例
3. **认证状态本地化**：JWT黑名单和会话状态无法跨实例同步
4. **单点故障**：实例崩溃导致所有状态丢失
5. **扩展性限制**：无法水平扩展以处理更多并发用户

## 集群架构设计

### 整体架构图

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Load Balancer │    │   Load Balancer │    │   Load Balancer │
│   (Nginx/HAProxy)│    │   (Nginx/HAProxy)│    │   (Nginx/HAProxy)│
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          ▼                      ▼                      ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   ServerV2      │    │   ServerV2      │    │   ServerV2      │
│   Instance 1    │    │   Instance 2    │    │   Instance N    │
│                 │    │                 │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │Socket.IO    │ │    │ │Socket.IO    │ │    │ │Socket.IO    │ │
│ │+ Redis      │ │    │ │+ Redis      │ │    │ │+ Redis      │ │
│ │  Adapter    │ │    │ │  Adapter    │ │    │ │  Adapter    │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
│                 │    │                 │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │Cluster      │ │    │ │Cluster      │ │    │ │Cluster      │ │
│ │Manager      │ │    │ │Manager      │ │    │ │Manager      │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌─────────────▼─────────────┐
                    │      Redis Cluster        │
                    │                           │
                    │ ┌─────────────────────┐   │
                    │ │ Session Storage     │   │
                    │ │ Room State          │   │
                    │ │ Player Connections  │   │
                    │ │ Matchmaking Queue   │   │
                    │ │ Auth Blacklist      │   │
                    │ │ Service Registry    │   │
                    │ └─────────────────────┘   │
                    └───────────────────────────┘
                                 │
                    ┌─────────────▼─────────────┐
                    │     Supabase Database     │
                    │                           │
                    │ ┌─────────────────────┐   │
                    │ │ Players             │   │
                    │ │ Battle Reports      │   │
                    │ │ Email Verification  │   │
                    │ └─────────────────────┘   │
                    └───────────────────────────┘
```

### 核心组件

#### 1. 集群状态管理层 (Cluster State Manager)

- **Redis作为中央状态存储**
- **会话存储**：玩家连接状态、认证信息
- **房间状态同步**：战斗房间状态跨实例共享
- **玩家连接映射**：玩家ID到实例的映射关系

#### 2. Socket.IO集群支持

- **Redis适配器**：使用`@socket.io/redis-adapter`
- **跨实例通信**：实现房间广播和私有消息
- **连接迁移**：支持玩家在实例间的无缝迁移

#### 3. 服务发现和负载均衡

- **服务注册中心**：基于Redis的实例注册
- **健康检查**：定期检查实例状态
- **负载均衡策略**：基于连接数和CPU使用率
- **故障转移**：自动检测和处理实例故障

#### 4. 分布式锁和事务

- **Redis分布式锁**：确保关键操作的原子性
- **匹配队列锁**：防止重复匹配
- **房间创建锁**：确保房间ID唯一性

#### 5. 认证和会话管理

- **JWT黑名单共享**：Redis存储撤销的token
- **会话状态同步**：跨实例的认证状态共享
- **令牌刷新协调**：防止并发刷新冲突

## 数据模型设计

### Redis数据结构

```typescript
// 玩家连接映射
player:connections:{playerId} -> {
  instanceId: string,
  socketId: string,
  lastSeen: timestamp,
  status: 'connected' | 'disconnected'
}

// 战斗房间状态
room:{roomId} -> {
  id: string,
  status: 'waiting' | 'active' | 'ended',
  players: [playerId1, playerId2],
  instanceId: string,
  lastActive: timestamp,
  battleState: BattleState
}

// 匹配队列
matchmaking:queue -> Set<playerId>
matchmaking:player:{playerId} -> {
  joinTime: timestamp,
  playerData: PlayerSchemaType
}

// 服务实例注册
service:instances -> Set<instanceId>
service:instance:{instanceId} -> {
  host: string,
  port: number,
  status: 'healthy' | 'unhealthy',
  lastHeartbeat: timestamp,
  connections: number,
  load: number
}

// JWT黑名单
auth:blacklist:{jti} -> {
  expiry: timestamp,
  reason: string
}

// 会话状态
session:{playerId} -> {
  accessToken: string,
  refreshToken: string,
  expiry: timestamp,
  instanceId: string
}
```

## 实现策略

### 阶段1：基础设施

1. 添加Redis依赖和配置
2. 创建集群状态管理器
3. 实现服务注册和发现

### 阶段2：Socket.IO集群化

1. 集成Redis适配器
2. 重构连接管理
3. 实现跨实例通信

### 阶段3：状态迁移

1. 将房间状态迁移到Redis
2. 重构匹配队列
3. 实现认证状态同步

### 阶段4：高级功能

1. 实现分布式锁
2. 添加故障转移机制
3. 优化性能和监控

## 兼容性保证

### API兼容性

- 保持所有现有REST API接口不变
- Socket.IO事件协议保持兼容
- 客户端无需修改

### 配置兼容性

- 默认启用集群模式
- 可通过 CLUSTER_ENABLED=false 禁用（不推荐）
- 向后兼容的环境变量

## 部署策略

### 开发环境

- 集群模式，单实例部署
- 需要Redis支持

### 生产环境

- 多实例部署
- Redis集群或单实例Redis
- 负载均衡器配置

### 监控和日志

- 集群级别的监控指标
- 分布式日志聚合
- 性能追踪和告警

## 风险评估

### 技术风险

- Redis单点故障：使用Redis集群或主从复制
- 网络分区：实现优雅降级机制
- 数据一致性：使用分布式锁和事务

### 运维风险

- 复杂性增加：提供详细文档和工具
- 调试困难：增强日志和监控
- 部署复杂：自动化部署流程

## 性能预期

### 扩展性

- 支持水平扩展到N个实例
- 线性增长的并发处理能力
- 负载均衡优化资源利用

### 可用性

- 99.9%+ 可用性目标
- 故障自动恢复
- 零停机部署支持

### 延迟

- Redis操作 < 1ms
- 跨实例通信 < 5ms
- 整体延迟增加 < 10ms
