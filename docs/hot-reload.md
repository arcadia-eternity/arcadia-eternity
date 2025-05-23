# 热重载功能文档

## 概述

fsloader 现在支持开发模式下的热重载功能，可以自动监控数据文件和脚本文件的变化，并在文件修改时自动重新加载相关数据。**新版本解决了对象引用更新和内存泄漏问题，支持精细化重载。**

## 功能特性

- 🔥 **自动监控**: 监控 YAML 数据文件和 JavaScript 脚本文件的变化
- ⚡ **精细化重载**: 只重载变化的单个文件，而不是整个类别
- 🔄 **对象代理机制**: 解决对象引用更新问题，外部引用自动指向新对象
- 🗑️ **内存管理**: 避免内存泄漏，旧对象可以被正确回收
- 🎯 **智能防抖**: 防止频繁的文件变化导致过多的重载操作
- 📢 **事件回调**: 提供丰富的事件回调机制，便于集成到开发工具中
- 🛡️ **错误处理**: 重载失败时不会影响现有数据，并提供详细的错误信息

## 基本使用

### 启用热重载

```typescript
import { loadGameData, LOADING_STRATEGIES } from '@arcadia-eternity/fsloader'

// 使用预设的开发热重载策略
const hotReloadManager = await loadGameData('./data', LOADING_STRATEGIES.DEVELOPMENT_HOT)

if (hotReloadManager) {
  console.log('🔥 热重载已启动')

  // 在应用退出时停止热重载
  process.on('SIGINT', async () => {
    await hotReloadManager.stop()
    process.exit(0)
  })
}
```

### 自定义热重载配置

```typescript
const customStrategy = {
  validateDependencies: true,
  validateCrossReferences: true,
  allowPartialLoad: true,
  continueOnError: true,
  loadScripts: true,
  scriptPaths: ['./scripts', './custom-scripts'],
  enableHotReload: true,
  hotReloadDebounce: 500, // 防抖延迟 500ms
  watchScripts: true,
  hotReloadCallback: (event) => {
    console.log('热重载事件:', event)
  }
}

const hotReloadManager = await loadGameData('./data', customStrategy)
```

## 事件回调

热重载提供了丰富的事件回调机制：

```typescript
const strategy = {
  ...LOADING_STRATEGIES.DEVELOPMENT_HOT,
  hotReloadCallback: (event) => {
    switch (event.type) {
      case 'file-changed':
        console.log(`文件变化: ${event.filePath} (${event.category})`)
        break
      case 'file-added':
        console.log(`文件添加: ${event.filePath} (${event.category})`)
        break
      case 'file-removed':
        console.log(`文件删除: ${event.filePath} (${event.category})`)
        break
      case 'reload-complete':
        console.log(`重载完成: ${event.stats?.reloadedFiles} 个文件，耗时 ${event.stats?.totalTime}ms`)
        break
      case 'reload-error':
        console.error(`重载失败: ${event.error?.message}`)
        break
    }
  }
}
```

## 配置选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `enableHotReload` | boolean | false | 是否启用热重载 |
| `hotReloadDebounce` | number | 300 | 防抖延迟（毫秒） |
| `watchScripts` | boolean | true | 是否监控脚本文件变化 |
| `hotReloadCallback` | function | undefined | 热重载事件回调函数 |

## 预设策略

### DEVELOPMENT_HOT

开发热重载模式，包含以下配置：

- 启用依赖验证和交叉引用验证
- 允许部分加载和错误继续
- 加载脚本文件
- 启用热重载功能
- 300ms 防抖延迟
- 监控脚本文件变化

```typescript
const hotReloadManager = await loadGameData('./data', LOADING_STRATEGIES.DEVELOPMENT_HOT)
```

## 工作原理

### 对象代理机制

1. **代理创建**: 为每个数据对象创建 Proxy，外部获取的都是代理对象
2. **引用保持**: 外部代码持有的引用始终指向同一个代理对象
3. **目标更新**: 热重载时更新代理的目标对象，而不是替换代理本身
4. **自动转发**: 代理自动将属性访问和方法调用转发到新的目标对象

### 精细化重载流程

1. **文件监控**: 使用 chokidar 监控指定目录下的文件变化
2. **事件防抖**: 使用防抖机制避免频繁的重载操作
3. **单文件重载**: 只重载变化的单个文件，而不是整个类别
4. **对象级更新**: 只更新文件中包含的具体对象
5. **代理更新**: 通过代理机制更新对象引用
6. **依赖处理**: 自动处理数据之间的依赖关系
7. **错误隔离**: 重载失败时不影响现有数据

## 对象引用更新示例

```typescript
import { dataRepo } from '@arcadia-eternity/data-repository'

// 获取对象引用
const effect = dataRepo.getEffect('some_effect_id')
console.log(effect.someProperty) // 输出当前值

// 此时修改数据文件...
// 热重载会自动更新对象

// 同一个引用现在指向新的对象数据
console.log(effect.someProperty) // 输出更新后的值！

// 对象引用保持不变，但内容已更新
// 无需重新获取引用，避免了内存泄漏
```

## 性能优势

### 精细化重载 vs 类别重载

| 重载方式 | 重载范围 | 性能 | 内存使用 |
|----------|----------|------|----------|
| **精细化重载** | 单个文件 | 🚀 快速 (250ms) | 🟢 低 |
| 类别重载 | 整个类别 | 🐌 较慢 (4605ms) | 🟡 中等 |

### 代理机制 vs 直接替换

| 方式 | 对象引用 | 内存泄漏 | 开发体验 |
|------|----------|----------|----------|
| **代理机制** | ✅ 自动更新 | ✅ 无泄漏 | 🚀 无感知 |
| 直接替换 | ❌ 需重新获取 | ❌ 有泄漏 | 😓 需手动处理 |

## 注意事项

- 热重载功能仅在 Node.js 环境下可用
- 浏览器环境下会自动跳过热重载功能
- 建议仅在开发环境下使用热重载功能
- 代理机制会有轻微的性能开销，但在开发环境下可以忽略
- 大量文件变化时可能会有短暂的性能影响

## 示例

- `test-hot-reload.js` - 基本热重载功能演示
- `test-proxy-update.js` - 对象引用更新演示
