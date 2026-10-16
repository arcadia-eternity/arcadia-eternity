# Battle Core：领域模型、宿主边界与确定性（#202–#204）

> 首版架构验收已因用户复核撤回；PR #228 保持草稿，#202–#204 保持打开。当前按 [V1 契约盘点](v1-contract-inventory.md) 修正实体基类型、Context 泛型和具体 Phase。历史测试记录不是架构完整性的证明。

## 起点与范围

基线是 `origin/refactor/v4` 的 `2fcb8640e276b93bffa76aeb648aecd9e7712675`（#226 / #201 已合并，headless CI 成功）；`main` 为 `1492b2ca`。没有使用已撤回的 #227，没有修改 V2 的生产实现或原有 golden。历史参考为 `c086289812885e7a4903b181e2b8989e201452b8` 的 `battle.ts`、`player.ts`、`pet.ts`、`skill.ts`、`mark.ts`、`context.ts` 与 `phase/*`。

新的公开入口为 `@arcadia-eternity/battle/core`。旧入口及 `/node` 继续使用 V2。此轮提供可完成战斗的 Core 垂直切片；不是全部官方效果已迁移，也不是旧 CLI/Web/Server 已切换到 Core。

## 使用与三个边界

```ts
import { createBattle, restoreBattle, replayBattle, EffectRegistry } from '@arcadia-eternity/battle/core'

const registry = new EffectRegistry(trustedEffects) // 应用自带的可信 TS 代码
const battle = createBattle({ id: 'local', seed: 'example', players: [alice, bob] }, content, registry)
const stop = battle.events(event => host.render(event))
battle.start()
const action = battle.getAvailableActions(alice.id)[0]
battle.submitAction(action)
const save = JSON.stringify(battle.snapshot())
const restored = restoreBattle(JSON.parse(save), content, registry)
stop()
```

- **Content**：种族定义、技能原型、印记原型、效果引用（`id/version/params`），以及玩家提供的养成/队伍数据。Core 接收已经载入的普通数据，不读 YAML/文件/URL，不解释运行时 DSL。
- **Core**：`Battle` 持有玩家、实例、阶段、RNG、日志和状态。只依赖 `@arcadia-eternity/const` 的赛尔号2枚举、常量、性格表及属性克制表；没有 World、ECS、规则/排名、账号、网络、计时器、DOM 或服务。
- **Host**：文件、IndexedDB、UI、AI/人工决策的等待、时限、连线、鉴权和可信效果注册。玩家 ID 是 battle seat 的标识，不是认证凭证。`getState` / snapshot 是完整权威状态；不要直接广播给对手，视角裁剪属于后续宿主适配。

操作同步执行到可交互边界；异步宿主先 `await` 其输入来源，再调用 Core，也可 `await battle.submitAction(...)`（返回值立即可用）。Core 内没有等待 Promise、定时器或全局时间。可信回调必须同步、无外部副作用，只使用 `battle.random()` 获取规则随机数；非 void 返回会中止并回滚本次操作。

事件按序在操作提交后交付给订阅者。订阅者异常单独由 `takeObserverErrors()` 获取，不撤销规则结果；订阅期间禁止重入操作。事件、状态、快照均返回数据副本。事件日志带递增 sequence/turn，不写时间戳；`getEvents(afterSequence)` 可用于宿主重连补发。

## 领域对象与生命周期

| 对象   | 状态所有权及职责                                                                                                                  | V1/V2 对照                                                                                  |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Battle | 两个席位、战斗级印记、回合、胜负、阶段、动作日志与事件                                                                            | V1 Battle；取代 World/orchestrator 作为规则状态所有者                                       |
| Player | 名字/席位 ID、队伍、当前精灵、共享怒气和上限；可选动作                                                                            | V1 Player；没有把 UID/Account/席位权限混为一体                                              |
| Pet    | 原始与当前 Species、等级、EV/IV/性格/性别/尺寸、HP、出场可见性、特性/纹章、技能实例、印记、最近技能/连续次数/历史                 | V1 Pet + V2 的有界技能历史；养成 build 和临时状态分开                                       |
| Skill  | 稳定实例 ID、原型、owner、威力/命中/怒气/优先度/是否已出现；类别、属性、目标、连击、必中/必暴、穿盾、忽略对手阶段、标签、效果引用 | V1 BaseSkill/SkillInstance；原型内容被冻结，实例值独立                                      |
| Mark   | 原型、稳定实例 ID、owner、创建者、层数、时长、激活和配置；叠层/消耗/销毁/转移/换宠继承                                            | V1 BaseMark/MarkInstance；能力等级以特殊印记表达，移除印记即移除数值效果，不留残余 modifier |
| Phase  | `BattlePhaseBase<TContext,TResult>`、具体结算 Phase 和 PhaseManager 的嵌套执行栈及生命周期                                        | 运行时 context 保留父链；`BattleContinuation` 单独承载存档 DTO                              |

种族保留原始编号、属性、基础种族值、性别比例、体型范围、特性/纹章候选和学习表；原型可带 asset/sfx/icon 引用，资源加载归宿主。可手动覆盖 HP 用于 #201 的机制样例，不引入排位配队校验。

阶段为 `created → selection → turn-start → action → turn-end → (switch 或 selection) → ended`。换宠先于技能，技能按优先度/速度排列，同速保持席位顺序。技能执行时重新取对手场上目标。倒下的行动者不能继续技能；双方回合怒气在阵亡换宠之前结算。强制换宠只接受存活后备；击杀方可选奖励换宠或放弃；双倒不授予奖励；双方全倒为平局；全队倒下或投降结束战斗。

印记覆盖添加/同种叠层策略/互斥、永久与有限时长、离场保留/销毁/转移、阵亡继承、护盾统一消耗路径和销毁回调。能力等级上下限 ±6；等级印记保留在离场精灵上。只对场上精灵及 battle 印记触发常规回合效果，后备持续时间暂停。

属性和配置修改使用宿主无关的类型化系统，保留动态依赖及生命周期；没有恢复旧的全局注册表、RxJS 订阅、消息差分、timer/animation 或 AIPlayer。Species/Skill/Mark 的变身与撤销、来源生命周期和动态属性已实现，具体契约见 [config-and-modifiers.md](config-and-modifiers.md)。

## #205 / #223 扩展接缝

`EffectReference = { id, version, params }` 只含 JSON。宿主提供 `EffectRegistry`，按稳定 ID 和代码版本解析可信回调，构造与恢复时缺失或版本错误直接失败。回调接收赛尔号2的 discriminated context（skill/damage/rage/heal/stage/mark/switch/turn）及来源 Skill/Mark；上下文只活在原子操作中，不进入快照。

当前 seam 发出相应规则触发点，收集当前技能/场上印记，按优先度调用同步回调；有销毁后不再运行已收集印记的检查。它**不宣称完成 #205 的全部效果语义或 #223 的参数 schema/模板目录**。没有执行不可信脚本或动态 import，也不提供可执行 DSL。正式 Effect/EffectTemplate 可以替换注册/分发实现，保持 `id/version/params` 引用和快照边界。

`test/core/trusted201.ts` 仅有 #201 四个技能和一个印记所需的少量可信测试回调。数据从官方 species/skill/mark YAML 的对应条目适配；没有读取/解释官方 effect YAML，没有大规模迁移。这些回调不从产品 `/core` 导出。

## 快照、恢复与重放

`BattleSnapshot.version = 1` 包含初始配置、完整领域状态、阶段队列、最后击杀者、RNG 四字状态、下一印记 ID、动作与事件日志。引用用 ID 重新连接，回调来自外部注册表。输入复制时拒绝函数、循环、非有限数字、BigInt、Date/Map/Set 等宿主对象。

RNG 使用从 V2 移植的 sfc32 四字状态与 seed hash/warmup，不导入 engine；seed 必填，不回退到真实时间。实例 ID 由 build/槽位与 battle 内递增计数器产生，不消耗规则 RNG。

恢复直接重建对象图并恢复 RNG/continuation，不重放历史动作，也不会重复运行 OnBattleStart。校验版本、内容 identity、对象/owner 引用、队伍、技能、层数/阶段、日志序号和 continuation，再检查重新导出的快照一致。内容 identity 是完整规范化 JSON 字符串，不是安全摘要或 #224 的环境 hash；可信代码版本通过引用约定冻结，应用不能在同一版本下偷偷替换实现。

`submitAction(action, false)` 仅登记输入，`advance()` 每次推进一个原子阶段/行动；可在只收到一方输入、排序后、第一行动后/第二行动前、击杀后/TurnEnd 前、强制/奖励换宠等待时存档。不能在一个可信函数执行到一半保存 JavaScript 栈，`snapshot()` 会明确拒绝操作内部调用。重连宿主保存最近提交边界及 pending actions，依靠自己的席位授权/输入序号防重复；Core 不实现网络协议。

`exportReplay()` 用于 decision/ended 边界；中途 continuation 使用 snapshot。`replayBattle` 按 ActionLog 顺序从初态运行，校验每项序号/回合/阶段、动作合法性以及全部事件与最终状态。fixture 为 `test/core/fixtures/official-switch.replay.json`（纯数据 Content + Replay，CLI 或测试可消费）；真实 CLI 命令接入仍属 #207。

可信回调抛错会回滚本次操作的领域状态、RNG、ID、队列和日志。无法回滚可信代码对外部变量/IO 的副作用，因此这些不属于合法规则回调；注册表不是沙箱。

## #201 对照与新增的 V1/V2 差异

原 V2 golden 保留不动并继续运行。新 Core 运行**同一官方队伍/seed/全部 16 次显式决策**，同样第 7 回合 A 胜。测试同时对比原基线的动作/换宠/技能失败/击杀/结局事件顺序，并完整对照独立 Core golden 的每个事件和最终状态。不是将新实现简单称为 V2 等价。

| 差异                   | 依据与 Core 行为                                                                                                                             | 样例结果                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| #201-01 换宠取整       | V1 `phase/switch.ts`：floor(rage × .8)                                                                                                       | 专项测试 21 → 16                                                           |
| #201-02 目标刷新       | V1 `phase/skill.ts`：执行前 updateActualTarget                                                                                               | 主动换宠后，攻击命中新上场者                                               |
| #201-03 阵亡回合怒气   | V1 `phase/turn.ts` addTurnRage 不过滤死亡精灵                                                                                                | 阵亡后、换宠前仍有怒气事件                                                 |
| 新发现：伤害波动重复   | V1 `context.ts` 的 UseSkillContext 保留未乘波动的 baseDamage，DamageContext 应用一次；V2 `skill.handler.ts` 先乘一次，plugin-damage 再乘一次 | Core 拍打伤害 27/14/23/18；V2 25/13/19/17；最终 A HP 269/259（V2 272/264） |
| 新发现：后备印记倒计时 | V1 `phase/turn.ts` updateTurnMark 只枚举场上精灵；V2 枚举全 world 印记                                                                       | Core 浑浊水域离场后保持 3 回合；V2 在第 5 回合删除                         |

伤害公式保留 V2 使用**攻击者等级**的改进，避免盲目搬回 V1 `context.ts` 使用受击者等级的问题；基础伤害及属性/暴击乘区按 V1 分层取整。忽略阶段只作用于对手防御，负阶段采用 V1 表；不把 V2 的双重随机误差固定为规范。未执行完整历史 V1 构建，因此这里是源码依据 + 可执行 Core/V2 差异证据，不声称所有历史行为等价。

## 验证命令

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm --filter @arcadia-eternity/battle... --filter @arcadia-eternity/pack-loader... run build
pnpm test:battle-baseline
pnpm typecheck:battle-baseline
pnpm typecheck:battle-core
pnpm lint:battle-core
pnpm test:battle-core
pnpm verify:battle-core-hosts --browser
```

Core 的单独 typecheck 使用 ES2022 lib、空 types，不能引用 Node/DOM 全局。测试另有严格 typecheck 和显式 lint（默认根 lint 忽略 test）。host 验证通过包的真实 `/core` export 分别打包 Browser/Node，检查整个运行时模块图，拒绝 engine/宿主/外部依赖；在 Node 和真正 Chrome 中执行同一 fixture 的完整回放和 JSON 恢复并比对结果。Chrome 路径可用 `BATTLE_CORE_CHROME` 指定。CI 扩展了 #201 的工作流，不添加任何服务。

执行结果见本 PR 的验收记录。根 build/typecheck 的旧服务问题独立记录，不以 Core 的专项成功替代全仓成功。

## 尚未覆盖

- 全量官方内容、所有触发器组合、复杂连锁击杀/强制技能换宠、全量官方变身/属性效果目录没有迁移验收；基础变身/撤销及配置/属性 modifier 已补回，正式 Effect 流程和模板校验属 #205/#206/#223。
- 新增 Browser 是核心包运行验证，没有 Web UI、本地 AI 产品流程或 Electron 安装版；这些属于 #207–#209。
- 保存点是规则原子边界，不支持可信函数栈内部存档；网络重连的鉴权/隐私/去重由宿主负责。
- 没有引入 Redis、用户数据库、规则系统、排位或服务依赖。

## 首版验证记录（架构验收已撤回，2026-10-16）

- 新 Core：3 文件、35 项测试通过；Core 无宿主 types 的类型检查、测试严格类型检查、源码/测试专项 lint 通过。
- 旧 V2：19 文件、108 项通过、3 项明确预期失败，原 #201 golden/known-defects 未修改；基线专项类型检查与 lint 通过。
- `pnpm build` 完整通过：全仓 lint、各包构建、根 typecheck、CLI 构建均执行成功。本轮没有再遇到 #201 文档所述的旧类型检查问题，不将那份旧记录当作当前失败。
- `pnpm test:run` 实际执行：engine 4、schema 14（另 6 skipped）、client 3、V2 battle 108（另 3 expected fail）通过；随后 P2P 12 通过、3 失败，错误为 `runInMemoryP2PBattleE2E is not a function`。在 #201 的原工作目录独立复现了相同三项失败；P2P 文件相对基线无差异，未为通过测试扩大修改范围。递归命令在此停止，不能声称剩余所有宿主测试通过。
- Node 与真实 Chrome 执行公开 `/core` 的完整 fixture 回放与 JSON 恢复：均为 7 回合、A 获胜、357 条事件、恢复状态完全一致；Browser/Node 运行时模块图各 5 个节点，仅核心、const 和测试输入，没有 engine 或宿主依赖。
- PR #228 面向 `refactor/v4`，提交从 #201 的合并提交派生；`main` 保持 `1492b2cae49a65d88c7132047132c85d0d06bff1`。

### Standards

独立审查未发现仓库规范硬违规，也没有需要阻塞的代码气味。发现两个运行时问题：构建数据可变导致抛错后 EV 逃逸回滚；全部输入已提交但未推进的状态仍可导出无法重放的 fixture。已分别冻结 build/队伍/技能数组，并将 replay export 限定为真正等待输入或结束的边界；添加回归后复核通过。

### Spec

独立审查确认领域对象、官方 #201 队伍与宿主边界符合本轮范围，没有范围扩张。发现 replay 导出边界问题（与 Standards 同一问题）和 `StackStrategy.remove` 绕过印记销毁回调/事件的问题；后者已统一经过 `removeMark`，回归确认销毁回调及移除事件各一次。审查者独立复跑相关测试并确认修复。

汇总：Standards 2 项、Spec 2 项（其中 replay 为重复发现），3 个独立问题均已修复；两个轴均无剩余阻塞项。

## 用户复核后的类型与 Phase 修正

- `entity.ts` 恢复 `Prototype<TId>`、`Instance<TPrototype,TId>`、`OwnedEntity<TOwner>`、`MarkOwner`、`EffectContainer`。Species/Skill/Mark 原型与 Pet/Skill/Mark 实例使用原 const 中的品牌 ID；宿主 Definition/build 输入继续接收可移植字符串，由内容及实例创建边界校验归一。
- `Battle extends Context<null>`；`TurnContext.parent` 是 Battle，`UseSkillContext.parent` 是 TurnContext，`DamageContext.parent` 是技能或效果上下文。添加/移除/叠层/消耗/转移/换宠/治疗/怒气各有自己的类和父类型。`EffectContext<T>.parent` 与 `effect` 随 `TriggerContextMap[T]`/`TrustedEffect<T>` 绑定；`defineEffect` 让回调直接获得具体上下文。
- `phase/` 包含实际执行规则的 BattleStart/BattleLoop/Selection/BattleSwitch/Turn（Start/Action/End）/Skill/SwitchPet/Damage/Heal/Rage/AddMark/RemoveMark/MarkStack/ConsumeStack/MarkSwitchOut/MarkTransfer/MarkUpdate/MarkCleanup/EffectExecution/Effect Phase。规则体已移出 Battle，Battle 保留状态、公开入口及存档校验。
- PhaseManager 提供确定性 ID、父 Phase ID、执行栈、状态和清理；同步与交互 Phase 区分，输入不足进入 Waiting。快照只写 Phase trace/counter、continuation 和 TurnContext 的普通数据，恢复时重新建立类与父链，不序列化运行时 context 对象。
- `type-contracts.ts` 有 13 个编译反例，确保错误的父 context、触发器、Phase/Context、实体 owner、prototype、品牌 ID 和变身 prototype 组合不能编译。运行测试检查真实嵌套 Phase、父链、跨行动保存的 TurnContext 数据以及失败回滚后的栈。
- 能力等级添加现在仅走一次 AddMarkContext/OnBeforeAddMark，去掉首版 stage helper 重复发出的两次触发；原官方场景仍是 7 回合及相同伤害/最终状态，Core golden 按这个明确差异从 357 调整为 355 条事件。原 V2 golden 不变。
- `TransformContext<TTarget>` 保留 target→prototype 类型关系；完整变身与恢复/撤销运行机制尚未实现，不能将类型声明当作 TransformPhase 已完成。正式 Effect/EffectTemplate 系统、属性 modifier/变身策略仍需随 #205/#223 明确，不迁移官方 DSL。

当前以新增架构证据为基础重新复核；历史 Standards/Spec 的“无剩余问题”不再作为本次架构完整性结论。

### 修正后的复核记录

独立审查对照 V1 后发现并修复：效果泛型推断可被不匹配的 handler 扩宽；BeforeSort 更换的 skill/selectTarget 在 continuation 中丢失；印记覆盖 maxStacks 后创建及恢复仍按原型上限夹取；typed context 的实体可能来自另一场 Battle。对应加入 handler 编译反例、重建前后技能/目标一致、双向 maxStacks 覆盖及跨战斗 damage/heal/rage/remove 隔离回归。

当前 4 文件、51 项运行测试通过，13 个编译反例均有效，Core/test 严格类型检查与专项 lint 通过。BeforeEffect/AfterEffect 已在 EffectPhase 中执行，meta hook 不递归包装自身，并可影响目标 EffectContext.available；新增实际顺序测试。Core 完整 golden 由 355 增至 379 条事件，新增 24 条 meta trigger，更新时独立校验全部非 trigger 事件、ActionLog 和最终状态完全不变。

最后一次 Spec 复核还发现 setSkill 未随替换技能更新默认目标，已修复并加入对手→自身→对手及显式重定向测试。复核者独立跑过相关测试，当前限定范围未发现其他阻塞问题。

修正后的全仓 `pnpm build` 通过（lint、各包、根 typecheck、CLI）；最后的目标修复后重新构建 battle 包并执行根 typecheck，通过。公开 `/core` 在 Node 和真实 Chrome 中分别执行完整 fixture 回放及 JSON 恢复，均为 7 回合、A 胜、379 条事件，恢复结果及跨宿主结果完全一致；运行时模块图各 5 个节点，没有 engine 或宿主依赖。全仓测试的三个 P2P 既有失败仍按上文单独记录，不宣称全仓测试全绿。

仍未实现的触发语义明确包括 AfterAttacked 和完整 Transform 生命周期；不能因 TriggerContextMap 有类型声明就认为这些运行机制已完成。完整 Effect/EffectTemplate、变身/撤销策略和动态属性 modifier 仍待 #205/#223 等后续任务，未宣称本轮完成。

## 最新补齐：变身、ConfigValue 与 modifier

用户要求补齐后，已加入实际 Transform/TransformEnd Phase 和临时/永久变身分层，支持 Pet/Skill/Mark、效果保留/覆盖、原生印记管理、来源销毁/到期、当前 HP 比例转换和 JSON 恢复/动作重放。ConfigSystem、AttributeSystem<T>、Modifier<T> 已接回实体实际 getter；支持类型化操作、动态属性/配置引用、版本化可信计算和来源/阶段清理。完整契约、与 V1 的修正及计算边界见 [config-and-modifiers.md](config-and-modifiers.md)。

AfterAttacked 在当前官方效果目录及 V2 没有使用，指定 V1 提交也只有声明，依用户要求搁置。没有新增派发，原官方 Core golden 仍为 379 条事件。前面“尚未实现 Transform/modifier”的复核记录是历史版本状态。

最新专项回归为 6 文件、114 项运行测试、25 个有效编译反例，Core/test 严格类型检查与专项 lint 均通过。独立复核发现的印记所有权、原生来源覆盖、有效资源写回、配置循环以及资源上限/恢复一致性问题均有对应修复和回归。全仓 build 在 `c58d9b42` 通过；Node/真实 Chrome 同时完成原官方战斗与带动态配置/modifier 的变身、来源到期、恢复/重放场景。最新上限修复另执行 battle 构建及根类型检查。

全仓测试以 `pnpm test:run --maxWorkers=2` 执行：engine 4、schema 14（6 skipped）、client 3、原 V2 battle 108（3 expected fail）通过，随后仍为原有 P2P 12 通过/3 失败（`runInMemoryP2PBattleE2E is not a function`）。首次与构建并行时另遇 V2 loader 5 秒超时，串行复跑后消失，没有修改该测试或延长其超时。
