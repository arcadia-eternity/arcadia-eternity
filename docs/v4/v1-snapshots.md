# V4 快照与恢复

快照保存真实领域对象图，由可信内容目录重建类、引用、动态值和清理绑定。恢复后从保存边界续接阶段。

## 支持的边界

| 边界                                 | 保存与启动                                                                 |
| ------------------------------------ | -------------------------------------------------------------------------- |
| 未启动的初始状态                     | `snapshotBattle(battle, catalog, { boundary: 'initial' })`；恢复后正常启动 |
| 正常选招的稳定等待点，允许一方已提交 | `snapshotBattle(battle, catalog)`；恢复后 `resumeBattle()`，保留已提交选择 |

初始边界要求 turn-zero、未接受选择、无已执行阶段、活跃计时或动画。内容目录为其拥有的未启动 Battle 自动选择初始边界。正常等待点可保存决策计时、活跃动画及延后的回合计时重置。

强制/奖励换宠等待、队伍预选中、任意阶段执行中、已结束或取消的战斗，以及活跃临时效果、阶段绑定修饰器、排队/依赖阶段等状态不支持导出。未知字段、未注册函数或动态依赖、自定义领域子类/变身策略及没有适配器的 RNG 会被拒绝。

## 内容身份与状态

协议为 `arcadia.v1.battle-snapshot`、version `1`，包含内容 revision、根引用与带固定类型键的节点表。图保存别名、环、实例 ID、Map/Set、undefined、非有限数与负零。保存范围包括全队、技能/印记、suppression、变身栈、属性与 Config 修饰器、参数、动态捕获状态、RNG、执行预算及支持的计时资源。

内容提供者通过 `SnapshotCatalog` 注册稳定 Effect、规范原型和动态值/绑定工厂。revision 必须覆盖代码和内容；恢复端加载同一 revision。官方内容目录与不可变 UGC 环境会装配各自的注册表，优先使用它们的 `snapshot`/`restore` 方法。

函数、Promise、emitter、JS 调用栈和宿主对象不写入 JSON。任意 `derived(() => ...)` 需要 `registerValue`/`describeValue` 提供可信重建描述；动态闭包中的隐藏状态必须显式建模。恢复验证引用、字段、工厂、预算与内容身份后再重连依赖，参数使用保存值，不重新安装默认值或执行效果/RNG。

恢复保留实例身份。同一进程中先清理原 Battle，再恢复同身份对象；幂等 `cleanup()` 不会误清理之后恢复的实例。失败的重复恢复也不能破坏仍在运行的原 Battle。

## 正常选招点的底层用法

```ts
// content 来自 NativePackLoader；battle 已处于正常选招稳定等待点。
const saved = JSON.stringify(content.snapshot(battle))
await battle.cleanup()

const restored = content.restore(JSON.parse(saved))
restored.registerListener(onMessage)
await restored.resumeBattle()
```

底层 `restoreBattle` 本身保持静默。初始快照恢复后调用 `startBattle()`；正常等待点调用 `resumeBattle()`，先挂接观察器再启动。

使用宿主接口时，通过 `createRuntimeSnapshot()` / `restoreRuntimeSnapshot()` 保存和恢复，再调用 `ready()`。宿主适配器的 `arcadia.battle.native.v4` envelope 另保存重连窗口，并兼容其 version 1/2；恢复目标为独立宿主实例，不能在原身份仍活跃时原地回退。

## 计时与输入

恢复不立即创建 interval/timeout 或派发超时动作。续接时，运行中的决策时间计入恢复停机时长，已提交玩家保持暂停；过期回合期限走自动选择，总时间耗尽走判负。无限时长用 JSON `null` 编码。

动画保留原 ID 与安全期限；过期动画完成一次，未来期限只调度剩余时间。延后重置不会重复执行，旧动画的迟到确认无害。重连宽限使用独立绝对期限，恢复停机不会延长宽限；它属于宿主 envelope，不属于核心领域图。

续接不重放 BattleStart、TurnStart、旧动作或旧 TurnAction。需要持久动作日志时，使用[宿主恢复规则](native-hosts.md#服务端恢复)，保留初始实例与内容身份。

## 验证入口

核心回归在 `snapshot.test.ts`、`initial-snapshot.test.ts`、`timer-runtime.test.ts`、`native-battle-system.test.ts` 及作者绑定测试中。`pnpm verify:battle-v4-hosts` 检查 Node/Browser 快照交换；`pnpm verify:battle-v4-native-pack` 检查真实 Node/Chrome 的内容加载、定时续战和新目录恢复。

跨版本领域迁移、任意执行中断点与自定义闭包适配需要显式扩展协议。完整私房服务恢复还依赖存储、鉴权和传输验收。
