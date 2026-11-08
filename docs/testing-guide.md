# 测试指南

测试入口以根目录和各包的 `package.json`、[战斗工作流](../.github/workflows/battle-baseline.yml)为准。先安装依赖并构建 workspace，再按修改范围选择检查；公共包导入使用 `dist`，修改源码后应重新构建相关依赖。

```sh
pnpm install --frozen-lockfile
pnpm build:package
```

## 内核与官方内容

```sh
pnpm typecheck:battle
pnpm lint:battle
pnpm test:battle
pnpm verify:battle-hosts
pnpm verify:battle-waiting-snapshots
pnpm verify:battle-behaviors
pnpm verify:battle-templates
pnpm verify:battle-native
pnpm verify:battle-native-pack
```

跨宿主命令会构建并运行实际 Node／Chrome 探针，需要脚本可发现的 Chrome／Chromium。只运行一个测试文件：

```sh
pnpm test:battle test/engine/port.test.ts
```

作者辅助 API 设计用例另有 `pnpm typecheck:effect-authoring-design` 和 `pnpm test:effect-authoring-design`。并行设置与 CI 触发规则见[测试性能说明](guides/testing-performance.md)。

## 服务端、CLI 和内容工具

| 修改范围                             | 检查                                                            |
| ------------------------------------ | --------------------------------------------------------------- |
| 单进程房间、身份、匹配和账号         | `pnpm typecheck:server`、`pnpm lint:server`、`pnpm test:server` |
| CLI 应用和命令                       | `pnpm typecheck:cli`、`pnpm test:cli`、`pnpm test:cli-native`   |
| 原生加载、npm 包和固定环境           | `pnpm --filter @arcadia-eternity/pack-loader test:run`          |
| 作者 CLI、工作区保存、MCP 和场景任务 | `pnpm test:content-dev`                                         |
| 内容结构整理脚本                     | `pnpm test:content-structure`                                   |

账号 PostgreSQL 持久化测试使用 `TEST_DATABASE_URL`，CI 配置见工作流中的 PostgreSQL service。数据库用例未执行时保留其跳过状态；默认无账号服务不需要数据库。CLI 集成会构建真实命令并执行对战／回放，详见 [CLI 合同](guides/cli.md)。

## 网页与桌面

```sh
pnpm typecheck:web
pnpm lint:web
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

在线服务端房间和普通匹配分别使用网页包的 `test:e2e:online:server`、`test:e2e:online:matchmaking`。保留的非 UGC P2P 使用 `test:e2e:online:relay`／`test:e2e:online:webrtc`，已有服务可用对应的 `:external` 入口。UGC 房间由服务端执行，见[客户端与服务器](guides/client-server-boundaries.md)。

Electron 基础 IPC 检查：

```sh
node --test packages/web-ui/electron/test/*.test.mjs
```

真实桌面进程、窗口与本地试战另有环境开关和服务前提，见[内容管理验证](guides/content-management.md#验证)与[试战生命周期](guides/local-trial-lifecycle.md#验证重点)。默认跳过的真实宿主测试不计作已验收；正式安装、签名、升级和平台矩阵由 #209／#221 继续跟踪。

## 全仓检查与维护

`pnpm test` 先通过 `test:prepare` 构建全部工作区包及根 CLI，再执行类型检查汇总和各包的 `test:run`；`pnpm test:types`、`pnpm test:run` 和 `pnpm test:watch` 可分别运行。单独运行 `test:run` 前需要准备依赖和产物。`pnpm typecheck` 递归执行 `packages/*`、`packs/*` 的统一 `typecheck`，再检查根 CLI；内容开发工具的该命令检查公开 `.d.mts` 声明，JavaScript 运行逻辑由 Node 测试覆盖。`pnpm lint` 汇总工作区源码、战斗、服务端、P2P、网页和 Knip 检查。各专项命令也可以独立运行。新增或移除入口时同步对应脚本、本指南和 CI。

构建配置与测试检查分别维护：战斗、服务端的 `tsconfig.json` 收集包入口和完整 `src`，`tsconfig.test.json` 额外递归收集 `test`，并关闭产物输出。战斗仅保留一个 Vitest 配置，递归收集 `test`。网页的 `tsconfig.app.json`、`tsconfig.node.json` 分别覆盖应用和工具配置，`tsconfig.test.json` 覆盖应用及全部单元测试；`typecheck:web` 顺序运行这些检查。

ESLint 的基础规则由根配置导出，战斗与服务端配置显式选择各自的 TypeScript 项目。专项 lint 按完整包目录收集文件，排除生成产物、构建配置和独立设计实验；不再维护按文件枚举的检查名单。引擎原有规则例外集中保留，宿主、sandbox 和测试使用共享规则。

## 静态质量检查

- `pnpm lint`：执行根工作区、battle、server、P2P、网页的 ESLint，以及 Knip。
- `pnpm knip` / `pnpm lint:unused`：检查未使用文件、导出、类型、依赖，以及未声明依赖和无法解析的导入。
- `pnpm --filter @arcadia-eternity/web-ui lint:fix`：显式执行网页代码自动修复；常规 lint 不写文件。

Knip 配置在 `knip.jsonc`。新增 CLI 子进程入口、Electron preload、独立内容模板时应登记实际入口，不要将整个源码目录标为入口。发布包的公共入口导出默认保留；枚举成员和命名常量的重复值不作为删除依据。动态构建用途的例外有具体说明：Ruffle 静态复制、Electron rebuild、桌面内置 npm，以及从其他工作区解析的打包工具。不要用全局忽略或成功退出码掩盖新的告警。
