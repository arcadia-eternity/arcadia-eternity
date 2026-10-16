# V1 Port Inventory

来源：`c086289812885e7a4903b181e2b8989e201452b8`。2026-10-16 审计，先完整读取历史源码树，再决定移植范围。

## 基线与既有工作审查

- main = `1492b2cae49a65d88c7132047132c85d0d06bff1`；refactor/v4 = `2fcb8640e276b93bffa76aeb648aecd9e7712675`（#201 / #226）。本分支从后者创建。
- A：保留 #201 全部 V2 测试、golden、已知缺陷、独立类型检查、lint 与 CI，不改其预期。
- B：V2 engine RNG 及 #228 的 sfc32 RNG、数据校验/日志和浏览器验证工具有复用价值，但更换 Prando 会改变 V1 序列；本阶段不移入不同算法。#228 的快照依赖重写后的对象状态，不能套在真实 V1 上。
- C：#227（`8fb50360`、`1d040c73`）从零创建 battle-core，已撤回。#228（`dcc5a839` 至 `3715cb22`）在 src/core 重写对象、阶段、属性、配置、变身与快照，虽有广泛测试，不能据此认定它继承了 V1 所有机制。两个 PR 均未合并，本轮不删除或覆盖其分支。
- D：历史 V1 下表 42 文件全部保留：不以源码大小或测试数量删减机制。当前 V2、CLI、UI、联机宿主继续保留；V4 使用独立子入口。

## 生命周期与语义审计

- Battle 构造注册两个 Player、全部 Pet/Skill、mitt emitter、独立 ConfigSystem、PhaseManager、TransformationSystem、TimerManager。startBattle 异步运行 BattleStart → BattleLoop；循环执行 Switch → Selection → Turn；BattleEnd 停计时器，cleanup 清理阶段和属性/配置注册表。
- Player 初始怒气 20，队伍首只为 active；Pet.setOwner 初始化真实技能、种族/等级/性格/IV/EV 属性、HP、特性/纹章印记。选择由 Battle.setSelection 唤醒输入等待；AIPlayer 原版另有直接选招路径。
- Turn：建上下文并触发 BeforeSort；换宠先于技能，技能依优先级/速度，平局保留顺序；TurnStart → 各动作及印记清理 → TurnEnd 效果 → 双方回合怒气 → 活跃精灵/战场印记更新 → 清理 → TurnEnd 消息。
- Skill：更新连续使用记录与可见性；BeforeUseSkillCheck 后刷新当前目标；可用/阵亡/怒气检查；消耗怒气；AfterUseSkillCheck；命中/多段/暴击；BeforeMultiHit；每段 BeforeHit、伤害、OnHit 或 OnMiss；命中奖励 15 怒气；阵亡/击杀奖励；finally 清印记及 SkillUseEnd 消息。
- Damage：类别与攻防、等级、属性克制、STAB、暴击、0.85–1 浮动；伤害上下文百分比/固定修正及阈值；OnBeforeCalculateDamage → Shield/逐盾消耗 → HP → OnDamage → 消息 → PostDamage/OnCritPostDamage → 存活标记。Heal 与 Rage 各有真实阶段和前后触发。
- Effect：真实 Effect 保存函数/条件/优先级/消耗层数；遍历战场、双方所有队员印记与技能，按来源+效果去重、优先级排序，BeforeEffect/AfterEffect 嵌套触发并捕捉错误。没有把函数替换为简化 effect opcode。
- Mark：互斥组；叠层/刷新/延长/最大/替换/移除/none；能力阶段标记和 RxJS computed modifier；持续/到期/销毁触发；护盾；下场保留、转移；销毁清理来源修饰及变身。inheritOnFaint 字段保留，但历史实现未见独立派发逻辑。
- Switch：OnSwitchOut → 印记下场处理 → 更新 active → 消息 → OnSwitchIn/OnOwnerSwitchIn → floor(rage*0.8)。强制换宠和击破奖励同时收集，双方都倒下时无击破奖励；全队倒下结算（可平局）。
- AttributeSystem：BehaviorSubject/Observable、computed、排序修饰器、percent/delta/override/clamp、来源与阶段绑定、循环依赖回退、注册表及清理。ConfigSystem：全局模板复制、作用域链、标签、修饰器、阶段栈及类型绑定。
- Transformation：Pet/Skill/Mark 三策略，临时优先级栈、同来源替换、永久策略、保留/覆盖效果、HP 比例、来源销毁后恢复。全部保留。
- Timer：玩家回合/总时间、动画追踪与暂停、快照和 mitt 事件、超时自动选择/判负；浏览器标准定时器，无 Node 服务要求。默认按原版配置，headless 实测明确禁用计时。

## 内外依赖

所有相对 import/export 与两处 dynamic import 均在 42 文件闭包内，无遗失内部文件；完整边列表见 `v1-import-graph.json`。
运行外依赖：`@arcadia-eternity/const`（现有同值枚举/数据类型，差异由兼容修改处理）、`rxjs`/`rxjs/operators`、`prando`、`mitt`、`nanoid`、`jsondiffpatch`。这些依赖已在 battle package 声明。本内核不 import parser、effectBuilder、dataRepository、engine、Redis、数据库、DOM、FS 或服务端。
历史 DSL 在仓库其他包中构建 Effect，是内容输入边界而非 Battle 的缺失内部依赖；本阶段保留 Effect 函数接口和全部执行机制。官方 DSL 加载器与全量官方内容兼容需要单独验证，不把几个原生 Effect 样例当作官方目录等价证明。后续移植的额外历史文件单列来源映射。

## 文件清单

| V1 路径 | 移植 | 新路径 | 修改 |
| --- | --- | --- | --- |
| `packages/battle/src/attributeSystem.ts` | 是 | `packages/battle/src/v4/attributeSystem.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/battle.ts` | 是 | `packages/battle/src/v4/battle.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/config.ts` | 是 | `packages/battle/src/v4/config.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/context.ts` | 是 | `packages/battle/src/v4/context.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/effect.ts` | 是 | `packages/battle/src/v4/effect.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/entity.ts` | 是 | `packages/battle/src/v4/entity.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/index.ts` | 是 | `packages/battle/src/v4/index.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/logger.ts` | 是 | `packages/battle/src/v4/logger.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/mark.ts` | 是 | `packages/battle/src/v4/mark.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/pet.ts` | 是 | `packages/battle/src/v4/pet.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/AddMarkPhase.ts` | 是 | `packages/battle/src/v4/phase/AddMarkPhase.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/MarkCleanupPhase.ts` | 是 | `packages/battle/src/v4/phase/MarkCleanupPhase.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/MarkStackPhase.ts` | 是 | `packages/battle/src/v4/phase/MarkStackPhase.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/MarkSwitchOutPhase.ts` | 是 | `packages/battle/src/v4/phase/MarkSwitchOutPhase.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/MarkTransferPhase.ts` | 是 | `packages/battle/src/v4/phase/MarkTransferPhase.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/MarkUpdatePhase.ts` | 是 | `packages/battle/src/v4/phase/MarkUpdatePhase.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/RemoveMarkPhase.ts` | 是 | `packages/battle/src/v4/phase/RemoveMarkPhase.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/base.ts` | 是 | `packages/battle/src/v4/phase/base.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/battleLoop.ts` | 是 | `packages/battle/src/v4/phase/battleLoop.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/battleStart.ts` | 是 | `packages/battle/src/v4/phase/battleStart.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/battleSwitch.ts` | 是 | `packages/battle/src/v4/phase/battleSwitch.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/damage.ts` | 是 | `packages/battle/src/v4/phase/damage.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/effect.ts` | 是 | `packages/battle/src/v4/phase/effect.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/effectExecution.ts` | 是 | `packages/battle/src/v4/phase/effectExecution.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/heal.ts` | 是 | `packages/battle/src/v4/phase/heal.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/index.ts` | 是 | `packages/battle/src/v4/phase/index.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/manager.ts` | 是 | `packages/battle/src/v4/phase/manager.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/mark.ts` | 是 | `packages/battle/src/v4/phase/mark.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/rage.ts` | 是 | `packages/battle/src/v4/phase/rage.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/selection.ts` | 是 | `packages/battle/src/v4/phase/selection.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/skill.ts` | 是 | `packages/battle/src/v4/phase/skill.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/switch.ts` | 是 | `packages/battle/src/v4/phase/switch.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/transform.ts` | 是 | `packages/battle/src/v4/phase/transform.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/phase/turn.ts` | 是 | `packages/battle/src/v4/phase/turn.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/player.ts` | 是 | `packages/battle/src/v4/player.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/skill.ts` | 是 | `packages/battle/src/v4/skill.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/timer/animationTracker.ts` | 是 | `packages/battle/src/v4/timer/animationTracker.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/timer/battleTimer.ts` | 是 | `packages/battle/src/v4/timer/battleTimer.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/timer/index.ts` | 是 | `packages/battle/src/v4/timer/index.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/timer/timerManager.ts` | 是 | `packages/battle/src/v4/timer/timerManager.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/transformation.ts` | 是 | `packages/battle/src/v4/transformation.ts` | 原样导入；兼容修改另记 |
| `packages/battle/src/transformationStrategies.ts` | 是 | `packages/battle/src/v4/transformationStrategies.ts` | 原样导入；兼容修改另记 |

无核心源文件被排除。历史包的 rollup/tsconfig/package 由当前 monorepo 配置承接；不恢复旧构建链。额外兼容变更及验证结论见 `direct-v1-port.md`。
