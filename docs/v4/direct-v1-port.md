# Direct V1 port — preserve first

关联 #200、#202、#203、#204；不自动关闭 Issue。PR：[直接移植原版 V1 #229](https://github.com/arcadia-eternity/arcadia-eternity/pull/229)，目标 `refactor/v4`。本分支从包含 #201 的 `2fcb8640` 创建；不改 main，不覆盖 #227/#228 分支或沿用其重写模型。

## 来源与当前改动

来源 commit：`c086289812885e7a4903b181e2b8989e201452b8`。

- `7c70415f` 原始导入 42/42 Battle 源文件，逐字节一致；`58b85316` 继续导入原版 EffectBuilder、parser、DataRepository，后续补齐完整 schema/parser 闭包与历史 YAML。
- [V1 Port Inventory](./v1-port-inventory.md) 逐文件列原路径、新路径及改动；[provenance](./v1-port-provenance.json) 保存 87 个映射文件的原始 Git blob、原始/当前 SHA256。[源码对照](./v1-compatibility.patch) 包含相对原 commit 的完整改动。
- 当前 42 个映射文件字节一致、45 个有记录的兼容或现代化修改。没有排除核心文件或删去未知战斗机制。原导入提交仍可独立审查。
- 第一里程碑的兼容修改包括 const 类型/消息差异、具名 Builder 声明生成、monorepo 子入口、JSON import with、浏览器 process 检查和历史 Zod 3 schema。没有重写官方 Effect。
- 原版跑通后，增加构造器适配、RNG 注入、有限 ActionLog；本轮经用户明确要求修复历史缺陷并替换 RxJS/Prando。逐项原因、前后代码、回归与接口变化见 [V1 现代化报告](./v1-modernization.md)。

## 实际运行的战斗

`Battle.startBattle()` 仍运行真实 V1 BattleStart → BattleLoop → Switch/Selection/Turn → Skill/Effect/Damage/Heal/Mark/Rage → BattleEnd 阶段。测试检查 PhaseState.Failed、EffectApplyFail 与错误消息，不能用吞掉异常冒充通过。

- 自定义机制场景：4 回合 2v2，包含怒气、属性、动态来源修饰、印记创建/持续/到期/销毁、主动/强制换宠、击破奖励、阵亡及完整结算。
- 全部历史 YAML 经原版 schema/parser 加载：666 Effects、280 Marks、576 Skills、91 Species，无加载错误。这只证明加载兼容，未逐项实战验收全部官方效果。
- #201 队伍与 16 个显式动作经原版 DSL 运行：7 回合 A 胜，实际执行浑浊水域和气力。历史 V1 无幻璃，使用当前官方种族定义输入原版 SpeciesParser，并明确不添加能力/纹章；迪兰保留 V1 原默认特性。原先测试侧手工补写 HP 已移除，显式 HP 配置现在由修复后的真实 PetParser/Pet 生效。
- #201 的三个 V1/V2 差异继续保留 V1 行为并有普通断言；未自动认定 V2 行为正确，未修改 V2 原测试/fixtures/预期。

## 本轮修复与依赖替换

已修复受击怒气旧上下文、HP/性别参数、能力等级反转、替补治疗、Builder 默认值、BeforeSort 优先级、sureCrit/忽略阶段传递、阶段错误传播/配置生命周期、输入等待取消、变身 HP 比例/重复派发/原生来源丢失及订阅清理等问题。原 V1-BUG-01 已从 expected-failure 改为普通通过。专项测试和逐项限制见现代化报告，不宣称所有历史问题已解决。

- RxJS：改用 `Signal/ReactiveValue/derived` 同步值；保留原属性/配置计算、动态 DSL、阶段绑定和清理。保留历史 DSL 的 `Observable<...>` 类型标签及 `selectObservable` 名称。自定义 TypeScript 效果需要把 RxJS 输入改为同步值；不提供 RxJS `.pipe`、异步 producer 或 scheduler 兼容。
- Prando：默认改为独立 `sfc32-v1`，算法从现有 engine RNG 单独移入，运行时不依赖 engine。支持 string/number/0 种子、版本化 JSON RNG 状态与直接续接。**同种子序列与 Prando 不同**，V4 精确场景预期按实跑结果更新；#201/V2 未改。
- battle package 的两个依赖声明已移除；V4 import 允许列表和实际 Node/browser 模块图检查均拒绝重新引入。其他 package 仍需用的 RxJS 没有擅自删除。
- 非零自动 retryCount/timeout 明确在执行前报错，未实现回滚重试/合作式超时。默认错误向上传播，skipOnError 仍保留。自定义阶段可显式提供 phaseType，内置阶段保留类名。

使用入口：`@arcadia-eternity/battle/v4`；原 DSL 工具：`@arcadia-eternity/battle/v4/legacy`。`createBattle` 只调用原 Battle 构造器。无需 Redis、数据库或外部 Battle Server。默认 package 入口仍为 V2。

## 原移植/依赖替换里程碑验证（2026-10-16）

| 验证                                               | 结果                                                                                              | 证据                                                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 全仓构建 `pnpm build`                              | lint、全部 package build、根 typecheck、CLI bundle 通过                                           | [完整构建](./validation/full-build.log)                                                                                            |
| #201/V2 `pnpm test:battle-baseline`                | 19 文件，108 通过 + 3 既有预期失败，预期未改                                                      | [原样回归](./validation/v2-baseline.log)                                                                                           |
| 真实 V1 `pnpm test:battle-v4`                      | 8 文件，58 通过，无预期失败                                                                       | [V1 回归](./validation/v1-tests.log)                                                                                               |
| V4/#201 types 与 V4 lint                           | 全部通过；含所有 legacy 源码和新同步值/RNG                                                        | [检查记录](./validation/typecheck-lint.log)                                                                                        |
| 原码来源与依赖闭包                                 | 42 核心、87 映射完整，43 原样、44 已记录修改                                                      | [来源校验](./validation/source-check.json)                                                                                         |
| Node + 真实 Chrome                                 | 同一完整 4 回合战斗及 DSL、动态值、RNG 续接完全一致；各 38 模块且无 RxJS/Prando/engine/服务端依赖 | [宿主结果](./validation/node-browser.log)、[Node 完整输出](./validation/node-result.json)、[模块图](./validation/host-graphs.json) |
| CLI `pnpm battle:v4-demo`                          | 原版 YAML/DSL 实跑 7 回合 A 胜；16 动作                                                           | [CLI 状态](./validation/cli-result.json)                                                                                           |
| 其他 package tests（排除 P2P 与单独验证的 battle） | engine 4、schema 14（跳过 6）、client 3、rules 37 通过；Server 串行复验 104 通过、2 断线断言失败  | [扩展检查](./validation/recursive-tests.log)、[Server 复验](./validation/server-tests.log)                                         |

第一次并行运行 V1/V2/全量数据加载/CLI 引发数据加载超时；改为串行复验后 V1、V2 和 Server 的加载测试通过。没有放宽超时或删除断言。Server 剩余两项失败分别为双断线仍调用 grace-period、跨实例未通知终止；相关 Server 源码、测试及默认 V2 运行路径相对 #201 基线没有改动。本轮不修联机 Server，不能宣称排除 P2P 后全仓 tests 全绿。P2P 按用户要求未运行。

已保留失败→修复的专项证据（[索引](./validation/modernization-checks.md)）。历史导入源码沿用明确风格豁免；新 adapter、同步值、RNG 和测试采用常规 lint。为保持原码对照聚焦语义变化，不对整套历史文件进行格式重写。

## #204 真实状态与缺口

| 状态            | 必须保存/重建                                                                      | 当前边界                                             |
| --------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Battle          | 回合/阶段/胜者、lastKiller、强制/击破奖励状态、sequence、消息差分基线、对象映射    | getState 仍是消息视图                                |
| Player          | 选择、队伍顺序/active、基础/有效怒气、来源修饰                                     | owner/emitter/回调需重建                             |
| Pet/Skill       | 原始/当前种族、IV/EV/性格/等级、HP/alive、连续技能、全部技能/印记、覆盖属性/效果   | 不能只存有效属性或出战者                             |
| Mark            | subclass、来源/owner、stack/duration/active/**suppression**、config/tags、能力等级 | StatLevel 有额外属性系统；休眠原生印记仍维护持续时间 |
| Modifier/Config | 基础值、优先级、来源/作用域、Current/Next 具体实例绑定、动态依赖                   | Signal 不等于可序列化计算函数，需表达式/注册表       |
| Phase/Context   | 嵌套栈/等待点/排序队列、目标/命中/暴击/多段/伤害与父引用                           | Promise/resolver/调用栈不能 JSON 化                  |
| Transform       | 临时/永久记录及策略、优先级、来源、原型、原生印记关系、当前 HP 比例                | 需要稳定原型/效果引用                                |
| RNG             | seed、algorithm、a/b/c/d                                                           | 已能独立保存/恢复 RNG 流，非 Battle 恢复             |
| Host            | 真实时钟/Timer/动画、监听器、AI 决策                                               | 需要宿主时钟/输入事件契约                            |

`getActionLog()` 记录 Battle.setSelection 接受的输入、回合/阶段/顺序并返回副本；直接 Player.setSelection（含 AI 路径）仍不在范围内，ID 仍是本局实例 ID。Battle Event 沿用原有 BattleMessage/sequenceId。

**2026-10-17 续作已实现正常选择等待点的直接快照/恢复，见 [快照报告](./v1-snapshots.md)**；尚无任意阶段中途恢复或持久 replay。同种子/同动作的归一化回归重跑只覆盖已测场景，不能据此宣称 #204 验收完成。

## 仍未完成与下一阶段

- 完整官方效果实战等价验收；AfterAttacked/OnTransformEnd 全调用路径、inheritOnFaint 规则、变身所有堆栈组合和计时器竞态仍待确认，保留原机制且不擅自补规则。
- 选择等待点已有状态/引用恢复与动态依赖注册；仍需任意阶段/计时与持久 replay，不复用 #228 的简化快照。
- 通用 CLI/Web/Electron/Server 产品接入；历史 Rollup/Babel/Node scriptLoader 的宿主热更新链未重建。
- #202 原类 API/Node/Browser 可运行且等待取消已有回归；#203 直接继承原领域模型并局部修复；#204 有 RNG 注入/状态与有限 ActionLog。三项仍待完整验收，不关闭 Issue。

下一阶段先确定尚缺的触发/印记规则并补实战覆盖，再围绕上表设计稳定引用、动态依赖注册和安全等待点恢复。继续在这份真实 V1 源码上改造。
