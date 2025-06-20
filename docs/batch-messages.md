# 批量消息系统 (Batch Messages)

本文档介绍新实现的批量消息系统，用于优化战斗中的Socket.IO消息传输成本。

## 概述

战斗系统通常会在短时间内发送大量消息（通常500+条），这会导致较高的网络传输成本。批量消息系统通过将多个消息合并为一个批次发送来优化传输效率。

## 架构设计

### 1. 协议层 (Protocol)

在 `packages/protocol/src/protocol.ts` 中添加了新的事件类型：

```typescript
export interface ServerToClientEvents {
  // 原有的单个战斗事件
  battleEvent: (message: BattleMessage) => void
  // 新增的批量战斗事件
  battleEventBatch: (messages: BattleMessage[]) => void
  // ... 其他事件
}
```

### 2. 服务端 (Server)

在 `packages/server/src/cluster/clusterBattleServer.ts` 中实现了批量消息处理：

#### 核心配置
- `BATCH_SIZE`: 10 - 批量大小阈值
- `BATCH_TIMEOUT`: 50ms - 批量超时时间

#### 主要方法
- `addToBatch()`: 将消息添加到批次中
- `flushBatch()`: 立即发送批次中的所有消息
- `cleanupAllBatches()`: 清理所有待处理的批次

#### 批量策略
1. **大小触发**: 当批次达到10个消息时立即发送
2. **时间触发**: 50ms超时后自动发送
3. **重要消息**: `BATTLE_END`、`BATTLE_START`等重要消息立即发送
4. **智能选择**: 单个消息使用`battleEvent`，多个消息使用`battleEventBatch`

### 3. 客户端 (Client)

在 `packages/client/src/client.ts` 中添加了批量消息处理：

```typescript
// 处理批量战斗事件
this.socket.on('battleEventBatch', messages => {
  // 逐个处理批量消息
  for (const message of messages) {
    // 触发单个battleEvent处理器
    const handlers = this.eventHandlers.get('battleEvent')
    if (handlers) {
      handlers.forEach(handler => handler(message))
    }
    
    // 检查是否有战斗结束消息
    if (message.type === 'BATTLE_END') {
      this.updateState({ battle: 'ended' })
    }
  }
})
```

### 4. 前端兼容性

前端代码无需修改，因为：
- 批量消息在客户端被分解为单个消息
- 现有的`battleEvent`处理器继续正常工作
- 保持了完全的向后兼容性

## 性能优化

### 传输效率
- **减少网络请求数**: 将多个小消息合并为一个大消息
- **降低协议开销**: 减少Socket.IO的消息头开销
- **智能批量**: 根据消息重要性和时间敏感性调整策略

### 内存管理
- **自动清理**: 服务器关闭时自动清理所有批次
- **超时保护**: 防止消息长时间积压
- **内存限制**: 批量大小限制防止内存过度使用

## 使用场景

### 适合批量的消息类型
- 连续的伤害消息
- 属性变化消息
- 印记应用/移除消息
- 状态更新消息

### 不适合批量的消息类型
- 战斗开始/结束消息
- 关键的同步消息
- 需要立即响应的消息

## 配置参数

可以通过修改以下参数来调整批量行为：

```typescript
private readonly BATCH_SIZE = 10 // 批量大小
private readonly BATCH_TIMEOUT = 50 // 批量超时时间（毫秒）
```

## 监控和调试

### 日志记录
- 批量发送成功/失败日志
- 批量大小和处理时间统计
- 清理操作日志

### 性能指标
- 消息批量化率
- 平均批量大小
- 传输延迟改善

## 向后兼容性

- 现有客户端无需更新即可工作
- 单个消息仍使用原有的`battleEvent`
- 渐进式升级支持

## 未来扩展

1. **动态批量大小**: 根据网络条件调整批量参数
2. **消息优先级**: 不同类型消息的优先级处理
3. **压缩支持**: 对大批量消息进行压缩
4. **统计分析**: 详细的性能分析和优化建议
