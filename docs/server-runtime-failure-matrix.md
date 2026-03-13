# Server Runtime Failure Matrix

本文定义 `battleMode: 'server'` 的故障与调度矩阵，目标是覆盖:

- 实例真实宕机
- 实例短暂断网/抖动
- 宕机或切换窗口内有新请求进入
- 多实例并发争抢 owner

## 1. 术语与不变量

### 1.1 术语

- `owner`: 当前房间战斗运行时宿主实例（由 ownership lease 表示）。
- `candidate`: 尝试接管的实例。
- `lease`: Redis ownership 记录，带 TTL。
- `routing`: 请求转发目标（通常取 roomState.instanceId + service discovery）。

### 1.2 不变量

1. 同一时刻同一房间最多只允许一个实例执行可变更动作（submit/ready/abandon 等）。
2. `getState` 等读请求可以降级，但不能破坏 owner 唯一性。
3. 不能把“短暂不可达”直接当成“实例宕机”做 destructive cleanup。
4. 清理房间前，必须满足足够强的“owner 不可恢复”证据（lease 超时 + 实例不可达/不存在）。

## 2. 状态维度

### 2.1 Owner 健康状态

- `O1` Healthy: 正常可达。
- `O2` TransientPartition: 短暂断网/高抖动（可恢复）。
- `O3` Slow: 高延迟/卡顿（RPC 超时但进程未死）。
- `O4` Crash: 进程退出或长期不可达。
- `O5` Draining: 计划内迁移，拒绝新变更。

### 2.2 Lease 状态

- `L1` ValidActive: lease 有效且 status=active。
- `L2` ValidDraining: lease 有效且 status=draining。
- `L3` Expired: lease 已超时。
- `L4` Missing: lease 缺失。

### 2.3 请求类型

- `R1` Mutation: `submitPlayerSelection`/`ready`/`abandon`/`animation`。
- `R2` Read: `getState`/`getSelection`/timer 查询。
- `R3` Reconnect: 断线重连恢复。
- `R4` CleanupControl: 清理、超时驱动的控制消息。

## 3. 故障矩阵（核心）

| Case | Owner | Lease | 请求到达实例 | 请求类型 | 预期行为 | 一致性级别 | 当前状态 |
|---|---|---|---|---|---|---|---|
| M01 | O1 | L1 | owner 本机 | R1/R2 | 本地处理 | 强一致 | 已实现 |
| M02 | O1 | L1 | 非 owner | R1/R2 | RPC 转发到 owner | 强一致 | 已实现 |
| M03 | O2 | L1 | 非 owner | R1 | 不能清房；返回可重试错误，等待 owner 恢复 | 强一致 | 已实现 |
| M04 | O2 | L1 | 非 owner | R2 | 可返回 stale/重试提示，不迁移 owner | 最终一致 | 已实现 |
| M05 | O3 | L1 | 非 owner | R1 | 首次超时不切主；重试窗口后再评估 failover | 强一致 | 已实现 |
| M06 | O4 | L3/L4 | candidate | R1 | candidate 抢占 lease 并接管，再处理请求 | 强一致 | 已实现（支持 runtime 缺失时 bootstrap + action log 恢复） |
| M07 | O4 | L1(残留) | candidate | R1 | 等 lease 过期后接管；期间返回可重试 | 强一致 | 已实现（owner 自动续约 + lease 过期后接管） |
| M08 | O5 | L2 | 任意 | R1 | 拒绝新 mutation 或重路由到新 owner | 强一致 | 已实现（draining 拒写 + mutation 重路由） |
| M09 | O5 | L2 | 任意 | R2 | 优先读旧 owner，必要时读快照 | 最终一致 | 已实现（读优先旧 owner + 本地fallback + Redis 快照 fallback） |
| M10 | O4 | L4 | 任意 | R3 | 通过 room/session 映射定位新 owner，恢复战斗态 | 强一致 | 部分实现 |
| M11 | O2/O3 | L1 | 任意 | R3 | 重连不应误判为 abandon；保留 grace window | 强一致 | 部分实现 |
| M12 | O4 | L3/L4 | 任意 | R4 | 清理 orphan 映射 + 广播 roomClosed | 最终一致 | 已实现 |

## 4. “请求在故障窗口内到达”细化

### 4.1 请求命中非 owner，owner 暂时不可达

- 适用: `M03/M05`
- 必须行为:
  - 不立刻 `removeRoomState`。
  - 返回标准可重试错误（建议: `BATTLE_OWNER_TEMP_UNAVAILABLE`）。
  - 客户端退避重试（指数退避 + 抖动）。

### 4.4 请求命中旧 owner（stale local runtime）

- 必须行为:
  - 以有效 lease 的 `ownerInstanceId` 为准，不以本地是否有 runtime 为准。
  - 旧 owner 只允许转发，不允许本地执行 mutation。
  - 若新 owner 暂不可达且 lease 仍有效，返回可重试错误，不做清房。

### 4.2 请求命中非 owner，owner 已确认崩溃

- 适用: `M06/M07`
- 必须行为:
  - 满足接管条件后再迁移（lease 过期或显式抢占协议）。
  - 接管实例完成 owner claim 后处理 mutation。
  - 若接管失败，返回可重试错误而不是 silent drop。

### 4.3 请求命中 owner，自身进入 draining

- 适用: `M08/M09`
- 必须行为:
  - mutation 直接拒绝或重定向。
  - read 可短期服务，但必须带迁移提示（可选）。

## 5. 误判防护（短暂断网 vs 真实宕机）

建议采用双信号判定，避免误清理:

1. `instance reachability` 连续失败次数阈值（例如 >=3）。
2. ownership `lease` 超时。

只有同时满足时，才允许 destructive cleanup / takeover。

## 6. 自动化测试覆盖矩阵

| Test ID | 覆盖 Case | 级别 | 文件 | 状态 |
|---|---|---|---|---|
| T01 | M01/M12 | unit/integration | `packages/server/test/clusterBattleService.v2.test.ts` | 已有 |
| T02 | M07 | unit | `packages/server/test/ownershipCoordinator.test.ts` (`lease expiry takeover`) | 已有 |
| T03 | M02 | integration | `cluster battle RPC forward` 相关流程 | 已有（间接） |
| T04 | M03 | integration | 非 owner RPC 失败但 lease 有效时，不清房 | 已有（`clusterBattleServer.ownership-routing.test.ts`） |
| T05 | M05 | integration | 连续超时阈值后才触发 failover | 已有（`clusterBattleServer.ownership-routing.test.ts`） |
| T06 | M06 | integration | lease 过期后请求触发接管并成功处理 | 已有（`clusterBattleServer.ownership-routing.test.ts`，stub runtime） |
| T07 | M08 | integration | draining 期间 mutation 拒绝/重路由 | 已有（`clusterBattleServer.ownership-routing.test.ts`，拒写+重路由） |
| T09 | M09 | integration | draining 期间读请求优先旧 owner，失败时降级读取 | 已有（`clusterBattleServer.ownership-routing.test.ts`，local+snapshot fallback） |
| T08 | M10/M11 | integration/e2e | 断线重连跨实例恢复 | 已实现（`clusterBattleServer.reconnect.socketio.e2e.test.ts` 覆盖真实 socket.io client + gRPC owner 的跨实例重连恢复） |
| T10 | M10/M11 | unit | 重连主链（本地断线缓存/Redis断线记录/观战者过滤） | 已有（`clusterBattleServer.ownership-routing.test.ts`） |
| T11 | M11 | unit | 断线备份检查器避免“已重连被误判 abandon” | 已有（`clusterBattleService.v2.test.ts`） |
| T12 | M10/M11 | integration | socket 连接重连分支（`battleReconnect` 事件，含同实例/跨实例 full state） | 已有（`clusterBattleServer.reconnect.socketflow.test.ts`） |
| T13 | M10/M11 | integration | 跨实例重连通过真实 gRPC 转发获取状态（非 stub） | 已有（`clusterBattleServer.reconnect.grpc-forward.integration.test.ts`） |
| T14 | M04 | unit/integration | 非 owner 读请求转发失败时不触发 cleanup/takeover（读失败不污染 mutation failover 窗口） | 已有（`clusterBattleServer.ownership-routing.test.ts`） |
| T15 | M10/M11 | unit/integration | 重连取状态使用 ownership 解析（避免 stale room routing）+ 转发失败时 snapshot 兜底 | 已有（`clusterBattleServer.reconnect.socketflow.test.ts`） |
| T16 | M06 | integration | request-driven takeover 在本地 runtime 缺失时返回可重试，不执行误清房（等待 replay/handoff 能力） | 已有（`clusterBattleServer.ownership-routing.test.ts`） |
| T17 | M06 | unit/integration | request-driven takeover 在本地 runtime 缺失时，通过 bootstrap + action log 恢复 runtime 后继续处理 mutation | 已有（`clusterBattleServer.ownership-routing.test.ts` + `clusterBattleService.v2.test.ts`） |
| T18 | M07 | unit | active owner 续约 lease（same-owner claim refresh）保持本地 runtime 正常运行 | 已有（`clusterBattleService.v2.test.ts`） |
| T19 | M07 | unit/integration | lease 刷新发现 owner 漂移时主动丢弃本地 runtime 并更新 room routing（防止 split-brain） | 已有（`clusterBattleService.v2.test.ts`） |
| T20 | M06 | unit/integration | runtime world snapshot 存在时，以 `snapshot.actionSeq` 作为 replay baseline（减少全量 replay） | 已有（`clusterBattleService.v2.test.ts`） |
| T21 | M06 | unit/integration | runtime world snapshot 的 `actionSeq` 超前于 action log 时，恢复基线应夹紧到最新 action seq | 已有（`clusterBattleService.v2.test.ts`） |
| T22 | M06 | unit/integration | runtime world snapshot 位于终态边界（BattleEnd 且 seq 对齐）时，恢复不应重启 battle loop | 已有（`clusterBattleService.v2.test.ts`） |
| T23 | M02/M10/M11 | mock e2e | mock 多实例语义下的 ranked/server 匹配 + p2p 私人房间信令转发 | 已实现（`cluster.multi-instance.e2e.test.ts`） |

## 7. 下一步落地顺序

1. 补真实多进程 E2E（非 mock）：
   - 实例 A/B/C + real Redis + queue/match + p2p 跨实例重连全链路。
2. 收口 deterministic handoff 协议：
   - 从“snapshot + action seq 基线”提升到可验证的严格切换协议（含 mid-phase 边界策略）。
3. 强化 `M10/M11` 的生产可观测性：
   - 增加重连恢复耗时、接管成功率、临时不可用重试率等指标。
4. 补齐失败注入回归：
   - owner 停机、网络抖动、Redis 短暂不可用下的稳定性回归。

当前阶段：

- `M03/M05` 已落地。
- `M06/M08` 已落地（takeover、draining 拒写、mutation 重路由）。
- `M06` 已补 runtime 缺失恢复主链（bootstrap + action log），不再仅限“本地 runtime 仍在”的接管场景。
- runtime action journal 已升级为 `seq + replay cursor` 基线，并接入清理生命周期。
- runtime world snapshot 已接入（`BATTLE_RUNTIME_WORLD_SNAPSHOT`），恢复链路可从 `snapshot.actionSeq` 开始增量 replay；严格 deterministic handoff（含 mid-phase 精确恢复）仍待完善。
- runtime world snapshot 现已附带边界元信息（触发消息 + state hints），并在恢复时对 `snapshot.actionSeq` 执行上界夹紧，避免异常快照导致 replay baseline 越界。
- runtime world snapshot 若命中终态边界且 `snapshot.actionSeq` 与 action log 对齐，恢复将直接保持终态并跳过 battle loop 重启。
- `M07` 已补 owner 自动续约与 owner 漂移防护（本地 runtime 主动退出），降低 lease 残留窗口的 split-brain 风险。
- `M09` 已落地（读路由 + local/snapshot 双降级），完整快照级 replay/handoff 仍待补。
- `M11` 已补关键误判防护（断线 key 被清理后先校验连接/会话绑定再决定是否 abandon）。
- `M10/M11` 的 integration/e2e 回归已补（同实例/跨实例重连，含真实 socket.io client + gRPC owner 链路）。
- 重连取状态链路已补 owner 解析与 snapshot 兜底，降低迁移窗口内 stale routing / transient unavailable 对重连体验的影响。
- `M06` 保留 runtime 缺失保护兜底：恢复链路不可用或恢复失败时不做冒进 takeover 清房，统一返回可重试。
- 已新增 mock 多实例回归基线（`cluster.multi-instance.e2e.test.ts`）：覆盖 ranked/server 匹配与 p2p 私人房间信令转发。
- 待补重点已从“基础路由与接管逻辑”切换为“真实多进程 E2E + 严格 deterministic handoff + 可观测性”。
