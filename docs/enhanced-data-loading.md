# 增强的数据加载系统

## 概述

新的数据加载系统提供了更灵活的加载顺序管理和全面的缺失ID检测功能，特别是支持脚本定义和数据文件定义的混合加载，解决了原有系统的以下问题：

- **固定加载顺序**：原来硬编码的加载顺序现在可以根据依赖关系动态调整
- **缺失依赖检测**：能够检测和报告数据间的交叉引用错误
- **脚本-数据交叉加载**：支持脚本定义和YAML数据文件的混合加载和验证
- **加载策略配置**：支持不同的验证级别和错误处理策略
- **详细错误报告**：提供具体的错误信息和位置
- **冲突检测**：检测脚本定义和数据文件定义的冲突

## 主要功能

### 1. 依赖关系管理

系统定义了数据类型间的依赖关系：

```typescript
const DATA_DEPENDENCIES: DataDependency[] = [
  { category: 'effect', dependsOn: [], priority: 1 },
  { category: 'mark', dependsOn: ['effect'], priority: 2 },
  { category: 'skill', dependsOn: ['effect', 'mark'], priority: 3 },
  { category: 'species', dependsOn: ['skill', 'mark'], priority: 4 },
]
```

### 2. 交叉引用验证

验证以下引用关系：

- **技能 → 效果**：验证技能的 `effect` 字段引用的效果是否存在
- **标记 → 效果**：验证标记的 `effect` 字段引用的效果是否存在
- **物种 → 技能**：验证物种的 `learnable_skills` 引用的技能是否存在
- **物种 → 标记**：验证物种的 `ability` 和 `emblem` 引用的标记是否存在

### 3. 脚本-数据交叉加载

系统支持脚本定义和数据文件定义的混合加载：

#### 加载顺序

1. **数据文件加载**：按依赖顺序加载YAML数据文件
2. **脚本加载**：加载TypeScript/JavaScript脚本定义
3. **交叉验证**：验证脚本和数据之间的引用关系

#### 冲突处理

- **ID冲突**：当脚本和数据文件定义相同ID时，脚本定义优先
- **警告提示**：系统会警告ID冲突情况
- **引用验证**：验证数据文件引用脚本定义的有效性

#### 支持的引用关系

- **数据 → 脚本**：数据文件可以引用脚本中定义的效果、标记等
- **脚本 → 数据**：脚本可以引用数据文件中定义的基础数据
- **脚本 → 脚本**：脚本之间可以相互引用

### 4. 加载策略

提供五种预设策略：

#### 严格模式 (STRICT)

```typescript
{
  validateDependencies: true,
  validateCrossReferences: true,
  allowPartialLoad: false,
  continueOnError: false,
}
```

#### 宽松模式 (LENIENT)

```typescript
{
  validateDependencies: true,
  validateCrossReferences: false,
  allowPartialLoad: true,
  continueOnError: true,
}
```

#### 快速模式 (FAST)

```typescript
{
  validateDependencies: false,
  validateCrossReferences: false,
  allowPartialLoad: true,
  continueOnError: true,
  loadScripts: false,
}
```

#### 完整模式 (FULL)

```typescript
{
  validateDependencies: true,
  validateCrossReferences: true,
  allowPartialLoad: false,
  continueOnError: false,
  loadScripts: true,
  scriptPaths: ['./scripts'],
}
```

#### 开发模式 (DEVELOPMENT)

```typescript
{
  validateDependencies: true,
  validateCrossReferences: true,
  allowPartialLoad: true,
  continueOnError: true,
  loadScripts: true,
  scriptPaths: ['./scripts'],
}
```

## 使用方法

### 基本用法

```typescript
import { loadGameData, LOADING_STRATEGIES } from '@arcadia-eternity/fsloader'

// 使用默认策略（严格模式）
await loadGameData()

// 使用预设策略
await loadGameData('./data', LOADING_STRATEGIES.LENIENT)

// 使用自定义策略
await loadGameData('./data', {
  validateDependencies: true,
  validateCrossReferences: true,
  allowPartialLoad: false,
  continueOnError: false,
})

// 加载数据和脚本
await loadGameData('./data', LOADING_STRATEGIES.FULL)

// 自定义脚本路径
await loadGameData('./data', {
  validateDependencies: true,
  validateCrossReferences: true,
  allowPartialLoad: true,
  continueOnError: true,
  loadScripts: true,
  scriptPaths: ['./scripts', './custom-scripts'],
})
```

### HTTP加载器

```typescript
import { HttpLoader } from '@arcadia-eternity/httploader'

const loader = new HttpLoader({ baseUrl: '/api/data' })

// 带验证的加载
await loader.loadGameData({
  validateCrossReferences: true,
  continueOnError: false,
})

// 快速加载（跳过验证）
await loader.loadGameData({
  validateCrossReferences: false,
  continueOnError: true,
})
```

## 错误检测

### 缺失引用错误

当数据引用不存在的ID时，系统会报告详细错误：

```
❌ 发现交叉引用错误:
  - 技能 skill_paida 引用了不存在的效果 effect_nonexistent
  - 物种 pet_dilan 引用了不存在的技能 skill_missing
  - 标记 mark_test 引用了不存在的效果 effect_invalid
```

### 循环依赖检测

系统会检测并阻止循环依赖：

```
💥 检测到循环依赖: skill → mark → effect → skill
```

## 输出信息

### 加载过程

```
📋 数据加载顺序: effect → mark → skill → species
⏳ 开始加载 effect 数据...
✅ 成功加载 effect_skill.yaml (156 条记录)
✅ 成功加载 effect_mark.yaml (89 条记录)
✅ 完成加载 effect 数据
```

### 验证结果

```
🔍 执行最终交叉引用验证...
⚠️ 发现警告:
  - 效果 effect_unused 未被任何数据引用
```

### 加载统计

```
📊 数据加载统计:
  - 效果: 245 个
  - 标记: 156 个
  - 技能: 189 个
  - 物种: 67 个
🎉 所有数据加载完成
```

## 配置选项

| 选项                      | 类型     | 默认值    | 说明                     |
| ------------------------- | -------- | --------- | ------------------------ |
| `validateDependencies`    | boolean  | true      | 是否验证依赖关系         |
| `validateCrossReferences` | boolean  | true      | 是否验证交叉引用         |
| `allowPartialLoad`        | boolean  | false     | 是否允许部分加载         |
| `continueOnError`         | boolean  | false     | 遇到错误是否继续         |
| `loadScripts`             | boolean  | false     | 是否加载脚本定义         |
| `scriptPaths`             | string[] | undefined | 脚本文件路径列表         |
| `scriptBaseUrl`           | string   | undefined | 脚本基础URL (浏览器环境) |

## 最佳实践

1. **开发环境**：使用开发模式 (DEVELOPMENT) 加载数据和脚本，宽松验证
2. **生产环境**：使用宽松模式 (LENIENT) 提高容错性，不加载脚本
3. **完整测试**：使用完整模式 (FULL) 加载所有数据和脚本，严格验证
4. **性能测试**：使用快速模式 (FAST) 跳过验证
5. **CI/CD**：使用严格模式 (STRICT) 确保数据质量
6. **脚本开发**：使用开发模式，启用脚本加载和交叉验证

## 迁移指南

### 从旧系统迁移

原有的 `loadGameData()` 调用无需修改，默认使用严格模式：

```typescript
// 旧代码 - 仍然有效
await loadGameData()

// 新功能 - 可选的策略配置
await loadGameData('./data', LOADING_STRATEGIES.LENIENT)
```

### Web UI 集成

Web UI 的数据加载也得到了增强，支持更好的错误处理和验证。
