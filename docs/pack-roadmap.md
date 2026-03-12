# Pack Roadmap

## 背景

项目已切到 pack 模式，基础包在 `@arcadia-eternity/data-pack-base`，运行时默认引用 `builtin:base`。  
下一阶段目标是支撑“创意工坊”能力，同时保证 Web/Tauri/Server 一致性。

官方约束（当前）：官方排位与官方匹配仅支持基础官方扩展包白名单；社区包仅用于自定义/娱乐模式。
部署约束（当前）：对战服务器与扩展包服务器分实例部署，前者不托管包文件，仅做校验。
对战模式约束（更新）：大多数私人房间默认使用 `p2p`，只有官方模式、bot、裁定等场景使用 `server` 承载 battle。

## 当前进度

### 已完成

1. `pack.json` / `assets.json` / `pack-lock.yaml` 基础协议和 schema 已落地。
2. 基础包已切到 `builtin:base` / pack 模式。
3. `ServerPackManager` 已具备发现、校验、加载和最小安装能力。
4. 私人房间已显式区分 `battleMode: p2p | server`。
5. 私人房间 `p2p` 路径已实际跑通：
   - relay 在线回归通过
   - webrtc 在线专项通过
6. Web 侧已经具备 `p2pTransport: auto | relay | webrtc` 配置与统一测试入口。
7. Web 侧已经具备复用外部本地服务的在线 E2E 入口，便于稳定复测 `relay / webrtc`。

### 未完成

1. `server` authoritative 模式的 snapshot / replay / ownership handoff。
2. `Pack Service` 的完整安装体验与创意工坊分发链。
3. Tauri 端的完整 PackManager 运行链验证。
4. server mode 与房间/匹配策略的进一步收口。

## Phase 1: 协议冻结

目标：先把协议稳定下来，避免后续反复迁移。

1. 定稿 `pack.json`（字段、依赖、目录语义）。
2. 定稿 `packLock`（对战可复现最小字段）。
3. 定稿 `assets.json` / `assetLock`（资源分发与房间资源一致性）。
4. 在 battle/服务端共享 schema 校验。

产出：

- `docs/pack-spec.md`
- `pack schema` + `packLock schema` + `asset schema` + `assetLock schema`

## Phase 2: 运行链路打通（无工坊 UI）

目标：Web/Tauri/Server 都能按 lock 运行。

1. 服务端房间模型增加 `requiredPackLock`。
2. 服务端房间模型增加 `battleMode: p2p | server`。
3. 客户端入房时进行 lock 对齐与缺包检查。
4. `p2p` 房间由 host peer 执行 `PackManager.resolve(lock)`。
5. `server` 房间由服务端执行 `PackManager.resolve(lock)`。
6. 对战服务端仅调用 Registry 元数据接口，不直接提供包下载。
7. Web/Tauri 都必须内置 `builtin:base`，离线可用。

验收：

- 同一 `packLock` 下 Web 与 Tauri 战斗结果一致（同 seed）。

## Phase 3: 双端 PackManager

目标：同一接口，不同后端实现。

1. `PackManager` 接口（resolve/has/install/verify/list）。
2. `WebPackManager`（HTTP + IndexedDB/Cache）。
3. `TauriPackManager`（HTTP/本地文件系统）。
4. `ServerPackManager`（node_modules/workspace/file/git + lock 校验）。

验收：

- 两端都能自动安装缺失 pack 并进入战斗。
- Web 不直接依赖 npm registry，而是通过 `Pack Service` 达成等价安装体验。

## Phase 4: 服务端策略与匹配

目标：服务端可控地启用/限制包集合。

1. `PackPolicy`：
   - `required`
   - `allowed`
   - `blocked`
   - `strict|compatible`
2. 匹配/入房时校验 policy。
3. 返回缺失或冲突原因（客户端可读）。

官方队列策略落地：

- ranked/mm 使用 `strict`。
- `required` 至少包含 `@arcadia-eternity/data-pack-base`。
- `allowed` 仅官方扩展包白名单。
- 默认 battle mode 为 `server`。

验收：

- 错误 policy 或不兼容客户端可被准确拦截。

## Phase 5: 编辑器升级（Pack Studio v1）

目标：数据编辑器直接面向 pack 工作流。

1. 新建 pack（模板目录 + pack.json）。
2. 编辑 data/locales。
3. validate（schema、cross-ref、dependency）。
4. 导出 zip。

验收：

- 编辑器可生成并导出可安装 pack。

## Phase 6: 发布链路（npm + git）

目标：可发布、可追溯、可复现。

1. npm 发布：
   - `pack build`
   - `pack publish npm`
2. git 发布：
   - `pack publish git`（tag/release）
3. lock 生成：
   - 生成包含版本与完整性摘要的 lock。

验收：

- 能从 npm/git 拉取并重建相同对战环境。

## Phase 7: 创意工坊

目标：面向玩家的可视化分发与安装。

1. Registry（查询、下载、评分、审核态）。
2. 客户端安装/启用/禁用 UI。
3. 服务端白名单与审核态联动。

验收：

- 玩家可在客户端安装社区 pack 并进入允许该 pack 的房间。

## 当前执行顺序（短期）

1. 收口 `server` authoritative runtime：`BattleRuntimeHost` / `OwnershipCoordinator`
2. 完成 `server` 模式 snapshot / replay / handoff
3. 继续推进 `Pack Service` 与双端安装体验
