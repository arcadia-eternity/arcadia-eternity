# Server V2 Battle Refactor Plan

## Goals

1. Server battle runtime fully switches from v1 `Battle` class to v2 `IBattleSystem` implementation.
2. Cluster supports near-zero-downtime migration by Redis-coordinated ownership handoff.
3. `ServerV2` is **game-agnostic**: battle hosting/runtime orchestration can be reused by other games built on the same engine, not only Seer2.
4. Private room battle hosting is explicitly split into `battleMode: 'p2p' | 'server'`.

## Current Status

Related matrix:

- [Server Runtime Failure Matrix](./server-runtime-failure-matrix.md)

### Done

1. Server-side battle runtime has switched to v2 `IBattleSystem` for the active server-host path.
2. Private room protocol is split by `battleMode: 'p2p' | 'server'`.
3. `p2p` private rooms now run peer-hosted battle runtime instead of server battle fallback.
4. Private-room signaling, relay fallback, and WebRTC transport are all wired through the same room flow.
5. Browser online E2E is green for both transports on the current private-room path:
   - create/join room
   - start `p2p` battle
   - submit actions and sync battle log
   - reload battle page and rejoin active battle
6. Server local battle storage is now behind an explicit in-memory `BattleRuntimeHost` boundary, so `ClusterBattleService` no longer owns raw room/battle maps directly.
7. Local battle construction is now behind a dedicated runtime factory, so `ClusterBattleService` no longer owns rule-validation + battle-creation details directly.
8. Local battle start/cleanup lifecycle has been moved into runtime helpers, further reducing `ClusterBattleService` to orchestration responsibilities.
9. A `BattleRuntimeInstance` shape now exists and is already serving part of the hot-path battle operations, reducing direct battle-object access inside `ClusterBattleService`.
10. Most hot-path local battle operations (`submitAction`, selection/state reads, timer queries, surrender, animation operations) now flow through `BattleRuntimeInstance` instead of direct battle-object access.
11. Remaining hot paths that previously used raw room access (`battle event listener lifecycle`, `spectate snapshot`, `battle report lookup`) now read through `BattleRuntimeInstance` runtime data.
12. `OwnershipCoordinator` in-memory skeleton is now wired into local runtime create/cleanup lifecycle (`claim -> draining -> release`) for server-mode refactor alignment, without changing current routing semantics.
13. `OwnershipCoordinator` now has a Redis-backed implementation and is wired into `ClusterBattleService` lifecycle in record mode (persist ownership metadata with TTL), while routing/lease arbitration is still pending.
14. Ownership claim now has baseline arbitration semantics (`first-owner-wins` with same-owner lease refresh), and the server test suite includes multi-instance takeover simulation after lease expiry.
15. Request-driven takeover now supports runtime reconstruction when local runtime is missing: room bootstrap payload + action log are persisted in Redis, and candidate owner can recover runtime before handling mutation.
16. Active owner now has automatic lease renewal, and local runtime will be dropped if lease refresh detects ownership drift, reducing split-brain risk during long-running battles.
17. Action journal now uses Redis `seq + replay cursor` baseline (`BATTLE_RUNTIME_ACTION_SEQ`, `BATTLE_RUNTIME_REPLAY_CURSOR`) and cleanup lifecycle wiring; recovery still uses bootstrap + full journal replay (no world snapshot handoff yet).
18. Runtime world snapshot baseline is now wired (`BATTLE_RUNTIME_WORLD_SNAPSHOT`) with snapshot-capable battle runtime hooks (`createRuntimeSnapshot` / `restoreRuntimeSnapshot`), and takeover recovery can start replay from `snapshot.actionSeq`.
19. v2 local runtime cleanup can now abort pending human-decision waits, avoiding hang during stop/recover paths; `v2-runtime-snapshot` regression test is added to guard restore+resume behavior.
20. Runtime world snapshot now persists boundary metadata (`triggerMessageType` + state hints), and recovery clamps `snapshot.actionSeq` to latest action journal seq to avoid replay baseline overshoot.
21. Runtime recovery now skips battle loop restart when snapshot boundary is terminal (`BattleEnd`) and replay baseline is fully aligned, avoiding unnecessary post-end loop startup.
22. Legacy v1-only `@arcadia-eternity/local-adapter` wrapper has been removed from workspace dependencies and package tree; local runtime entry is now v2-only.

### Still Pending

1. Redis-based **fully deterministic handoff** is not fully implemented yet（当前是 world snapshot + action seq 基线，仍未覆盖 mid-phase 精确恢复与严格一致性切换协议）。
2. Zero-downtime cross-instance migration is still server-mode only and still pending full implementation.
3. Timer state machine remains deferred.
4. Failure matrix 的核心路由/接管场景已覆盖，但仍缺“真实多进程（非 mock）”集群 E2E 与故障注入稳定性验证。
5. 需要补齐“集群模式可用性”最终验收：`matchmaking`（入队/配对/建房）与 `p2p`（跨实例房间、信令、重连）在 real Redis + 多实例下的端到端确认。

## Non-goals

1. No timer state-machine redesign in this phase.
2. No compatibility layer for v1 battle object API.
3. No mixed v1/v2 execution in one room.
4. No attempt to make cluster ownership handoff apply to `p2p` rooms; migration/handoff is only for `battleMode: 'server'`.

## Design Principles

1. `server` depends on stable runtime contracts (`IBattleSystem`) instead of concrete game battle classes.
2. Game-specific data parsing and battle construction are isolated behind an adapter/factory.
3. Redis stores cluster truth (ownership/routing/snapshot/log cursors), not local memory.
4. Migration happens at deterministic boundaries (tick/phase boundary), never mid-step.
5. Room/match service only enforces lock/policy/host metadata for `p2p` rooms; authoritative runtime ownership only exists for `server` rooms.

## Room Hosting Modes

### `battleMode: 'p2p'`

- Match/room server is only responsible for:
  - room membership
  - lock validation (`packLock` / `assetLock`)
  - signaling metadata
  - host identity (`battleHost`)
- The actual battle runtime is hosted by a player peer.
- Current implementation is already running the peer-hosted runtime path for private rooms.
- Relay fallback remains available as a transport strategy for automation and degraded environments, but it does not make the server authoritative for battle runtime.

### `battleMode: 'server'`

- Battle runtime is hosted by the server cluster.
- Redis ownership, snapshotting, replay, and cross-instance takeover apply here.
- Official ranked, bot battles, arbitration, and replay recovery are expected to remain in this mode.

## Target Architecture

### 1. Runtime Host Layer (reusable)

Introduce a reusable host abstraction in server domain:

- `BattleRuntimeHost` (cluster lifecycle + room ownership + routing + event fanout)
- `BattleRuntimeInstance` (single room runtime wrapper)
- `BattleFactoryAdapter` (game-specific battle creation)

Core host only knows:

- `IBattleSystem` lifecycle (`ready`, `submitAction`, `getState`, `cleanup`)
- cluster metadata (room/player/session)
- redis coordination primitives

Core host does **not** know:

- species/skill/mark semantics
- game-specific pack format internals
- game-specific AI strategy internals

### 2. Game Adapter Layer (Seer2 today)

`Seer2BattleFactoryAdapter` handles:

1. Transform server player payload -> v2 `TeamConfig`
2. Load selected pack(s) and locale data
3. Construct `LocalBattleSystemV2`
4. Attach game-specific AI providers (if configured)

Future games implement their own adapter with the same interface.

### 3. Redis Ownership + Handoff

Only applies to `battleMode: 'server'`.

Per room keys:

- `battle:{roomId}:meta` (engineVersion, ownerInstanceId, leaseExpireAt, status, schemaVersion)
- `battle:{roomId}:routing` (active instance routing target)
- `battle:{roomId}:events` (append-only stream)
- `battle:{roomId}:snapshot:{seq}` (periodic serialized world state)
- `battle:{roomId}:cursor:{instanceId}` (replay cursor)
- `battle:{roomId}:lock` (lease via `SET NX PX`)

Handoff:

1. old owner enters `draining`
2. flush snapshot + final seq
3. new owner acquires lease
4. replay seq+1..latest
5. atomically switch routing
6. resume runtime loop

## Phased Delivery

### Phase A: Server API decoupling from v1 battle

1. Replace `Battle` concrete typing in server service with `IBattleSystem`.
2. Replace v1-only calls (`setSelection`, `startBattle`, direct `playerA/playerB`, `timerManager` access).
3. Keep current cluster behavior; timer features degrade to no-op when runtime does not support them.

### Phase B: Seer2 v2 adapter integration

1. Add server-side adapter that creates v2 battle from pack (`builtin:base` by default).
2. Convert parsed player data to `TeamConfig`.
3. Wire event subscriptions through `BattleEvent` view options (`viewerId` / `showAll`).

### Phase C: Redis migration primitives

1. Lease manager
2. Snapshot codec
3. Event stream append/replay
4. Routing switch protocol
5. Cross-instance takeover tests

### Phase D: Hard cutover + cleanup

1. Remove v1 battle server paths
2. Remove dead v1-specific timer coupling
3. Keep adapter interface for multi-game reuse

## Server Contract Changes

### Room runtime data

`LocalRoomData` should store:

- `battle: IBattleSystem`
- `battlePlayerIds: [string, string]`
- `runtimeKind: 'v2'` (future extensible)

### Event subscription

Use `battle.BattleEvent(cb, options)` semantics for:

- global/spectator stream: `showAll: true`
- player stream: `viewerId: playerId`

No direct subscription on game-specific player objects.

## Validation Checklist

1. `pnpm --filter @arcadia-eternity/server run build`
2. room create -> ready -> battle end path works in single instance
3. player/spectator `getState` visibility is correct
4. force disconnect/abandon path still produces battle end + room cleanup
5. cluster RPC paths (`submitPlayerSelection`, `getAvailableSelection`, `getState`) work with v2 runtime
6. cluster ranked/matchmaking path works (server-authoritative only, not p2p): queue join -> periodic/triggered match -> room creation -> session mappings
7. cluster p2p private room path works (separate lane): cross-instance join/signal/reconnect with consistent room routing

### Current Validation Result

Validation snapshot date: `2026-03-12`

1. `pnpm --filter @arcadia-eternity/server run build`: pass
2. `ClusterBattleService.v2` tests: pass
3. Private-room service tests: pass
4. Browser online E2E:
   - relay path: pass
   - webrtc path: pass
5. Ownership coordinator tests: pass (includes multi-instance first-owner-wins arbitration, lease-expiry takeover simulation, and non-owner release guard)
6. Reconnect/ownership regressions: pass (includes socketflow, gRPC forward integration, socket.io e2e, and runtime-recovery takeover path)
7. Battle runtime snapshot regressions: pass (`packages/battle/src/v2/__tests__/v2-runtime-snapshot.test.ts`, covers pending snapshot restart + active snapshot resume)
8. Ranked/matchmaking lane (server-only) regression suite: pass (2026-03-12)
   - `packages/server/test/rule-based-matchmaking.test.ts`
   - `packages/server/test/clusterBattleService.v2.test.ts`
   - `packages/server/test/clusterBattleServer.ownership-routing.test.ts`
   - `packages/server/test/clusterBattleServer.reconnect.integration.test.ts`
   - `packages/server/test/clusterBattleServer.reconnect.grpc-forward.integration.test.ts`
9. P2P private-room lane regression suite: pass (2026-03-12)
   - `packages/server/test/privateRoomService.test.ts` (p2p start/signal relay/reconnect restore)
10. Mock multi-instance cluster E2E baseline: pass (2026-03-12)
   - `packages/server/test/cluster.multi-instance.e2e.test.ts`
   - covers:
     - ranked/server lane: multi-instance mocked state queue join -> matchSuccess(session-level)
     - p2p lane: private-room p2p peer signal relay event channel forwarding
11. Pending: dedicated real multi-process E2E (instance A/B/C + real Redis + queue/match + p2p cross-instance reconnect + failure injection)

### Online E2E Commands

With externally started local services:

```bash
cd packages/web-ui
pnpm run test:e2e:online:relay:external
pnpm run test:e2e:online:webrtc:external
```

Server mock multi-instance baseline:

```bash
cd packages/server
pnpm vitest run test/cluster.multi-instance.e2e.test.ts
```

## Open Risks

1. Existing timer UX assumes v1 timer manager; with v2 no timer implementation yet.
2. Snapshot/replay requires strict serializable world state audit.
3. Large event bursts need stream trimming and retention strategy.

## Decisions for this iteration

1. Migrate server room runtime to `IBattleSystem + v2` first.
2. Keep timer endpoints but return runtime-provided defaults (or no-op) until timer v2 lands.
3. Build host/adapter boundaries now so future non-Seer2 games can reuse server runtime host.
