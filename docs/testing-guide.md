# 测试指南

测试入口以根目录和各包的 `package.json`、[战斗工作流](../.github/workflows/battle-baseline.yml)为准。先安装依赖并构建 workspace，再按修改范围选择检查；公共包导入使用 `dist`，修改源码后应重新构建相关依赖。

```sh
pnpm install --frozen-lockfile
pnpm build:package
```

## V4 内核与官方内容

```sh
pnpm typecheck:battle-v4
pnpm lint:battle-v4
pnpm test:battle-v4
pnpm verify:battle-v4-hosts
pnpm verify:battle-v4-waiting-snapshots
pnpm verify:battle-v4-behaviors
pnpm verify:battle-v4-templates
pnpm verify:battle-v4-native
pnpm verify:battle-v4-native-pack
```

跨宿主命令会构建并运行实际 Node／Chrome 探针，需要脚本可发现的 Chrome／Chromium。只运行一个测试文件：

```sh
pnpm test:battle-v4 test/v4/port.test.ts
```

作者辅助 API 设计用例另有 `pnpm typecheck:effect-authoring-design` 和 `pnpm test:effect-authoring-design`。并行设置与 CI 触发规则见[测试性能说明](v4/testing-performance.md)。

## 服务端、CLI 和内容工具

| 修改范围                             | 检查                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------ |
| 单进程房间、身份、匹配和账号         | `pnpm typecheck:server-native`、`pnpm lint:server-native`、`pnpm test:server-native` |
| CLI 应用和命令                       | `pnpm typecheck:cli`、`pnpm test:cli`、`pnpm test:cli-native`                        |
| 原生加载、npm 包和固定环境           | `pnpm --filter @arcadia-eternity/pack-loader test:run`                               |
| 作者 CLI、工作区保存、MCP 和场景任务 | `pnpm test:content-dev`                                                              |
| 内容结构整理脚本                     | `pnpm test:content-structure`                                                        |

账号 PostgreSQL 持久化测试使用 `TEST_DATABASE_URL`，CI 配置见工作流中的 PostgreSQL service。数据库用例未执行时保留其跳过状态；默认无账号服务不需要数据库。CLI 集成会构建真实命令并执行对战／回放，详见 [CLI 合同](v4/cli.md)。

## 网页与桌面

```sh
pnpm typecheck:web-native
pnpm lint:web-native
pnpm test:web-native
pnpm test:web-native:e2e
pnpm --filter @arcadia-eternity/web-ui test:run
pnpm --filter @arcadia-eternity/web-ui test:content-locales
```

Playwright 需先安装 Chromium：

```sh
pnpm --filter @arcadia-eternity/web-ui exec playwright install chromium
```

生产静态离线检查使用实际构建：

```sh
pnpm --filter @arcadia-eternity/web-ui build:static
pnpm --filter @arcadia-eternity/web-ui test:e2e:static
```

在线服务端房间和普通匹配分别使用网页包的 `test:e2e:online:server`、`test:e2e:online:matchmaking`。保留的非 UGC P2P 使用 `test:e2e:online:relay`／`test:e2e:online:webrtc`，已有服务可用对应的 `:external` 入口。UGC 房间由服务端执行，见[客户端与服务器](v4/client-server-boundaries.md)。

Electron 基础 IPC 检查：

```sh
node --test packages/web-ui/electron/test/*.test.mjs
```

真实桌面进程、窗口与本地试战另有环境开关和服务前提，见[内容管理验证](v4/content-management.md#验证)与[试战生命周期](v4/local-trial-lifecycle.md#验证重点)。默认跳过的真实宿主测试不计作已验收；正式安装、签名、升级和平台矩阵由 #209／#221 继续跟踪。

## 全仓检查与维护

`pnpm test` 顺序执行全仓类型检查和各包的 `test:run`；`pnpm test:types`、`pnpm test:run` 和 `pnpm test:watch` 可分别运行。`pnpm lint` 与 `pnpm format:check` 为根目录检查。新增或移除入口时同步对应脚本、本指南和 CI。
