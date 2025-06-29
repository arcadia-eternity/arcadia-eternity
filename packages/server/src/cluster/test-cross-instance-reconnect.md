# 跨实例重连问题修复说明

## 问题描述

在集群环境中，当玩家重连时，如果重连的实例不是实际房间存在的实例，会出现以下问题：

1. `getLocalBattle()` 返回 `null`，因为房间不在当前实例
2. 无法获取战斗状态 (`fullBattleState` 为空)
3. 无法获取计时器状态
4. 无法恢复计时器

## 修复内容

### 1. 修复重连时获取战斗状态 (handlePlayerReconnect)

**修复前：**
```typescript
const battle = this.getLocalBattle(reconnectInfo.roomId)
if (battle) {
  fullBattleState = battle.getState(socket.data.playerId! as playerId, false)
}
```

**修复后：**
```typescript
// 检查房间是否在当前实例
if (this.isRoomInCurrentInstance(currentRoomState)) {
  // 房间在当前实例，直接获取本地战斗状态
  const battle = this.getLocalBattle(reconnectInfo.roomId)
  if (battle) {
    fullBattleState = battle.getState(socket.data.playerId! as playerId, false)
  }
} else {
  // 房间在其他实例，通过跨实例调用获取战斗状态
  fullBattleState = await this.forwardPlayerAction(
    currentRoomState.instanceId, 
    'getState', 
    socket.data.playerId!, 
    { roomId: reconnectInfo.roomId }
  )
}
```

### 2. 修复发送战斗状态到玩家 (sendBattleStateToPlayer)

**修复前：**
```typescript
const battle = this.getLocalBattle(roomId)
if (battle) {
  // 只能处理本地战斗
}
```

**修复后：**
```typescript
// 获取房间状态以确定房间所在实例
const roomState = await this.stateManager.getRoomState(roomId)

// 检查房间是否在当前实例
if (this.isRoomInCurrentInstance(roomState)) {
  // 房间在当前实例，直接获取本地战斗
  const battle = this.getLocalBattle(roomId)
  // ...
} else {
  // 房间在其他实例，通过跨实例调用获取计时器状态
  const timerState = await this.forwardPlayerAction(
    roomState.instanceId, 
    'getPlayerTimerState', 
    playerId, 
    { roomId, playerId }
  )
}
```

### 3. 修复重连后恢复战斗 (resumeBattleAfterReconnect)

**修复前：**
```typescript
const battle = this.getLocalBattle(roomId)
if (battle) {
  // 只能恢复本地战斗的计时器
  battle.timerManager.resumeTimers([playerId as playerId])
}
```

**修复后：**
```typescript
// 获取房间状态以确定房间所在实例
const roomState = await this.stateManager.getRoomState(roomId)

// 检查房间是否在当前实例
if (this.isRoomInCurrentInstance(roomState)) {
  // 房间在当前实例，直接处理本地战斗
  const battle = this.getLocalBattle(roomId)
  if (battle) {
    battle.timerManager.resumeTimers([playerId as playerId])
  }
} else {
  // 房间在其他实例，记录日志
  // 实际的计时器恢复会在目标实例的重连处理中完成
  logger.info({ roomId, playerId, roomInstance: roomState.instanceId }, 
    '跨实例重连，计时器恢复将在目标实例处理')
}
```

## 测试场景

1. **同实例重连**：玩家重连到房间所在的同一实例 ✅
2. **跨实例重连**：玩家重连到房间不在的其他实例 ✅ (修复后)
3. **房间不存在**：玩家重连时房间已被清理 ✅
4. **实例不健康**：目标实例不可达时的错误处理 ✅

## 关键改进

1. **统一的实例检查**：使用 `isRoomInCurrentInstance()` 方法统一检查房间所在实例
2. **跨实例调用**：使用 `forwardPlayerAction()` 方法进行跨实例操作
3. **错误处理**：增加了完善的错误处理和日志记录
4. **状态一致性**：确保无论在哪个实例重连，都能获取到正确的战斗状态

## 注意事项

- 跨实例调用会增加网络延迟，但保证了功能的正确性
- 错误处理确保即使跨实例调用失败，重连流程也能继续
- 日志记录帮助调试跨实例问题
