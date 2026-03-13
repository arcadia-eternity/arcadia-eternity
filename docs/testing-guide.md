# 测试指南（2026-03-13）

本文档记录当前仓库可用的测试入口与推荐执行顺序。  
当前项目测试栈以 **Vitest + Playwright** 为主，不再使用旧的 Jest/Japa 入口。

## 一、全仓入口

```bash
# 全量（类型检查 + 包内 test:run）
pnpm test

# 仅类型检查
pnpm test:types

# 仅运行各 package 的 test:run
pnpm test:run

# watch 模式（各 package 的 test）
pnpm test:watch
```

说明：

- `pnpm test:run` 会执行所有声明了 `test:run` 的包（通过 workspace filter）。
- 若某个包没有 `test:run`，会被自动跳过（`--if-present`）。

## 二、核心包测试入口

### 1) battle

```bash
pnpm --filter @arcadia-eternity/battle run test:run
```

覆盖重点：

- v2 effect/mark 回归
- v2 RNG 回归
- v2 timer / runtime snapshot 回归

### 2) server

```bash
pnpm --filter @arcadia-eternity/server run test:run
```

集群 mock 多实例专项：

```bash
pnpm --filter @arcadia-eternity/server run test:run:cluster-multi-instance-e2e
```

### 3) client

```bash
pnpm --filter @arcadia-eternity/client run test:run
```

覆盖重点：

- 重连态与 `roomClosed` 行为回归
- timer snapshot 同步回归

### 4) schema

```bash
pnpm --filter @arcadia-eternity/schema run test:run
```

### 5) rules

```bash
pnpm --filter @arcadia-eternity/rules run test:run
```

### 6) p2p-transport

```bash
pnpm --filter @arcadia-eternity/p2p-transport run test:run
```

## 三、Web E2E（Playwright）

目录：`packages/web-ui/e2e`

```bash
cd packages/web-ui

# 默认 e2e
pnpm run test:e2e

# 在线 relay 链路
pnpm run test:e2e:online:relay

# 在线 webrtc 链路
pnpm run test:e2e:online:webrtc

# 在线 ranked 链路
pnpm run test:e2e:online:ranked
```

使用外部已启动服务（更稳定）：

```bash
cd packages/web-ui
pnpm run test:e2e:online:relay:external
pnpm run test:e2e:online:webrtc:external
pnpm run test:e2e:online:ranked:external
```

## 四、推荐回归顺序

提交前最小回归：

1. `pnpm test:types`
2. `pnpm --filter @arcadia-eternity/battle run test:run`
3. `pnpm --filter @arcadia-eternity/server run test:run`
4. `pnpm --filter @arcadia-eternity/client run test:run`

发布前回归（含联机）：

1. `pnpm test`
2. `pnpm --filter @arcadia-eternity/server run test:run:cluster-multi-instance-e2e`
3. `cd packages/web-ui && pnpm run test:e2e:online:relay:external`
4. `cd packages/web-ui && pnpm run test:e2e:online:webrtc:external`
5. `cd packages/web-ui && pnpm run test:e2e:online:ranked:external`

## 五、常见问题

### 1) 端口冲突

```bash
lsof -i :8102
lsof -i :4176
```

### 2) 依赖或缓存异常

```bash
pnpm install
pnpm -r run clear
pnpm build
```

### 3) E2E 环境不稳定

- 优先使用 `*:external` 脚本，手动先拉起 server / web。
- relay 与 webrtc 分开跑，避免同时占用资源。

## 六、维护约定

当新增测试入口时，必须同步更新：

1. 对应 package 的 `package.json`（`test` / `test:run`）
2. 本文档
3. 相关规划文档中的验证清单（如 server/pack 计划）
