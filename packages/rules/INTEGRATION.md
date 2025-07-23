# 规则系统集成指南

本文档说明如何将规则系统集成到现有的游戏系统中。

## 架构概述

规则系统采用分层架构，支持多场战斗并发：

- **全局规则注册表**: 管理所有可用的规则和规则集
- **战斗规则管理器**: 为单场战斗提供规则管理
- **队伍构建器规则管理器**: 为前端队伍构建提供验证
- **集成层**: 提供与现有系统的无缝集成

## 服务器端集成

### 1. 服务器启动时初始化

```typescript
// 在服务器启动时调用
import { ServerRuleIntegration } from '@arcadia-eternity/rules'

async function startServer() {
  // 初始化规则系统
  await ServerRuleIntegration.initializeServer()
  
  // 其他服务器初始化代码...
}
```

### 2. 修改战斗创建逻辑

```typescript
// 在 clusterBattleServer.ts 中修改 createLocalBattle 方法
import { ServerRuleIntegration } from '@arcadia-eternity/rules'

private async createLocalBattle(roomState: RoomState, player1Data: any, player2Data: any): Promise<Battle> {
  // 1. 验证战斗创建请求并应用规则
  const ruleSetId = roomState.metadata?.ruleSetId || 'casual_standard_ruleset'
  const battleValidation = await ServerRuleIntegration.validateBattleCreation(
    player1Data.team,
    player2Data.team,
    [ruleSetId], // 使用规则集ID数组
    {
      allowFaintSwitch: true,
      showHidden: false,
    }
  )

  // 2. 检查验证结果
  if (!battleValidation.validation.isValid) {
    throw new Error(`战斗验证失败: ${battleValidation.validation.errors.map(e => e.message).join(', ')}`)
  }

  // 3. 使用规则修改后的选项创建战斗
  const battle = new Battle(
    player1Data,
    player2Data,
    battleValidation.battleOptions
  )

  // 4. 绑定规则管理器到战斗
  await ServerRuleIntegration.bindRulesToBattle(battle, battleValidation.ruleManager)

  // 其余代码保持不变...
  return battle
}
```

### 3. 添加规则集支持

```typescript
// 在房间创建时指定规则集
interface RoomCreationOptions {
  sessions: string[]
  sessionPlayers: Record<string, string>
  metadata?: {
    ruleSetId?: string  // 指定规则集ID
    battleRecordId?: string
  }
}
```

## 前端集成

### 1. 应用启动时初始化

```typescript
// 在 main.ts 或应用入口文件中
import { ClientRuleIntegration } from '@arcadia-eternity/rules'

async function initializeApp() {
  // 初始化客户端规则系统
  await ClientRuleIntegration.initializeClient()
  
  // 其他应用初始化代码...
}
```

### 2. 修改队伍构建器验证逻辑

```typescript
// 在 teamBuilder.vue 中替换现有的验证函数
import { ClientRuleIntegration } from '@arcadia-eternity/rules'

// 替换原有的 validateTeam 函数
const validateTeam = (ruleSetId: string = 'casual_standard_ruleset') => {
  const validation = ClientRuleIntegration.validateTeam(currentTeam.value, [ruleSetId])

  if (!validation.isValid) {
    // 显示详细的错误信息
    const errorMessages = validation.errors.map(error => error.message)
    return errorMessages.join('\n')
  }

  // 显示警告信息（如果有）
  if (validation.warnings.length > 0) {
    const warningMessages = validation.warnings.map(warning => warning.message)
    console.warn('队伍验证警告:', warningMessages)
  }

  return null
}

// 添加实时验证
const validatePetInTeam = (pet: PetSchemaType, ruleSetId: string = 'casual_standard_ruleset') => {
  const validation = ClientRuleIntegration.validatePet(pet, currentTeam.value, [ruleSetId])
  return validation
}

// 获取构建建议
const getTeamSuggestions = (ruleSetId: string = 'casual_standard_ruleset') => {
  const suggestions = ClientRuleIntegration.getTeamBuildingSuggestions(currentTeam.value, [ruleSetId])
  return suggestions
}

// 检查是否可以添加更多精灵
const canAddPet = computed(() => {
  const ruleSetId = selectedRuleSetId.value || 'casual_standard_ruleset'
  return ClientRuleIntegration.canAddMorePets(currentTeam.value, [ruleSetId])
})
```

### 3. 添加游戏模式选择

```vue
<template>
  <div class="game-mode-selector">
    <el-select v-model="selectedGameMode" @change="onGameModeChange">
      <el-option
        v-for="mode in availableGameModes"
        :key="mode.id"
        :label="mode.name"
        :value="mode.id"
      >
        <span>{{ mode.name }}</span>
        <span class="mode-description">{{ mode.description }}</span>
      </el-option>
    </el-select>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ClientRuleIntegration } from '@arcadia-eternity/rules'

const selectedGameMode = ref('standard')
const availableGameModes = ref([])

onMounted(async () => {
  try {
    availableGameModes.value = await ClientRuleIntegration.getAvailableGameModes()
  } catch (error) {
    console.error('获取可用游戏模式失败:', error)
  }
})

const onGameModeChange = async (gameMode: string) => {
  try {
    await ClientRuleIntegration.setTeamBuilderGameMode(gameMode)
    // 重新验证当前队伍
    await validateTeam()
  } catch (error) {
    console.error('设置游戏模式失败:', error)
  }
}
</script>
```

## 默认规则设定

系统预设了以下默认规则，这些规则反映了当前游戏的基本限制：

### 休闲模式 (casual_standard_ruleset)

- 队伍大小: 1-6只精灵
- 等级限制: 1-100级
- 学习力限制: 总和510，单项252
- 计时器: 休闲计时器配置
- 性别限制: 根据精灵种族限制可选择的性别

### 竞技模式 (competitive_ruleset)

- 队伍大小: 必须6只精灵
- 等级限制: 必须100级
- 学习力限制: 总和510，单项252
- 计时器: 30秒/回合，15分钟总时间
- 精灵种族唯一性: 不允许相同种族的精灵

## 自定义规则

如果需要添加自定义规则，可以：

1. 创建自定义规则类
2. 在服务器启动时注册
3. 创建包含自定义规则的规则集

```typescript
// 示例：创建自定义规则
import { AbstractRule, ValidationResult } from '@arcadia-eternity/rules'

class CustomLevelRule extends AbstractRule {
  validatePet(pet: PetSchemaType): ValidationResult {
    // 自定义验证逻辑
  }
}

// 注册自定义规则
const registry = GlobalRuleRegistry.getRegistry()
registry.registerRule(new CustomLevelRule())
```

## 迁移现有代码

### 1. 替换硬编码的验证逻辑

- 将队伍构建器中的硬编码验证替换为规则系统调用
- 移除服务器端的硬编码战斗配置

### 2. 保持向后兼容

- 默认使用 'standard' 模式，保持现有行为
- 逐步迁移各个模块

### 3. 测试验证

- 确保现有功能正常工作
- 验证新的规则系统按预期工作

## 性能考虑

- 规则验证是轻量级操作，对性能影响很小
- 规则系统使用缓存机制，避免重复计算
- 每场战斗使用独立的规则管理器实例，避免冲突

## 错误处理

规则系统提供详细的错误信息和建议：

```typescript
const validation = ClientRuleIntegration.validateTeam(team)
if (!validation.isValid) {
  validation.errors.forEach(error => {
    console.error(`${error.code}: ${error.message}`)
    if (error.context) {
      console.error('上下文:', error.context)
    }
  })
}
```

这样的集成方式确保了：

1. 每场战斗都有独立的规则管理
2. 服务器可以同时支持多种游戏模式
3. 前端可以实时验证队伍
4. 保持了现有代码的兼容性
