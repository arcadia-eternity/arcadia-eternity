# V1 选择等待点快照与恢复

2026-10-17，继续 #204，基线 `0d66dbe6`。本实现直接保存真实 V1 对象的领域状态，再重建真实 V1 类及运行时绑定；**不通过从头重打来重建状态**。没有引入替代 Battle 或简化战斗模型。

## 已实现的边界

公共入口 `@arcadia-eternity/battle/v4`：

- `snapshotBattle(battle, catalog)`：仅在正常选招的稳定等待点保存；允许一方已提交选择。`battle.isSnapshotBoundary()` 可检查该边界。
- `restoreBattle(jsonData, catalog)`：恢复对象及引用，返回真实 `Battle`，尚不执行战斗逻辑。
- `restored.resumeBattle()`：使用原版 BattleLoop/Selection/Turn 等阶段继续当前选招，不再次执行 BattleStart、TurnStart、旧效果或旧动作；不清除已接受的选择，也不重复发旧 TurnAction。
- `SnapshotCatalog`：显式提供内容 revision、稳定效果键、可选的规范原型键、自定义动态值的恢复工厂。函数通过可信代码注册表关联，JSON 中没有函数、Promise、emitter 或宿主对象。

当前只支持正常选择等待点。执行中、强制/奖励换宠等待、未开始/已结束战斗、已取消战斗均拒绝保存。活跃/等待的阶段绑定修饰器、排队/有依赖/失败的阶段、实时计时器/动画、未注册函数/动态依赖、自定义领域子类或变身策略、没有适配器的 RNG 也会明确报错。原机制继续存在，保存失败不代表内核移除了这些能力。

恢复保留战斗身份；同一进程中必须先 dispose 原 Battle，避免同 ID 同时注册。失败的重复恢复不能清理或损坏仍在运行的原 Battle。`cleanup()` 现在幂等，之后再次清理旧对象不会清理新恢复的同身份实例。

## 格式与完整状态范围

协议 `arcadia.v1.battle-snapshot` / version `1`，包含内容 revision、根对象引用和带类型的节点表。引用按图保存，保留别名、环和原始实例 ID。类型标识采用固定协议键，不依赖压缩后可能变化的类名。支持 Map/Set、普通/无原型对象、数组、undefined、非有限数和 -0；不把它们默默转换成另一种值。

| 对象                   | 保存内容                                                                                                                   | 恢复方式                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Battle                 | 状态/阶段/回合、胜者/lastKiller、全部战场印记、双方、完整对象映射、换宠字段、选项、sequence、有限 ActionLog、消息差分基线  | 真实 Battle 原型；新建本局 emitter、PhaseManager、TimerManager；续接真实阶段链 |
| Player / 原版 AIPlayer | 全队顺序、active、选择、怒气属性系统、消息视角基线、AI 状态                                                                | 真实原型及本局引用；重绑内置 AI 监听，用户监听由宿主重绑                       |
| Pet                    | 原始/当前种族、构建参数、性别/体型、HP/alive、appeared、连续技能、**全部技能/印记**、当前特性/纹章引用、属性系统           | 对象图同时恢复所有队员，不只保存出战者                                         |
| Skill                  | base、覆盖字段、effects/tags、owner、ID、可见性和全部基础/修饰属性                                                         | 原版 SkillInstance 方法继续执行                                                |
| Mark / StatLevel       | base/subclass、owner、effects/config/tags、stack/duration/active/**suppression**、额外能力等级属性系统、动态倍率、清理绑定 | 真实印记类型；重建 accessors、来源清理及 live 倍率，不重新触发 OnMarkCreated   |
| AttributeSystem        | 基础值、按属性排序的全部 Modifier、fallback、依赖图/深度计数及限制、对象 ID                                                | 原实现注册属性并重建计算流、来源索引和 disposer；不只保存有效数值              |
| Modifier / 动态值      | 类型/优先级/来源/值图、clamp 边界与订阅、清理是否已失效                                                                    | Signal 或有描述的派生值、跨对象引用、去重后的 cleanup 绑定                     |
| ConfigSystem           | 全局与 scoped 基础值/修饰器、标签、来源引用                                                                                | 当前实例的原配置逻辑；scoped 状态改为本局拥有且可枚举的 Map，cleanup 清空      |
| TransformationSystem   | 临时/永久记录、排序栈、原始/current base、priority、causedBy、策略、时间/HP 字段、休眠原生印记映射                         | 直接还原记录与原生来源身份，不再次执行变身操作或触发器                         |
| RNG                    | sfc32-v1 的 seed/a/b/c/d                                                                                                   | 直接状态续接                                                                   |

领域对象采用固定字段清单；遇到未审查的新字段会拒绝保存/恢复。Attribute/Config/Transformation 有单独的语义状态入口；缓存、注册索引、计算函数和清理函数由原类重新创建。源码清单仍是原 V1 映射，新增代码集中在 `snapshot.ts`/`snapshotBindings.ts`，没有换掉领域模型。

**阶段边界限制必须保留**：不保存 JS 调用栈、Promise/resolver，也没有恢复已完成阶段的完整诊断对象/执行历史。恢复后会建立新的真实 BattleLoop/Selection 阶段。自定义 Effect 如果把旧阶段历史、外部闭包可变变量或宿主对象当成游戏状态，不在本协议的可恢复合同内；应先将状态显式放入领域对象并提供适配器，不能宣称任意 TypeScript 闭包都可恢复。

## 内容与动态值合同

`catalog.revision` 必须由宿主绑定到不可变的内容版本（实际接入应使用内容指纹）。效果用 `registerEffect(stableKey, effect)` 注册。通过 `registerContent(stableKey, prototype)` 注册规范 Species/BaseSkill/BaseMark，可使效果闭包引用的原型与恢复对象保持同一规范身份。运行时生成的原型可以作为数据保存；规范内容按同 revision 从注册表重新取得。

注册内容是不可变定义，不是可变运行状态。恢复端必须加载同一 revision 的全部定义与工厂。注册表不会序列化函数，也无法检测任意函数闭包中的隐藏宿主状态；revision 正确性与自定义工厂的纯度是内容提供者的合同。缺失键、不同 revision 或不支持的节点/字段会报错。保存返回前会校验全部动态值描述及所需工厂；恢复在建立运行时注册前再次校验，不能把缺工厂的描述先保存、到恢复时才发现。

原 AttributeSystem 的属性引用、能力等级倍率、旧 DSL 的 selectAttribute$/selectObservable 和 sum/add/multiply/divide/clamp 具有显式依赖描述。任意 `derived(() => ...)` 不会按当前值冻结后保存，必须用 `catalog.registerValue(key, factory)` 与 `catalog.describeValue(value, key, args)` 提供恢复描述；args 也只能包含支持的数据/对象引用。原版 AI 的内置回调由原 AI 类重新绑定；自定义 AI/宿主回调不能当作普通领域对象保存。

## 使用顺序

```ts
const catalog = new SnapshotCatalog(contentFingerprint)
// 注册同版本 Effect、规范原型和必要的动态值工厂。
// 从事件回调保存时应延后到等待真正建立后，再检查边界。
if (battle.isSnapshotBoundary()) {
  const json = JSON.stringify(snapshotBattle(battle, catalog))
  // 持久化 json；之后可以结束原进程。
}

// 新进程先加载同一内容 revision，再恢复。
const restored = restoreBattle(JSON.parse(json), catalog)
restored.registerListener(handleBattleMessage)
const running = restored.resumeBattle()
// 读取当前状态/可选动作，仅向尚未选择的玩家请求输入。
// 首次续接不会重复旧 TurnAction；已有选择会被保留。
await running
```

Node/Browser 和独立进程演示：`pnpm verify:battle-v4-hosts`。会生成 `packages/battle/dist/v1-host-check/checkpoint.json` 与独立进程结果，使用公开包入口，不需要 Redis、数据库或 Battle Server。

## 验收与剩余工作

专项测试覆盖：部分输入、完整 4 回合续战、动态 DSL/能力等级/配置、再次保存、原生变身来源、跨目标清理、reactive clamp、非法内容/引用拒绝且不影响原 Battle、恢复后的取消/投降与 AI 随机决策。完整历史 YAML 场景在第二回合后保存，恢复到七回合 A 胜，剩余事件类型顺序及伤害逐项相同；检查已知 HP/怒气结算。Node、真实 Chrome 和独立 Node 进程验证同一检查点的实际续战结果。Browser 构建开启压缩，并验证未压缩 Node 与压缩 Browser 双向交换 JSON 快照；真实 Chrome 还会恢复 Node 生成的快照。

本轮验证结果、日志和两轴审查见 [快照验收记录](./validation/snapshot-checks.md)。

本轮不等于 #204 全部完成。仍缺：任意阶段中途保存、换宠等待续接、实时计时/动画与宿主时钟协议、阶段绑定修饰器/队列/依赖恢复、阶段诊断历史与任意自定义闭包的适配、跨版本迁移、稳定的未来消息实例 ID、持久 ActionLog replay fixture/验证器。现有 ActionLog 仍只覆盖 Battle.setSelection；内置 AI 的直接 Player.setSelection 不在该日志内。完整官方效果逐项实战验收仍未完成。P2P 按本轮要求跳过；不扩展到联机 Server 改造。
