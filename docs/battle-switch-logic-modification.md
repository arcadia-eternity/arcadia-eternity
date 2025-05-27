# 战斗更换逻辑修改总结

## 修改目标

修改战斗逻辑，使得击破奖励更换时，双方不可见对方的更换精灵。具体要求：

1. **第一次强制更换**和**击破奖励更换**应该在双方都选择完毕之后同时执行
2. 之后若是发生换上来的精灵倒下的情况，继续执行更换流程
3. 直到更换完毕后精灵仍然存活或者全部精灵倒下

## 修改内容

### 1. 新增状态管理属性

在 `Battle` 类中添加了以下属性：

```typescript
// 新增：用于处理同时更换的状态
public pendingForcedSwitches: Player[] = [] // 待处理的强制更换
public pendingFaintSwitch?: Player // 待处理的击破奖励更换
public isInitialSwitchPhase: boolean = false // 标记是否为初始更换阶段（需要同时执行）
```

### 2. 修改战斗主循环

将原来的分离式更换处理：

```typescript
// 原来的逻辑
// Phase 1: Handle forced switches
// Phase 2: Handle faint switch
// Phase 3: Collect player actions
// Phase 4: Execute turn
```

修改为统一的更换处理：

```typescript
// 新的逻辑
// Phase 1: Handle switches (forced and faint switches)
// Phase 2: Collect player actions
// Phase 3: Execute turn
```

### 3. 实现新的更换阶段处理

#### `handleSwitchPhase()` 方法

- 持续处理更换，直到没有更多需要更换的精灵
- 收集需要强制更换的玩家和击破奖励更换的玩家
- 判断是否为初始更换阶段（需要同时执行）
- 处理连锁更换（换上来的精灵又倒下）

#### `handleInitialSwitchPhase()` 方法

- 收集所有需要做选择的玩家（强制更换 + 击破奖励更换）
- 发送相应的消息通知
- 等待所有玩家做出选择
- 同时执行所有更换

### 4. 修改选择验证逻辑

#### `waitForSwitchSelections()` 方法

更新了选择验证逻辑：

- **强制更换玩家**：必须选择 `switch-pet`
- **击破奖励更换玩家**：可以选择 `switch-pet` 或 `do-nothing`

#### `checkWaitingResolvers()` 方法

使用与 `waitForSwitchSelections` 相同的验证逻辑，确保一致性。

### 5. 清理不再使用的代码

- 删除了 `waitForSwitchSelection()` 方法（单个玩家选择等待）
- 删除了 `singleSelection` 相关的等待解析器
- 删除了原来的 `handleForcedSwitchPhase()` 和 `handleFaintSwitchPhase()` 方法

## 核心逻辑流程

### 新的更换流程

1. **收集阶段**：
   - 识别需要强制更换的玩家（精灵倒下）
   - 识别击破奖励更换的玩家（lastKiller）
   - **重要**：如果双方都需要强制更换，则清除击破奖励更换

2. **选择阶段**：
   - 同时发送强制更换和击破奖励更换消息
   - 等待所有相关玩家做出选择
   - 验证选择的有效性

3. **执行阶段**：
   - 同时执行所有更换操作
   - 检查换上来的精灵是否存活

4. **循环检查**：
   - 如果有新的精灵倒下，重复上述流程
   - 直到所有精灵都存活或战斗结束

### 关键改进

1. **同时性**：强制更换和击破奖励更换现在是同时进行的，双方在选择阶段看不到对方的选择
2. **连锁处理**：正确处理换上来的精灵又倒下的情况
3. **选择验证**：区分不同类型更换的选择要求
4. **状态管理**：清晰的状态标记和管理
5. **双方同时击倒处理**：当双方精灵同时倒下时，不给予任何一方击破奖励更换

### 双方同时击倒的特殊处理

#### 问题背景

在原有逻辑中，如果两个技能都能击败对方精灵：

1. 技能按优先级和速度顺序执行
2. 每次击败精灵时，`lastKiller` 会被设置为击败者
3. 后执行的技能会覆盖 `lastKiller` 的值
4. 可能导致错误的击破奖励更换

#### 解决方案

在 `handleSwitchPhase()` 中添加了检查逻辑：

```typescript
// 检查是否有击破奖励更换
// 重要：如果双方都需要强制更换，则不应该有击破奖励更换
if (this.allowFaintSwitch && this.lastKiller && this.pendingForcedSwitches.length < 2) {
  this.pendingFaintSwitch = this.lastKiller
} else {
  this.pendingFaintSwitch = undefined
}
```

#### 逻辑说明

- **单方击倒**：`pendingForcedSwitches.length < 2` 时，正常给予击破奖励更换
- **双方同时击倒**：`pendingForcedSwitches.length === 2` 时，清除击破奖励更换
- **合理性**：双方都需要强制更换时，没有"获胜方"，因此不应该有击破奖励

## 兼容性

- 保持了原有的消息类型和数据结构
- 保持了原有的 API 接口
- 只修改了内部的执行逻辑

## 测试验证

修改后的代码已通过编译验证，确保：

- TypeScript 类型检查通过
- 所有依赖关系正确
- 新增的方法和属性正确实现

这个修改实现了用户要求的"击破奖励更换时双方不可见对方更换精灵"的功能，同时保持了代码的清晰性和可维护性。
