# ConfigSystem 生命周期管理

## 概述

ConfigSystem 现在具有完整的生命周期管理功能，包括自动清理和资源释放。当 Battle 实例结束时，相关的 ConfigSystem 实例及其所有订阅都会被自动清理。

## 主要特性

### 1. Battle 级别的实例注册

每个 ConfigSystem 实例都会自动注册到对应的 Battle：

```typescript
// ConfigSystem 会自动注册到 battle
const battle = new Battle(playerA, playerB)
console.log('Battle ID:', battle.id)
console.log('ConfigSystem Battle ID:', battle.configSystem.getBattleId())
```

### 2. 自动清理机制

当 Battle 清理时，ConfigSystem 会自动清理：

```typescript
class Battle {
  public async cleanup() {
    this.clearListeners()
    await this.phaseManager.cleanup()

    // 自动清理所有与此 Battle 关联的 AttributeSystem 实例
    const attributeCleanedCount = AttributeSystem.cleanupBattle(this.id)
    
    // 自动清理所有与此 Battle 关联的 ConfigSystem 实例
    const configCleanedCount = ConfigSystem.cleanupBattle(this.id)
  }
}
```

### 3. 资源清理

ConfigSystem 的 `cleanup()` 方法会清理：

- 所有 BehaviorSubject 和 Observable 订阅
- 所有 ConfigModifier 实例及其订阅
- 所有内部映射和数组
- 阶段类型跟踪数据

### 4. 销毁状态检查

销毁后的 ConfigSystem 实例会拒绝新的操作：

```typescript
// 销毁后的操作会被拒绝并显示警告
configSystem.get('some.config') // 返回 undefined 并显示警告
configSystem.registerConfig('new.config', 'value') // 显示警告并忽略
```

## API 参考

### 静态方法

#### `ConfigSystem.createInstance(battleId?: string): ConfigSystem`
创建新的 ConfigSystem 实例，可选择性地关联到特定的 Battle。

#### `ConfigSystem.cleanupBattle(battleId: string): number`
清理与特定 Battle 关联的所有 ConfigSystem 实例，返回清理的实例数量。

#### `ConfigSystem.cleanupAllBattles(): number`
清理所有 Battle 的 ConfigSystem 实例，返回清理的总实例数量。

#### `ConfigSystem.getBattleInstances(battleId: string): Set<ConfigSystem> | undefined`
获取与特定 Battle 关联的所有 ConfigSystem 实例。

#### `ConfigSystem.getGlobalMemoryStats(): { totalBattles: number, totalInstances: number, activeInstances: number }`
获取全局内存统计信息，用于调试和监控。

### 实例方法

#### `cleanup(): void`
清理所有资源和订阅，但不销毁实例。

#### `destroy(): void`
完全销毁实例，包括从 Battle 注册表中移除。

#### `getIsDestroyed(): boolean`
检查实例是否已被销毁。

#### `getBattleId(): string | undefined`
获取关联的 Battle ID。

## 使用示例

### 基本使用

```typescript
// 创建 Battle 时自动创建 ConfigSystem
const battle = new Battle(playerA, playerB)

// 注册配置
battle.configSystem.registerConfig('damage.multiplier', 1.0)

// 使用配置
const multiplier = battle.configSystem.get('damage.multiplier')

// Battle 结束时自动清理
await battle.cleanup()
```

### 手动清理

```typescript
// 手动清理特定 Battle 的 ConfigSystem 实例
const cleanedCount = ConfigSystem.cleanupBattle(battle.id)
console.log(`Cleaned ${cleanedCount} ConfigSystem instances`)

// 清理所有 Battle 的实例
const totalCleaned = ConfigSystem.cleanupAllBattles()
console.log(`Total cleaned: ${totalCleaned} instances`)
```

### 内存监控

```typescript
// 获取内存统计
const stats = ConfigSystem.getGlobalMemoryStats()
console.log('Total battles:', stats.totalBattles)
console.log('Total instances:', stats.totalInstances)
console.log('Active instances:', stats.activeInstances)
```

## 注意事项

1. **自动清理**：Battle 的 `cleanup()` 方法会自动清理关联的 ConfigSystem 实例，通常不需要手动调用。

2. **销毁检查**：销毁后的 ConfigSystem 实例会拒绝新的操作并显示警告，这有助于发现潜在的内存泄漏问题。

3. **向后兼容**：现有代码无需修改，新的清理机制是自动的。

4. **内存效率**：通过自动清理，避免了长时间运行应用中的内存泄漏问题。

## 测试

可以运行 `packages/battle/test/configSystemLifecycleTest.js` 来验证清理功能：

```bash
cd packages/battle
npm run build
node test/configSystemLifecycleTest.js
```

测试会验证：
- ConfigSystem 实例的创建和注册
- 配置的注册和使用
- 单个 Battle 的清理
- 批量清理
- 销毁后的操作拒绝
