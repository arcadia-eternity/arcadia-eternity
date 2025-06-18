# Modifier UI 视觉效果使用示例

## 概述

本文档展示如何在 battlePage 中使用新的 modifier 视觉效果功能。所有受到 modifier 影响的数值现在都会显示特殊的视觉效果，包括颜色变化、发光效果和详细的 tooltip 信息。

## 组件使用示例

### 1. ModifiedValue 组件

这是核心组件，用于显示受 modifier 影响的数值：

```vue
<template>
  <!-- 基础用法 -->
  <ModifiedValue 
    :value="100" 
    :attribute-info="atkModifierInfo"
    size="md"
  />
  
  <!-- 内联显示 -->
  <span>攻击力: <ModifiedValue 
    :value="120" 
    :attribute-info="atkModifierInfo"
    size="sm"
    inline
  /></span>
  
  <!-- 禁用 tooltip -->
  <ModifiedValue 
    :value="80" 
    :attribute-info="defModifierInfo"
    :show-tooltip="false"
  />
</template>
```

### 2. BattleStatus 组件

现在自动显示受 modifier 影响的属性：

```vue
<template>
  <BattleStatus 
    :player="playerData"
    side="left"
  />
</template>
```

等级显示会自动使用 ModifiedValue 组件，如果等级受到 modifier 影响，会显示特殊效果。

### 3. HealthRageBar 组件

血条和怒气条现在支持 modifier 信息：

```vue
<template>
  <HealthRageBar
    :current="pet.currentHp"
    :max="pet.maxHp"
    :rage="player.rage"
    :maxRage="player.maxRage"
    :current-hp-modifier-info="hpModifierInfo.currentHp"
    :max-hp-modifier-info="hpModifierInfo.maxHp"
    :rage-modifier-info="rageModifierInfo.rage"
    :max-rage-modifier-info="rageModifierInfo.maxRage"
  />
</template>
```

### 4. SkillButton 组件

技能按钮现在支持显示技能属性的 modifier 效果：

```vue
<template>
  <SkillButton 
    :skill="skillData"
    :power-modifier-info="powerModifierInfo"
    :accuracy-modifier-info="accuracyModifierInfo"
    :rage-modifier-info="rageModifierInfo"
    @click="handleSkillClick"
  />
</template>
```

### 5. PetButton 组件

宠物按钮会自动检测 modifier 并显示视觉提示：

```vue
<template>
  <PetButton 
    :pet="petData"
    position="bottom"
    :is-active="isActivePet"
    @click="handlePetClick"
  />
</template>
```

## Modifier 效果类型

系统支持以下 modifier 效果类型，每种都有不同的视觉表现：

### 1. 增益效果 (buffed)
- **颜色**: 绿色 (`text-green-400`)
- **发光**: 绿色光晕
- **动画**: 脉冲效果
- **触发条件**: 正面的数值修改或百分比增加

### 2. 减益效果 (debuffed)
- **颜色**: 红色 (`text-red-400`)
- **发光**: 红色光晕
- **动画**: 脉冲效果
- **触发条件**: 负面的数值修改或百分比减少

### 3. 限制效果 (clamped)
- **颜色**: 橙色 (`text-orange-400`)
- **发光**: 橙色光晕
- **动画**: 警告脉冲
- **触发条件**: clampMax、clampMin 或 clamp 类型的修改器

### 4. 混合效果 (mixed)
- **颜色**: 紫色 (`text-purple-400`)
- **发光**: 紫色光晕
- **动画**: 复杂脉冲（多色变化）
- **触发条件**: 同时存在正面和负面修改器

### 5. 中性效果 (neutral)
- **颜色**: 蓝色 (`text-blue-400`)
- **发光**: 蓝色光晕
- **动画**: 微妙发光
- **触发条件**: 其他类型的修改器

## 数据结构要求

为了使用这些功能，需要确保 BattleState 包含正确的 modifier 信息：

```typescript
// PetMessage 需要包含 modifierState
interface PetMessage {
  // ... 其他属性
  modifierState?: EntityModifierState
}

// PlayerMessage 需要包含 modifierState
interface PlayerMessage {
  // ... 其他属性
  modifierState?: EntityModifierState
}

// EntityModifierState 结构
interface EntityModifierState {
  attributes: AttributeModifierInfo[]
  hasModifiers: boolean
}

// AttributeModifierInfo 结构
interface AttributeModifierInfo {
  attributeName: string
  baseValue: number | boolean | string
  currentValue: number | boolean | string
  modifiers: ModifierInfo[]
  isModified: boolean
}
```

## 样式自定义

可以通过 CSS 变量自定义 modifier 效果的外观：

```css
:root {
  --modifier-buffed-color: rgb(34, 197, 94);
  --modifier-debuffed-color: rgb(239, 68, 68);
  --modifier-clamped-color: rgb(251, 146, 60);
  --modifier-mixed-color: rgb(168, 85, 247);
  --modifier-neutral-color: rgb(59, 130, 246);
}
```

## 无障碍支持

系统包含完整的无障碍支持：

- **高对比度模式**: 自动调整颜色和边框
- **减少动画**: 支持 `prefers-reduced-motion` 媒体查询
- **键盘导航**: 所有交互元素支持焦点管理
- **屏幕阅读器**: 提供适当的 ARIA 标签和描述

## 性能考虑

- **按需计算**: Modifier 信息只在需要时计算
- **缓存优化**: 使用 Vue 的计算属性缓存
- **动画优化**: 使用 CSS 动画而非 JavaScript 动画
- **内存管理**: 组件销毁时自动清理动画帧

## 调试和开发

在开发模式下，可以通过浏览器开发者工具查看 modifier 信息：

1. 检查元素的 `data-modifier-type` 属性
2. 查看 tooltip 内容获取详细信息
3. 使用 Vue DevTools 检查组件状态

## 最佳实践

1. **性能**: 只在必要时传递 modifier 信息
2. **用户体验**: 确保动画不会过于干扰
3. **一致性**: 在整个应用中保持视觉效果的一致性
4. **测试**: 测试各种 modifier 组合的显示效果
