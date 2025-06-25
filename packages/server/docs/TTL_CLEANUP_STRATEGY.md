# TTL 清理策略文档

## 概述

为了减少 Redis 命令使用量和降低 Upstash 成本，我们将大部分数据清理机制从手动定时清理改为使用 Redis TTL（Time To Live）自动过期机制。

## TTL 机制优势

1. **减少 Redis 命令使用**：不需要定期扫描和删除过期数据
2. **降低服务器负载**：减少定时清理任务的 CPU 和网络开销
3. **提高可靠性**：即使清理服务失败，数据也会自动过期
4. **简化代码逻辑**：减少复杂的清理逻辑和错误处理

## 数据类型和 TTL 策略

### 1. 服务实例数据
- **心跳 TTL**: 15分钟（生产）/ 6分钟（开发）
- **实例详情 TTL**: 20分钟（生产）/ 10分钟（开发）
- **策略**: 心跳停止后自动清理，无需手动检测

### 2. 玩家连接数据
- **会话连接 TTL**: 30分钟
- **活跃玩家索引 TTL**: 60分钟
- **策略**: 玩家断线后自动清理连接信息

### 3. 会话管理
- **会话数据 TTL**: 24小时
- **会话索引 TTL**: 25小时
- **策略**: 会话过期后自动清理，支持长时间离线

### 4. 房间状态
- **等待房间 TTL**: 30分钟
- **活跃房间 TTL**: 4小时
- **结束房间 TTL**: 2小时
- **房间索引 TTL**: 6小时
- **策略**: 根据房间状态动态设置 TTL

### 5. 匹配队列
- **队列条目 TTL**: 30分钟
- **队列索引 TTL**: 60分钟
- **策略**: 避免玩家长时间等待，自动清理过期匹配

### 6. 认证黑名单
- **黑名单 TTL**: 24小时或 JWT 过期时间（取较小值）
- **策略**: 与 JWT 生命周期同步

### 7. 分布式锁
- **默认锁 TTL**: 30秒
- **匹配锁 TTL**: 60秒
- **房间操作锁 TTL**: 30秒
- **玩家操作锁 TTL**: 10秒
- **策略**: 防止死锁，自动释放

### 8. 战报数据
- **活跃战斗 TTL**: 2小时
- **完成战斗 TTL**: 7天
- **策略**: 保留历史记录，定期清理

## 配置管理

### 环境变量配置
所有 TTL 值都可以通过环境变量配置：

```bash
# 服务实例 TTL
SERVICE_INSTANCE_HEARTBEAT_TTL=900000  # 15分钟
SERVICE_INSTANCE_DATA_TTL=1200000      # 20分钟

# 玩家连接 TTL
PLAYER_SESSION_CONNECTION_TTL=1800000  # 30分钟
ACTIVE_PLAYER_INDEX_TTL=3600000        # 60分钟

# 会话 TTL
SESSION_DATA_TTL=86400000              # 24小时
SESSION_INDEX_TTL=90000000             # 25小时

# 房间 TTL
WAITING_ROOM_TTL=1800000               # 30分钟
ACTIVE_ROOM_TTL=14400000               # 4小时
ENDED_ROOM_TTL=7200000                 # 2小时

# 匹配队列 TTL
MATCHMAKING_QUEUE_ENTRY_TTL=1800000    # 30分钟
MATCHMAKING_QUEUE_INDEX_TTL=3600000    # 60分钟

# 认证 TTL
AUTH_BLACKLIST_TTL=86400000            # 24小时

# 锁 TTL
DEFAULT_LOCK_TTL=30000                 # 30秒
MATCHMAKING_LOCK_TTL=60000             # 60秒
ROOM_ACTION_LOCK_TTL=30000             # 30秒
PLAYER_ACTION_LOCK_TTL=10000           # 10秒

# 战报 TTL
ACTIVE_BATTLE_TTL=7200000              # 2小时
COMPLETED_BATTLE_TTL=604800000         # 7天
```

### 代码中的使用

```typescript
import { TTLHelper } from './ttlConfig'

// 获取特定数据类型的 TTL
const sessionTTL = TTLHelper.getTTLForDataType('session')
const roomTTL = TTLHelper.getDynamicTTL('room', 'active', room.lastActive)

// 设置键的 TTL
await TTLHelper.setKeyTTL(client, key, ttl)

// 批量设置 TTL
await TTLHelper.setBatchTTL(client, [
  { key: 'key1', ttl: 3600000 },
  { key: 'key2', ttl: 7200000 }
])
```

## 保留的手动清理

虽然大部分清理工作现在由 TTL 处理，但以下情况仍需要手动清理：

### 1. 本地内存缓存
- **原因**: TTL 只影响 Redis，不影响应用内存
- **处理**: 保留定时清理内存缓存的逻辑

### 2. 业务逻辑清理
- **孤立匹配队列条目**: 需要检查连接状态
- **异常状态数据**: 需要业务逻辑判断

### 3. 索引重建
- **活跃玩家索引**: 定期重建以保证数据一致性
- **房间索引**: 处理数据不一致的情况

## 监控和调试

### 1. TTL 监控
```bash
# 检查键的 TTL
redis-cli TTL key_name
redis-cli PTTL key_name  # 毫秒精度

# 查看没有 TTL 的键（可能是异常情况）
redis-cli KEYS "*" | xargs -I {} redis-cli TTL {} | grep -B1 "^-1$"
```

### 2. 日志监控
- 查看 TTL 设置日志
- 监控手动清理的频率和数量
- 关注异常 TTL 值的警告

### 3. 性能监控
- Redis 命令使用量减少
- 清理任务执行时间缩短
- 服务器 CPU 和内存使用优化

## 最佳实践

### 1. TTL 值设置
- **保守设置**: 宁可设置稍长的 TTL，避免数据过早丢失
- **业务对齐**: TTL 应该与业务逻辑的超时时间对齐
- **环境区分**: 开发环境可以使用较短的 TTL 便于测试

### 2. 错误处理
- **TTL 设置失败**: 记录日志但不影响主要业务逻辑
- **数据丢失**: 设计时考虑数据可能因 TTL 过期而丢失
- **时钟偏差**: 考虑服务器时钟不同步的影响

### 3. 迁移策略
- **渐进迁移**: 逐步将清理逻辑改为 TTL
- **兼容性**: 保留旧的清理逻辑作为备份
- **监控验证**: 密切监控 TTL 机制的效果

## 故障排除

### 1. 数据过早过期
- 检查 TTL 配置是否过短
- 确认服务器时间同步
- 查看 Redis 内存策略设置

### 2. 数据未过期
- 检查 TTL 是否正确设置
- 确认 Redis 版本支持 TTL
- 查看是否有其他进程重置 TTL

### 3. 性能问题
- 监控 TTL 设置的频率
- 检查批量操作是否正确使用
- 确认没有频繁的 TTL 更新

## 总结

TTL 机制大大简化了数据清理逻辑，减少了 Redis 命令使用量，提高了系统的可靠性和性能。通过合理的配置和监控，可以实现高效的自动数据清理，同时保持业务逻辑的正确性。
