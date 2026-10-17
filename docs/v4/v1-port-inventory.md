# V1 Port Inventory

来源：`c086289812885e7a4903b181e2b8989e201452b8`。2026-10-16 审计，先完整读取历史源码树，再决定移植范围。

## 基线与既有工作审查

- main = `1492b2cae49a65d88c7132047132c85d0d06bff1`；refactor/v4 = `2fcb8640e276b93bffa76aeb648aecd9e7712675`（#201 / #226）。本分支从后者创建。
- A：保留 #201 全部 V2 测试、golden、已知缺陷、独立类型检查、lint 与 CI，不改其预期。
- B：V2 engine RNG 及 #228 的 sfc32 RNG、数据校验/日志和浏览器验证工具有复用价值，但更换 Prando 会改变 V1 序列；原始移植里程碑不移入不同算法；后经用户明确授权，复用现有 sfc32 算法为独立 RNG，不引入 engine 运行时。#228 的快照依赖重写后的对象状态，不能套在真实 V1 上。
- C：#227（`8fb50360`、`1d040c73`）从零创建 battle-core，已撤回。#228（`dcc5a839` 至 `3715cb22`）在 src/core 重写对象、阶段、属性、配置、变身与快照，虽有广泛测试，不能据此认定它继承了 V1 所有机制。两个 PR 均未合并，本轮不删除或覆盖其分支。
- D：历史 V1 下表 42 文件全部保留：不以源码大小或测试数量删减机制。当前 V2、CLI、UI、联机宿主继续保留；V4 使用独立子入口。

## 原始 V1 生命周期与语义审计（当前修复另见 modernization）

- Battle 构造注册两个 Player、全部 Pet/Skill、mitt emitter、独立 ConfigSystem、PhaseManager、TransformationSystem、TimerManager。startBattle 异步运行 BattleStart → BattleLoop；循环执行 Switch → Selection → Turn；BattleEnd 停计时器，cleanup 清理阶段和属性/配置注册表。
- Player 初始怒气 20，队伍首只为 active；Pet.setOwner 初始化真实技能、种族/等级/性格/IV/EV 属性、HP、特性/纹章印记。选择由 Battle.setSelection 唤醒输入等待；AIPlayer 原版另有直接选招路径。
- Turn：建上下文并触发 BeforeSort；换宠先于技能，技能依优先级/速度，平局保留顺序；TurnStart → 各动作及印记清理 → TurnEnd 效果 → 双方回合怒气 → 活跃精灵/战场印记更新 → 清理 → TurnEnd 消息。
- Skill：更新连续使用记录与可见性；BeforeUseSkillCheck 后刷新当前目标；可用/阵亡/怒气检查；消耗怒气；AfterUseSkillCheck；命中/多段/暴击；BeforeMultiHit；每段 BeforeHit、伤害、OnHit 或 OnMiss；命中奖励 15 怒气；阵亡/击杀奖励；finally 清印记及 SkillUseEnd 消息。
- Damage：类别与攻防、等级、属性克制、STAB、暴击、0.85–1 浮动；伤害上下文百分比/固定修正及阈值；OnBeforeCalculateDamage → Shield/逐盾消耗 → HP → OnDamage → 消息 → PostDamage/OnCritPostDamage → 存活标记。Heal 与 Rage 各有真实阶段和前后触发。
- Effect：真实 Effect 保存函数/条件/优先级/消耗层数；遍历战场、双方所有队员印记与技能，按来源+效果去重、优先级排序，BeforeEffect/AfterEffect 嵌套触发并捕捉错误。没有把函数替换为简化 effect opcode。
- Mark：互斥组；叠层/刷新/延长/最大/替换/移除/none；能力阶段标记和 RxJS computed modifier；持续/到期/销毁触发；护盾；下场保留、转移；销毁清理来源修饰及变身。inheritOnFaint 字段保留，但历史实现未见独立派发逻辑。
- Switch：OnSwitchOut → 印记下场处理 → 更新 active → 消息 → OnSwitchIn/OnOwnerSwitchIn → floor(rage\*0.8)。强制换宠和击破奖励同时收集，双方都倒下时无击破奖励；全队倒下结算（可平局）。
- AttributeSystem：BehaviorSubject/Observable、computed、排序修饰器、percent/delta/override/clamp、来源与阶段绑定、循环依赖回退、注册表及清理。ConfigSystem：全局模板复制、作用域链、标签、修饰器、阶段栈及类型绑定。
- Transformation：Pet/Skill/Mark 三策略，临时优先级栈、同来源替换、永久策略、保留/覆盖效果、HP 比例、来源销毁后恢复。全部保留。
- Timer：玩家回合/总时间、动画追踪与暂停、快照和 mitt 事件、超时自动选择/判负；浏览器标准定时器，无 Node 服务要求。默认按原版配置，headless 实测明确禁用计时。

## 内外依赖

所有相对 import/export 与两处 dynamic import 均在 42 文件闭包内，无遗失内部文件；完整边列表见 `v1-import-graph.json`。
运行外依赖：`@arcadia-eternity/const`（现有同值枚举/数据类型，差异由兼容修改处理）、`rxjs`/`rxjs/operators`、`prando`、`mitt`、`nanoid`、`jsondiffpatch`。这是原始 V1 的依赖清单；当前移植版已经移除 RxJS/Prando，改为独立同步值和 sfc32 实现，其余依赖在 battle package 声明。本内核不 import parser、effectBuilder、dataRepository、engine、Redis、数据库、DOM、FS 或服务端。
历史 DSL 在仓库其他包中构建 Effect，是内容输入边界而非 Battle 的缺失内部依赖；本阶段保留 Effect 函数接口和全部执行机制。官方 DSL 加载器与全量官方内容兼容需要单独验证，不把几个原生 Effect 样例当作官方目录等价证明。后续移植的额外历史文件单列来源映射。

## 文件清单

| V1 路径                                           | 移植 | 新路径                                               | 修改                                                                               |
| ------------------------------------------------- | ---- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `packages/battle/src/attributeSystem.ts`          | 是   | `packages/battle/src/v4/attributeSystem.ts`          | 同步值/来源与阶段修复；新增完整基础/修饰/fallback/依赖状态导出与重建、cleanup 描述 |
| `packages/battle/src/battle.ts`                   | 是   | `packages/battle/src/v4/battle.ts`                   | RNG/ActionLog/取消修复；增加检查点边界、真实阶段续接、幂等 cleanup                 |
| `packages/battle/src/config.ts`                   | 是   | `packages/battle/src/v4/config.ts`                   | 同步值/阶段隔离修复；scoped Map 与标签/修饰器导出、重建及本局注册清理              |
| `packages/battle/src/context.ts`                  | 是   | `packages/battle/src/v4/context.ts`                  | V2 新 enum 类型回退；技能 sureHit/sureCrit/忽略阶段和替换技能配置传递              |
| `packages/battle/src/effect.ts`                   | 是   | `packages/battle/src/v4/effect.ts`                   | 跳过失效或被抑制的印记来源                                                         |
| `packages/battle/src/entity.ts`                   | 是   | `packages/battle/src/v4/entity.ts`                   | 原样保留                                                                           |
| `packages/battle/src/index.ts`                    | 是   | `packages/battle/src/v4/index.ts`                    | 原样保留                                                                           |
| `packages/battle/src/logger.ts`                   | 是   | `packages/battle/src/v4/logger.ts`                   | 原样保留                                                                           |
| `packages/battle/src/mark.ts`                     | 是   | `packages/battle/src/v4/mark.ts`                     | 同步能力等级/抑制/清理修复；倍率加入可恢复依赖描述                                 |
| `packages/battle/src/pet.ts`                      | 是   | `packages/battle/src/v4/pet.ts`                      | 显式 maxHp；传递真实伤害/治疗上下文；只使用生效护盾                                |
| `packages/battle/src/phase/AddMarkPhase.ts`       | 是   | `packages/battle/src/v4/phase/AddMarkPhase.ts`       | 接收调用者原上下文                                                                 |
| `packages/battle/src/phase/MarkCleanupPhase.ts`   | 是   | `packages/battle/src/v4/phase/MarkCleanupPhase.ts`   | 原样保留                                                                           |
| `packages/battle/src/phase/MarkStackPhase.ts`     | 是   | `packages/battle/src/v4/phase/MarkStackPhase.ts`     | 原样保留                                                                           |
| `packages/battle/src/phase/MarkSwitchOutPhase.ts` | 是   | `packages/battle/src/v4/phase/MarkSwitchOutPhase.ts` | 原样保留                                                                           |
| `packages/battle/src/phase/MarkTransferPhase.ts`  | 是   | `packages/battle/src/v4/phase/MarkTransferPhase.ts`  | 原样保留                                                                           |
| `packages/battle/src/phase/MarkUpdatePhase.ts`    | 是   | `packages/battle/src/v4/phase/MarkUpdatePhase.ts`    | 原样保留                                                                           |
| `packages/battle/src/phase/RemoveMarkPhase.ts`    | 是   | `packages/battle/src/v4/phase/RemoveMarkPhase.ts`    | 消息补 baseMarkId；接收调用者原上下文                                              |
| `packages/battle/src/phase/base.ts`               | 是   | `packages/battle/src/v4/phase/base.ts`               | 取消状态不被完成覆盖；同步阶段完成/失败钩子；配置使用本局并及时清理                |
| `packages/battle/src/phase/battleLoop.ts`         | 是   | `packages/battle/src/v4/phase/battleLoop.ts`         | 等待取消/结束检查；正常选招检查点续接入口，保留原阶段顺序                          |
| `packages/battle/src/phase/battleStart.ts`        | 是   | `packages/battle/src/v4/phase/battleStart.ts`        | 原样保留                                                                           |
| `packages/battle/src/phase/battleSwitch.ts`       | 是   | `packages/battle/src/v4/phase/battleSwitch.ts`       | 等待点取消与战斗结束检查                                                           |
| `packages/battle/src/phase/damage.ts`             | 是   | `packages/battle/src/v4/phase/damage.ts`             | 接收调用者原上下文；拒绝伤害结果归零                                               |
| `packages/battle/src/phase/effect.ts`             | 是   | `packages/battle/src/v4/phase/effect.ts`             | 原样保留                                                                           |
| `packages/battle/src/phase/effectExecution.ts`    | 是   | `packages/battle/src/v4/phase/effectExecution.ts`    | 不收集失效/被抑制来源的效果                                                        |
| `packages/battle/src/phase/heal.ts`               | 是   | `packages/battle/src/v4/phase/heal.ts`               | 接收原上下文；实际调用 isActive()                                                  |
| `packages/battle/src/phase/index.ts`              | 是   | `packages/battle/src/v4/phase/index.ts`              | 原样保留                                                                           |
| `packages/battle/src/phase/manager.ts`            | 是   | `packages/battle/src/v4/phase/manager.ts`            | 错误/父阶段修复；增加快照队列/依赖安全检查                                         |
| `packages/battle/src/phase/mark.ts`               | 是   | `packages/battle/src/v4/phase/mark.ts`               | 保存 owner 后再反转能力等级印记                                                    |
| `packages/battle/src/phase/rage.ts`               | 是   | `packages/battle/src/v4/phase/rage.ts`               | 接收原上下文；尊重效果取消怒气变化                                                 |
| `packages/battle/src/phase/selection.ts`          | 是   | `packages/battle/src/v4/phase/selection.ts`          | 恢复时保留既有选择，不重发旧选招事件/重置计时；其余选招逻辑原样                    |
| `packages/battle/src/phase/skill.ts`              | 是   | `packages/battle/src/v4/phase/skill.ts`              | 暴露排序所需的当前上下文优先级                                                     |
| `packages/battle/src/phase/switch.ts`             | 是   | `packages/battle/src/v4/phase/switch.ts`             | 原样保留                                                                           |
| `packages/battle/src/phase/transform.ts`          | 是   | `packages/battle/src/v4/phase/transform.ts`          | 消除重复变身前后派发；由原 TransformationSystem 负责                               |
| `packages/battle/src/phase/turn.ts`               | 是   | `packages/battle/src/v4/phase/turn.ts`               | 使用 BeforeSort 更新后的优先级                                                     |
| `packages/battle/src/player.ts`                   | 是   | `packages/battle/src/v4/player.ts`                   | 共享 RNG 与原上下文；恢复时重绑原 AI 内置监听                                      |
| `packages/battle/src/skill.ts`                    | 是   | `packages/battle/src/v4/skill.ts`                    | 具名 Builder 声明兼容；默认 100%/1 段；新技能属性系统加入本局清理                  |
| `packages/battle/src/timer/animationTracker.ts`   | 是   | `packages/battle/src/v4/timer/animationTracker.ts`   | 原样保留                                                                           |
| `packages/battle/src/timer/battleTimer.ts`        | 是   | `packages/battle/src/v4/timer/battleTimer.ts`        | 原样保留                                                                           |
| `packages/battle/src/timer/index.ts`              | 是   | `packages/battle/src/v4/timer/index.ts`              | 原样保留                                                                           |
| `packages/battle/src/timer/timerManager.ts`       | 是   | `packages/battle/src/v4/timer/timerManager.ts`       | 当前事件类型兼容；检查并拒绝实时计时/活动动画快照                                  |
| `packages/battle/src/transformation.ts`           | 是   | `packages/battle/src/v4/transformation.ts`           | 原局部修复；导出/重建完整记录与来源映射，不重做变身触发                            |
| `packages/battle/src/transformationStrategies.ts` | 是   | `packages/battle/src/v4/transformationStrategies.ts` | 同步策略/原生抑制修复；原生来源映射改为本局拥有的可枚举 Map                        |

无核心源文件被排除。历史包的 rollup/tsconfig/package 由当前 monorepo 配置承接；不恢复旧构建链。额外兼容变更及验证结论见 `direct-v1-port.md`。

## 追加移植的内容闭包

为避免以手写效果代替官方行为，在首场原版 Battle 运行后继续从同一历史 commit 提取 EffectBuilder 全部 9 个源文件与 type-metadata、完整 parser/schema 源码及 DataRepository。历史 YAML 作为只读测试材料保留。`v1-port-provenance.json` 对全部 87 个映射文件保存原始 Git blob、原始 SHA256、当前 SHA256；`pnpm verify:battle-v4-source` 检查遗漏、未审查修改、相对 import 闭包和外部依赖允许列表。

以下文件全部移植，没有删减 DSL operator/selector。相对历史源码的完整差异可直接查看 `v1-compatibility.patch`；不必在新增的几万行中猜测哪些是重写。

| 原路径                                               | 新路径                                                                    | 修改                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/effectBuilder/src/evaluator.ts`            | `packages/battle/src/v4/legacy/effectBuilder/src/evaluator.ts`            | 仅 import 路径                                                    |
| `packages/effectBuilder/src/condition.ts`            | `packages/battle/src/v4/legacy/effectBuilder/src/condition.ts`            | 仅 import 路径                                                    |
| `packages/effectBuilder/src/extractor.ts`            | `packages/battle/src/v4/legacy/effectBuilder/src/extractor.ts`            | 仅 import 路径                                                    |
| `packages/effectBuilder/src/operator.ts`             | `packages/battle/src/v4/legacy/effectBuilder/src/operator.ts`             | import/递归值类型断言；动态值类型改 ReactiveValue                 |
| `packages/effectBuilder/src/selector.ts`             | `packages/battle/src/v4/legacy/effectBuilder/src/selector.ts`             | import/浏览器 process 检查；动态选择器改同步值，保留原 DSL/API 名 |
| `packages/effectBuilder/src/index.ts`                | `packages/battle/src/v4/legacy/effectBuilder/src/index.ts`                | 字节一致                                                          |
| `packages/effectBuilder/src/runtime-type-checker.ts` | `packages/battle/src/v4/legacy/effectBuilder/src/runtime-type-checker.ts` | JSON assertion 改 with                                            |
| `packages/effectBuilder/src/conditionStep.ts`        | `packages/battle/src/v4/legacy/effectBuilder/src/conditionStep.ts`        | 字节一致                                                          |
| `packages/effectBuilder/src/effectBuilder.ts`        | `packages/battle/src/v4/legacy/effectBuilder/src/effectBuilder.ts`        | 仅 import 路径                                                    |
| `packages/effectBuilder/type-metadata.json`          | `packages/battle/src/v4/legacy/effectBuilder/type-metadata.json`          | 字节一致                                                          |
| `packages/parser/src/parseEffect.ts`                 | `packages/battle/src/v4/legacy/parser/parseEffect.ts`                     | import/浏览器 process 检查；动态值类型改 ReactiveValue            |
| `packages/schema/src/effectDsl.ts`                   | `packages/battle/src/v4/legacy/schema/effectDsl.ts`                       | 仅 import 路径                                                    |
| `packages/dataRepository/src/dataRepository.ts`      | `packages/battle/src/v4/legacy/dataRepository.ts`                         | 仅 import 路径                                                    |
| `packages/schema/src/effectSchema.ts`                | `packages/battle/src/v4/legacy/schema/effectSchema.ts`                    | 仅 import 路径                                                    |
| `packages/schema/src/mark.ts`                        | `packages/battle/src/v4/legacy/schema/mark.ts`                            | 字节一致                                                          |
| `packages/parser/src/effect.ts`                      | `packages/battle/src/v4/legacy/parser/effect.ts`                          | 仅 import 路径                                                    |
| `packages/parser/src/index.ts`                       | `packages/battle/src/v4/legacy/parser/index.ts`                           | 字节一致                                                          |
| `packages/parser/src/mark.ts`                        | `packages/battle/src/v4/legacy/parser/mark.ts`                            | 仅 import 路径                                                    |
| `packages/parser/src/pet.ts`                         | `packages/battle/src/v4/legacy/parser/pet.ts`                             | import；传递显式 maxHp/gender                                     |
| `packages/parser/src/player.ts`                      | `packages/battle/src/v4/legacy/parser/player.ts`                          | 仅 import 路径                                                    |
| `packages/parser/src/selection.ts`                   | `packages/battle/src/v4/legacy/parser/selection.ts`                       | schema import；移除 V2 新选择类型导致不成立的 never 断言          |
| `packages/parser/src/skill.ts`                       | `packages/battle/src/v4/legacy/parser/skill.ts`                           | 仅 import 路径                                                    |
| `packages/parser/src/species.ts`                     | `packages/battle/src/v4/legacy/parser/species.ts`                         | 仅 import 路径                                                    |
| `packages/parser/src/utils.ts`                       | `packages/battle/src/v4/legacy/parser/utils.ts`                           | 字节一致                                                          |
| `packages/schema/src/element.ts`                     | `packages/battle/src/v4/legacy/schema/element.ts`                         | 字节一致                                                          |
| `packages/schema/src/index.ts`                       | `packages/battle/src/v4/legacy/schema/index.ts`                           | 字节一致                                                          |
| `packages/schema/src/markImage.ts`                   | `packages/battle/src/v4/legacy/schema/markImage.ts`                       | 字节一致                                                          |
| `packages/schema/src/metadata.ts`                    | `packages/battle/src/v4/legacy/schema/metadata.ts`                        | 字节一致                                                          |
| `packages/schema/src/pet.ts`                         | `packages/battle/src/v4/legacy/schema/pet.ts`                             | 字节一致                                                          |
| `packages/schema/src/player.ts`                      | `packages/battle/src/v4/legacy/schema/player.ts`                          | 字节一致                                                          |
| `packages/schema/src/schema.ts`                      | `packages/battle/src/v4/legacy/schema/schema.ts`                          | 字节一致                                                          |
| `packages/schema/src/selection.ts`                   | `packages/battle/src/v4/legacy/schema/selection.ts`                       | 字节一致                                                          |
| `packages/schema/src/skill.ts`                       | `packages/battle/src/v4/legacy/schema/skill.ts`                           | 字节一致                                                          |
| `packages/schema/src/species.ts`                     | `packages/battle/src/v4/legacy/schema/species.ts`                         | 字节一致                                                          |
| `data/effect_ability.yaml`                           | `packages/battle/test/v4/fixtures/v1-data/effect_ability.yaml`            | 字节一致                                                          |
| `data/effect_emblem.yaml`                            | `packages/battle/test/v4/fixtures/v1-data/effect_emblem.yaml`             | 字节一致                                                          |
| `data/effect_global.yaml`                            | `packages/battle/test/v4/fixtures/v1-data/effect_global.yaml`             | 字节一致                                                          |
| `data/effect_mark.yaml`                              | `packages/battle/test/v4/fixtures/v1-data/effect_mark.yaml`               | 字节一致                                                          |
| `data/effect_skill.yaml`                             | `packages/battle/test/v4/fixtures/v1-data/effect_skill.yaml`              | 字节一致                                                          |
| `data/mark.yaml`                                     | `packages/battle/test/v4/fixtures/v1-data/mark.yaml`                      | 字节一致                                                          |
| `data/mark_ability.yaml`                             | `packages/battle/test/v4/fixtures/v1-data/mark_ability.yaml`              | 字节一致                                                          |
| `data/mark_emblem.yaml`                              | `packages/battle/test/v4/fixtures/v1-data/mark_emblem.yaml`               | 字节一致                                                          |
| `data/mark_global.yaml`                              | `packages/battle/test/v4/fixtures/v1-data/mark_global.yaml`               | 字节一致                                                          |
| `data/skill.yaml`                                    | `packages/battle/test/v4/fixtures/v1-data/skill.yaml`                     | 字节一致                                                          |
| `data/species.yaml`                                  | `packages/battle/test/v4/fixtures/v1-data/species.yaml`                   | 字节一致                                                          |

没有恢复历史 Rollup、Babel、类型元数据生成器、旧 Node scriptLoader 和旧 Server/UI 的宿主入口：它们不是 Battle/DSL 运行时 import 闭包；已保留生成后的完整 type-metadata。当前 monorepo 的依赖、构建和小型文件读取测试宿主承接这些职责。未声称旧热更新工具链已产品化接入。

新增代码包括 `src/v4/api.ts` 构造器转发、`reactiveValue.ts` 同步值、从当前 engine RNG 单独移入的 `rng.ts` 以及测试/宿主验证/来源检查工具；没有新增领域替代模型。`test/v4/fixtures/qili.json` 是历史 skill/effect YAML 中指定 ID 的解析记录，供 Browser 无 FS 验证，仍使用原 DSL。

本轮现代化的逐项理由、接口变化和测试映射见 [v1-modernization.md](./v1-modernization.md)。来源映射仍包含全部 87 个原文件；新增同步值与 RNG 不伪装为历史原码。

2026-10-17：新增正常选招等待点快照/恢复，协议和完整状态/缺口见 [v1-snapshots.md](./v1-snapshots.md)。新增 snapshot.ts、snapshotBindings.ts 是原类的状态适配层；原始 42 个文件仍全部保留。
