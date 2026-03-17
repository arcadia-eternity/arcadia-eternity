# 自动更新检查功能

## 概述

客户端模式支持在应用启动后自动检查更新。该功能只在 Electron 桌面版的生产环境启用，Web 版本不会触发。

## 功能特性

### 自动检查条件

- 仅桌面端：通过 `window.arcadiaDesktop` 提供更新能力
- 仅生产环境：开发环境自动跳过
- 延迟启动：应用完成初始化后延迟 3 秒执行检查

### 用户体验

1. 静默检查：不阻塞启动流程
2. 更新提示：发现新版本时弹通知
3. 用户确认：可选择立即更新或稍后更新
4. 自动重启：下载安装后由桌面端执行重启

## 技术实现

### 核心函数

```typescript
// packages/web-ui/src/utils/version.ts
export async function autoCheckForUpdates(): Promise<void>
```

### 调用位置

```typescript
// packages/web-ui/src/App.vue
setTimeout(() => {
  autoCheckForUpdates()
}, 3000)
```

### 桌面端实现

更新能力由 Electron 主进程提供：

- `desktop:check-for-updates`
- `desktop:download-and-install-update`

前端通过 preload 暴露的 `window.arcadiaDesktop` 调用。

## 测试

### 开发环境

1. 启动 Web UI：`pnpm --filter @arcadia-eternity/web-ui run dev`
2. 启动桌面端壳：`pnpm --filter @arcadia-eternity/web-ui run dev:desktop`
3. 检查控制台中自动检查日志

### 生产构建

1. 构建前端：`pnpm --filter @arcadia-eternity/web-ui run build-only`
2. 构建桌面包：`pnpm --filter @arcadia-eternity/web-ui run build:desktop`

## 日志输出

正常：

```
正在自动检查更新...
当前已是最新版本
```

有新版本：

```
正在自动检查更新...
发现新版本: 1.4.0
```
