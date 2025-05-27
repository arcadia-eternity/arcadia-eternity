# 跨对象循环依赖检测与防护

## 🌐 问题场景

在复杂的游戏系统中，属性依赖不仅存在于单个对象内部，还会跨越多个对象：

### 典型的跨对象依赖场景

1. **宠物间相互影响**
   ```
   Pet1.attack 依赖 Pet2.defense
   Pet2.defense 依赖 Pet1.attack
   ```

2. **宠物-玩家依赖**
   ```
   Pet.attack 依赖 Player.rage
   Player.rage 依赖 Pet.currentHp
   Pet.currentHp 依赖 Pet.attack (通过战斗计算)
   ```

3. **复杂依赖链**
   ```
   Pet1 → Pet2 → Player → Battle → Pet1
   ```

4. **印记系统跨对象影响**
   ```
   Mark1.effect 依赖 Pet1.stats
   Pet1.stats 依赖 Mark2.stack
   Mark2.stack 依赖 Mark1.effect
   ```

## 🛡️ 解决方案架构

### 1. 全局跟踪系统

```typescript
// 每个AttributeSystem实例都有唯一ID
private objectId: string = `Pet_${nanoid(8)}`

// 全局计算栈 - 跟踪所有对象的计算状态
private static globalCalculationStack = new Map<string, Set<string>>()

// 全局依赖图 - 跟踪跨对象依赖关系
private static globalDependencyGraph = new Map<string, Set<string>>()
```

### 2. 跨对象循环检测

```typescript
private wouldCreateCrossObjectCircularDependency(key: keyof T): boolean {
  const globalKey = `${this.objectId}.${String(key)}`
  
  // 检查是否在任何对象的计算栈中
  for (const [objectId, stack] of AttributeSystem.globalCalculationStack) {
    if (stack.has(globalKey)) {
      return true
    }
  }
  
  return false
}
```

### 3. 全局依赖图分析

```typescript
static hasGlobalCircularDependencies(): boolean {
  // 使用DFS检测全局依赖图中的环
  const visited = new Set<string>()
  const recursionStack = new Set<string>()

  const dfs = (node: string): boolean => {
    if (recursionStack.has(node)) return true // 发现环
    if (visited.has(node)) return false

    visited.add(node)
    recursionStack.add(node)

    const dependencies = AttributeSystem.globalDependencyGraph.get(node)
    if (dependencies) {
      for (const dep of dependencies) {
        if (dfs(dep)) return true
      }
    }

    recursionStack.delete(node)
    return false
  }

  // 检查所有节点
  for (const node of AttributeSystem.globalDependencyGraph.keys()) {
    if (!visited.has(node)) {
      if (dfs(node)) return true
    }
  }

  return false
}
```

## 📊 实际测试结果

### 基础跨对象设置
```console
=== Cross-Object Circular Dependency Test ===

Test 1: Basic cross-object setup
Pet1 ID: Pet_pet1
Pet2 ID: Pet_pet2
Player ID: Player_player1
Pet1 attack: 100
Pet2 attack: 90
Player rage: 50
```

### 跨对象循环依赖检测
```console
Test 3: Cross-object circular dependency simulation
Cross-object dependencies tracked
Has global circular dependencies: true

Test 4: Simulate cross-object access during calculation
Global calculation stack: Map(3) {
  'Pet_pet1' => Set(1) { 'Pet_pet1.attack' },
  'Pet_pet2' => Set(1) { 'Pet_pet2.defense' },
  'Player_player1' => Set(0) {}
}

Attempting cross-object access...
Circular dependency detected in getCurrentValue for 'attack', using fallback value
Pet1 attack (should use fallback): 125
Circular dependency detected in getCurrentValue for 'defense', using fallback value
Pet2 defense (should use fallback): 85
```

### 复杂依赖链检测
```console
Test 5: Complex multi-object dependency chain
Complex dependency chain created
Has global circular dependencies: true
Global dependency graph size: 3

Dependency relationships:
  Pet_pet1.attack -> Pet_pet2.defense
  Pet_pet2.defense -> Pet_pet1.attack
  Pet_pet2.defense -> Player_player1.currentRage
  Player_player1.currentRage -> Pet_pet1.attack
```

## 🎮 实际应用场景

### 场景1：队友增益系统

```typescript
// 队友1的攻击力基于队友2的防御力
const teammateBonus = new Modifier(
  DurationType.binding,
  'teammate_defense_bonus',
  computed(() => {
    const teammate2Defense = pet2.attributeSystem.getCurrentValue('defense')
    return Math.floor(teammate2Defense * 0.2)
  }, [pet2.attributeSystem.getAttribute$('defense')]),
  'delta',
  100
)

pet1.attributeSystem.addModifier('attack', teammateBonus)

// 如果pet2的防御力也依赖pet1的攻击力，系统会自动检测并处理
```

### 场景2：玩家-宠物联动

```typescript
// 宠物攻击力基于玩家怒气值
const rageBonus = new Modifier(
  DurationType.binding,
  'rage_attack_bonus',
  computed(() => {
    const currentRage = player.attributeSystem.getCurrentValue('currentRage')
    return Math.floor(currentRage * 0.5)
  }, [player.attributeSystem.getAttribute$('currentRage')]),
  'delta',
  150
)

pet.attributeSystem.addModifier('attack', rageBonus)

// 同时，玩家怒气值可能基于宠物状态变化
const petHpRageGain = new Modifier(
  DurationType.binding,
  'pet_hp_rage_gain',
  computed(() => {
    const petHpRatio = pet.attributeSystem.getCurrentValue('currentHp') / 
                      pet.attributeSystem.getCurrentValue('maxHp')
    return petHpRatio < 0.3 ? 20 : 0 // 低血量时获得怒气加成
  }, [pet.attributeSystem.getAttribute$('currentHp')]),
  'delta',
  100
)

player.attributeSystem.addModifier('currentRage', petHpRageGain)
```

### 场景3：印记系统跨对象影响

```typescript
// 印记1影响宠物1，但效果基于宠物2的状态
const crossPetMark = new Modifier(
  DurationType.binding,
  'cross_pet_mark_effect',
  computed(() => {
    const pet2Speed = pet2.attributeSystem.getCurrentValue('speed')
    return pet2Speed > 100 ? 30 : 0 // 队友速度高时获得攻击加成
  }, [pet2.attributeSystem.getAttribute$('speed')]),
  'delta',
  200
)

pet1.attributeSystem.addModifier('attack', crossPetMark)
```

## 🔧 开发者工具

### 1. 依赖关系跟踪

```typescript
// 手动跟踪跨对象依赖（用于调试）
pet1.attributeSystem.trackCrossObjectDependency(
  pet1.attributeSystem.getObjectId(), 'attack',
  pet2.attributeSystem.getObjectId(), 'defense'
)

// 检查全局循环依赖
if (AttributeSystem.hasGlobalCircularDependencies()) {
  console.warn('Detected cross-object circular dependencies!')
}
```

### 2. 调试信息

```typescript
// 查看全局计算栈
const globalStack = AttributeSystem.getGlobalCalculationStack()
console.log('Objects currently calculating:', globalStack)

// 查看全局依赖图
const globalGraph = AttributeSystem.getGlobalDependencyGraph()
for (const [from, toSet] of globalGraph) {
  for (const to of toSet) {
    console.log(`Dependency: ${from} -> ${to}`)
  }
}
```

### 3. 清理和重置

```typescript
// 清理所有全局跟踪数据
AttributeSystem.clearGlobalTracking()

// 清理单个对象的跟踪数据
pet.attributeSystem.clearCircularDependencyTracking()
```

## 🚨 最佳实践

### 1. 设计原则

- **最小化跨对象依赖**：尽量使用事件驱动而非直接依赖
- **单向数据流**：避免双向依赖，使用中介者模式
- **明确依赖层次**：建立清晰的依赖层次结构

### 2. 安全模式

```typescript
// ✅ 推荐：通过事件系统解耦
pet1.on('attackChanged', (newAttack) => {
  // 更新pet2的相关属性，而不是直接依赖
  pet2.updateDefenseBonus(newAttack)
})

// ✅ 推荐：使用中介者模式
class BattleMediator {
  updateTeammateEffects(sourcePet: Pet, targetPet: Pet) {
    // 集中处理队友间的影响，避免直接依赖
  }
}
```

### 3. 监控和告警

```typescript
// 开发环境监控
if (process.env.NODE_ENV === 'development') {
  setInterval(() => {
    if (AttributeSystem.hasGlobalCircularDependencies()) {
      console.warn('Cross-object circular dependencies detected!')
      console.log('Dependency graph:', AttributeSystem.getGlobalDependencyGraph())
    }
  }, 5000)
}
```

## ✅ 系统优势

1. **自动检测**：无需手动管理，系统自动检测跨对象循环依赖
2. **优雅降级**：使用fallback值保持系统稳定
3. **全局视野**：能够检测复杂的多对象依赖链
4. **调试友好**：提供丰富的调试信息和工具
5. **性能优化**：轻量级实现，不影响正常游戏性能

这个跨对象循环依赖检测系统确保了即使在最复杂的多对象交互场景下，游戏系统也能保持稳定运行，同时为开发者提供了强大的调试和监控工具。
