# AttributeSystem 内存管理系统

## 🎯 内存管理目标

为了防止长时间运行的游戏中出现内存泄漏，AttributeSystem实现了完善的内存管理机制：

1. **自动清理**：定期清理不活跃的实例
2. **手动销毁**：提供显式的资源释放方法
3. **内存监控**：实时监控内存使用情况
4. **泄漏防护**：防止循环引用导致的内存泄漏
5. **跨平台兼容**：支持浏览器和Node.js环境

## 🔧 核心机制

### 1. 实例注册与跟踪

```typescript
// 每个AttributeSystem实例都会自动注册
private static instanceRegistry = new Set<AttributeSystem<any>>()

constructor(objectName?: string) {
  this.objectId = objectName || `AttributeSystem_${nanoid(8)}`

  // 自动注册实例
  AttributeSystem.instanceRegistry.add(this)

  // 启动全局清理机制
  if (!AttributeSystem.cleanupInterval) {
    AttributeSystem.startGlobalCleanup()
  }
}
```

### 2. 访问时间跟踪

```typescript
private lastAccessTime = Date.now()

getCurrentValue(key: AttributeKey): number | boolean | string {
  if (this.isDestroyed) {
    console.warn(`Attempting to access destroyed AttributeSystem ${this.objectId}`)
    return this.getFallbackValue(key)
  }

  // 更新最后访问时间
  this.updateLastAccessTime()

  // ... 其他逻辑
}
```

### 3. 跨平台定时器

```typescript
// 使用ReturnType获取正确的定时器类型，兼容浏览器和Node.js
private static cleanupInterval: ReturnType<typeof setInterval> | null = null

private static startGlobalCleanup(): void {
  AttributeSystem.cleanupInterval = setInterval(() => {
    AttributeSystem.performGlobalCleanup()
  }, AttributeSystem.CLEANUP_INTERVAL)
}

static stopGlobalCleanup(): void {
  if (AttributeSystem.cleanupInterval !== null) {
    clearInterval(AttributeSystem.cleanupInterval)
    AttributeSystem.cleanupInterval = null
  }
}
```

### 4. 自动清理机制

```typescript
// 每分钟检查一次，清理超过5分钟未访问的实例
private static readonly CLEANUP_INTERVAL = 60000 // 1分钟
private static readonly MAX_INACTIVE_TIME = 300000 // 5分钟

private static performGlobalCleanup(): void {
  const now = Date.now()
  const instancesToCleanup: AttributeSystem<any>[] = []

  for (const instance of AttributeSystem.instanceRegistry) {
    if (instance.isDestroyed) {
      instancesToCleanup.push(instance)
    } else if (now - instance.lastAccessTime > AttributeSystem.MAX_INACTIVE_TIME) {
      console.warn(`AttributeSystem ${instance.objectId} inactive for ${Math.floor((now - instance.lastAccessTime) / 60000)} minutes, cleaning up...`)
      instancesToCleanup.push(instance)
    }
  }

  instancesToCleanup.forEach(instance => instance.destroy())
}
```

## 📊 内存监控

### 1. 实例级别监控

```typescript
const memoryStats = attributeSystem.getMemoryStats()
console.log('Instance memory usage:', {
  objectId: memoryStats.objectId,
  attributeCount: memoryStats.attributeCount,
  modifierCount: memoryStats.modifierCount,
  subscriptionCount: memoryStats.subscriptionCount,
  inactiveTime: Math.floor(memoryStats.inactiveTime / 1000) + 's',
})
```

### 2. 全局级别监控

```typescript
const globalStats = AttributeSystem.getGlobalMemoryStats()
console.log('Global memory usage:', {
  totalInstances: globalStats.totalInstances,
  activeInstances: globalStats.activeInstances,
  destroyedInstances: globalStats.destroyedInstances,
  globalCalculationStackSize: globalStats.globalCalculationStackSize,
  globalDependencyGraphSize: globalStats.globalDependencyGraphSize,
  oldestInactiveTime: Math.floor(globalStats.oldestInactiveTime / 60000) + ' minutes',
})
```

## 🗑️ 资源清理

### 1. 手动销毁

```typescript
// 手动销毁实例
attributeSystem.destroy()

// 检查是否已销毁
if (attributeSystem.isInstanceDestroyed()) {
  console.log('Instance has been destroyed')
}
```

### 2. 强制清理

```typescript
// 强制清理所有已销毁的实例
const cleanedCount = AttributeSystem.forceCleanupDestroyedInstances()
console.log(`Cleaned up ${cleanedCount} destroyed instances`)

// 强制清理不活跃的实例
const inactiveCount = AttributeSystem.forceCleanupInactiveInstances(60000) // 1分钟
console.log(`Cleaned up ${inactiveCount} inactive instances`)
```

### 3. 完整清理

```typescript
// 停止自动清理
AttributeSystem.stopGlobalCleanup()

// 清理所有全局跟踪数据
AttributeSystem.clearGlobalTracking()
```

## 📋 实际测试结果

### 基础内存跟踪

```console
=== Memory Management Test ===

Test 1: Basic memory tracking
Initial global memory stats:
Total instances: 3
Active instances: 3
Global calculation stack size: 3

Test 2: Individual instance memory stats
Pet1 stats: {
  objectId: 'Pet_test_pet_1',
  attributeCount: 2,
  modifierCount: 0,
  subscriptionCount: 2,
  inactiveTime: '0s'
}
Pet1 stats after adding modifiers: {
  attributeCount: 2,
  modifierCount: 2,
  subscriptionCount: 2
}
```

### 销毁和清理

```console
Test 3: Manual destruction
Before destruction:
Pet1 attack: 125
Pet1 is destroyed: false

Destroying AttributeSystem Pet_test_pet_1
AttributeSystem Pet_test_pet_1 destroyed successfully

After destruction:
Pet1 is destroyed: true
Attempting to access destroyed AttributeSystem Pet_test_pet_1
Pet1 attack (should be fallback): [fallback value]

Global stats after destruction:
Active instances: 2
Destroyed instances: 0
```

## 🎮 Battle生命周期集成

### 1. Battle关联的AttributeSystem

```typescript
// 创建与Battle关联的AttributeSystem
const pet = new PetAttributeSystem('fire_dragon', battle.id)
const player = new PlayerAttributeSystem('player1', battle.id)

// 系统会自动将实例注册到对应的Battle
console.log('Pet battle ID:', pet.getBattleId()) // battle.id
console.log('Player battle ID:', player.getBattleId()) // battle.id

// 查看Battle关联的所有实例
const battleInstances = AttributeSystem.getBattleInstances(battle.id)
console.log('Battle instances count:', battleInstances?.size)
```

### 2. Battle结束时的自动清理

```typescript
class Battle {
  public async cleanup() {
    this.clearListeners()
    await this.phaseManager.cleanup()

    // 自动清理所有与此Battle关联的AttributeSystem实例
    const cleanedCount = AttributeSystem.cleanupBattle(this.id)
    if (cleanedCount > 0) {
      console.log(`Battle ${this.id} cleanup: removed ${cleanedCount} AttributeSystem instances`)
    }
  }
}
```

### 3. 跨Battle隔离

```typescript
// 不同Battle的AttributeSystem实例完全隔离
const battle1 = new Battle('battle_001')
const battle2 = new Battle('battle_002')

const pet1 = new PetAttributeSystem('pet1', battle1.id)
const pet2 = new PetAttributeSystem('pet2', battle2.id)

// 清理battle1不会影响battle2
AttributeSystem.cleanupBattle(battle1.id)
console.log('Pet1 destroyed:', pet1.isInstanceDestroyed()) // true
console.log('Pet2 still active:', !pet2.isInstanceDestroyed()) // true
```

### 4. 批量Battle清理

```typescript
// 清理所有Battle及其关联的AttributeSystem实例
const totalCleaned = AttributeSystem.cleanupAllBattles()
console.log(`Cleaned up ${totalCleaned} instances from all battles`)

// 查看Battle注册表
const battleRegistry = AttributeSystem.getBattleRegistry()
console.log('Active battles:', battleRegistry.size)
```

### 2. 定期内存检查

```typescript
// 在游戏主循环中定期检查内存使用
setInterval(() => {
  const stats = AttributeSystem.getGlobalMemoryStats()

  if (stats.totalInstances > 100) {
    console.warn(`High instance count: ${stats.totalInstances}`)

    // 强制清理不活跃的实例
    const cleaned = AttributeSystem.forceCleanupInactiveInstances(120000) // 2分钟
    console.log(`Cleaned up ${cleaned} inactive instances`)
  }
}, 30000) // 每30秒检查一次
```

### 3. 宠物切换时的清理

```typescript
class PetManager {
  switchPet(oldPet: Pet, newPet: Pet): void {
    // 销毁旧宠物的AttributeSystem
    oldPet.attributeSystem.destroy()

    // 创建新宠物的AttributeSystem
    newPet.attributeSystem = new PetAttributeSystem(newPet.id)
    newPet.attributeSystem.initializeAttributes()
  }
}
```

## ⚠️ 最佳实践

### 1. 及时销毁

```typescript
// ✅ 推荐：在不需要时及时销毁
class GameEntity {
  private attributeSystem: AttributeSystem<any>

  destroy(): void {
    // 销毁AttributeSystem
    this.attributeSystem.destroy()

    // 清理其他资源
    this.cleanup()
  }
}
```

### 2. 避免长期持有引用

```typescript
// ❌ 避免：长期持有已销毁实例的引用
const oldReference = pet.attributeSystem
pet.destroy() // 销毁了AttributeSystem
// oldReference 仍然持有引用，可能导致内存泄漏

// ✅ 推荐：及时清理引用
let attributeSystem = pet.attributeSystem
pet.destroy()
attributeSystem = null // 清理引用
```

### 3. 监控内存使用

```typescript
// 开发环境中启用详细的内存监控
if (process.env.NODE_ENV === 'development') {
  setInterval(() => {
    const stats = AttributeSystem.getGlobalMemoryStats()
    console.log('Memory stats:', {
      instances: stats.totalInstances,
      active: stats.activeInstances,
      oldestInactive: Math.floor(stats.oldestInactiveTime / 60000) + 'min',
    })

    // 详细的实例信息
    stats.memoryUsageByInstance.forEach(instance => {
      if (instance.inactiveTime > 120000) {
        // 超过2分钟未访问
        console.warn(`Inactive instance: ${instance.objectId} (${Math.floor(instance.inactiveTime / 60000)}min)`)
      }
    })
  }, 60000) // 每分钟检查
}
```

## 🔧 配置选项

### 1. 调整清理间隔

```typescript
// 修改清理间隔（需要在源码中修改）
private static readonly CLEANUP_INTERVAL = 30000 // 30秒
private static readonly MAX_INACTIVE_TIME = 120000 // 2分钟
```

### 2. 自定义清理策略

```typescript
// 实现自定义清理逻辑
class CustomAttributeSystem extends AttributeSystem<any> {
  static customCleanup(): void {
    const stats = AttributeSystem.getGlobalMemoryStats()

    // 自定义清理条件
    if (stats.totalInstances > 50) {
      AttributeSystem.forceCleanupInactiveInstances(60000) // 1分钟
    }
  }
}
```

## ✅ 内存管理保证

1. **无内存泄漏**：所有订阅和引用都会被正确清理
2. **自动回收**：不活跃的实例会被自动清理
3. **资源释放**：BehaviorSubject和Observable会被正确完成
4. **全局清理**：跨对象的引用和依赖会被清理
5. **Battle生命周期集成**：与Battle生命周期完全同步的清理机制
6. **跨Battle隔离**：不同Battle的实例完全隔离，互不影响
7. **批量清理**：支持按Battle批量清理和全局清理
8. **跨平台兼容**：在浏览器和Node.js环境下都能正常工作
9. **监控友好**：提供丰富的内存使用统计信息

### 🎯 Battle生命周期集成优势

- **自动关联**：AttributeSystem实例自动与Battle关联
- **同步清理**：Battle结束时自动清理所有相关实例
- **隔离保证**：不同Battle之间的实例完全隔离
- **批量管理**：支持按Battle ID进行批量操作
- **零配置**：开发者无需手动管理实例生命周期

这个内存管理系统确保了AttributeSystem在长时间运行的游戏中不会出现内存泄漏，特别是在多Battle场景下，提供了完善的生命周期管理和跨平台兼容性。
