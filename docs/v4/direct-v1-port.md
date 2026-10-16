# Direct V1 port — preserve first

关联 #200、#202、#203、#204。本 PR 不关闭这些 Issue。

来源与完整依赖审计见 [V1 Port Inventory](./v1-port-inventory.md)。原始导入提交 `7c70415f` 的 42 个文件与历史源文件逐字节一致；`58b85316` 另导入原版 EffectBuilder、DSL 解析器及内容仓库。后续补齐其 schema/parser 闭包和历史 YAML，映射在 `v1-extra-source-map.json`。不合并 #227/#228 的替代内核，不覆盖其工作分支。

## 兼容修改（业务现代化另记）

- context.ts：当前 const 比 V1 多 5 个触发器。保留 V1 精确映射，为新增 enum 项提供 AllContext 类型回退以便构建；没有新增触发派发，不能视为支持 V2 新触发器。
- phase/RemoveMarkPhase.ts：在原销毁消息添加当前 const 要求的 baseMarkId，未改销毁顺序。
- skill.ts：把匿名 Builder 原封移为具名 BaseSkillBuilder，静态 BaseSkill.Builder 仍指向同一实现，解决 TS4094 声明生成失败。
- timer/timerManager.ts：对当前 const 已改为 unknown 的 TimerEvent.data 补充结构断言，未改计时逻辑。
- legacy/**：只修复 import 指向同一套真实 V1 对象，JSON import assertion 改为 with，浏览器中为 process.env 检查加存在性保护；GetValueFromSource 递归元素增加类型断言。SelectionParser 对 V2 新团队选择动作继续落到原不支持错误分支，去除已不成立的 never 断言。
- 历史 DSL schema 保留 Zod 3；显式增加 zod@3.25.76 与 zod-validation-error@3.5.4。没有迁移到当前 V2 DSL，不重写官方效果。
- 当前 Rolldown/TS monorepo 增加 v4、v4/legacy 两个独立子入口及构建配置。保留默认 V2 入口及其测试。
- ESLint：仅对历史导入目录保留旧语法（any、旧空接口、未使用成员、旧 catch 等）的明确规则豁免；不以大规模改写历史文件消除风格告警。新测试和适配代码单独执行严格 lint，typecheck 检查全部历史及新增代码。

## 第一里程碑证据

真实 `Battle.startBattle()` 运行原版 BattleStart/BattleLoop/Switch/Selection/Turn/Skill/Effect/Damage/Mark/Rage 等阶段。检查所有 PhaseState.Failed、错误消息和 EffectApplyFail，不把 swallowed error 当通过。

- 自定义机制场景：4 回合 2v2 完整结算，技能与怒气、能力变化、RxJS 来源修饰、印记创建/持续/到期/销毁、主动换宠、强制换宠、击破奖励、阵亡胜负均有断言。
- 原版全部历史 YAML：666 Effect、280 Mark、576 Skill、91 Species 经原版 schema/parser 加载，无加载错误。这仅证明加载兼容，不证明每个效果完整实战覆盖。
- #201 队伍与 16 个显式动作：原版 V1 运行 7 回合 A 胜，实际调用原版 DSL 的浑浊水域与气力，未重写官方 Effect。两个显式测试适配：历史 V1 无幻璃，使用当前官方幻璃种族定义经原版 SpeciesParser 输入（无特性/纹章）；V1 PetParser/Pet 忽略 maxHp，测试直接写入 #201 配置的 maxHp/currentHp。迪兰保留 V1 默认特性；Prando 使用数值种子 201，不能直接对比 V2 sfc32 的逐次随机数。
- #201 三处已确认语义差异在真实 V1 有普通通过断言：换宠怒气 floor、行动时更新实际目标、首发阵亡后仍获得回合怒气。V2 的三个 test.fails 原样保留。

## 已确认/疑似历史缺口，不作为新规范

以下代码保留，不以这些历史缺陷定义 4.0 规则：

- maxHp 参数/Parser 性别输入未传递或未使用（代码审计及显式 HP 测试适配）；原版 Builder 的默认 multihit=0、accuracy=1 也需后续确认设计。
- Pet.damage 与 Phase 创建了新的 DamageContext，调用者的 damageResult 没回填，技能受击怒气使用旧上下文结果；需独立修复，不伪称测试中所有怒气已符合预期设计。
- StatLevel 符号反转替换路径 detach 后再读 owner；阶段管理器可能把该错误转为失败结果。应独立补回归并修复。
- Phase.addConfigModifier 和 AttributeSystem getter 仍可使用全局 ConfigSystem；Next scope 仍是历史 TODO；动态 phase 通知异步且基于 Date.now，不能声明跨 Battle 完全隔离或阶段绑定全正确。
- transformation 的原始 HP 比例恢复、Override 特性清理、异步策略异常传播，以及阶段重试/错误传播/等待时取消，需进一步审计和专项测试。
- AfterAttacked、OnTransform 等存在定义但未必有完整派发；inheritOnFaint 只有字段，未确认实现。V2 后加的 SkillUseEnd/consume-stack/before-rage 触发器不在此历史内核实现。

## 状态盘点与 #204 边界

| 运行状态 | 快照必须保存/重建的内容 | 当前限制 |
| --- | --- | --- |
| Battle | 状态、回合/阶段、胜者/lastKiller、强制/击破奖励/初始换宠状态、sequence、状态差分基线、pet/skill 映射 | getState 是消息视图，不是恢复快照 |
| Player | 选择、队伍顺序、active、基础/有效怒气及上限、来源修饰 | owner/emitter/回调需重建 |
| Pet | 原始/当前种族、全部构建属性、HP基础/有效值、alive、appeared、连续技能记录、全部技能/印记 | 不能只存出战者或有效属性 |
| Skill | base、覆盖字段、效果引用、owner、可见性、属性基础值及修饰 | 随机实例 ID 与内容/效果稳定身份需区分 |
| Mark | base/subclass、owner、stack/duration/active、config/tags、能力等级、效果和清理绑定 | StatLevel 有额外 AttributeSystem、computed Observable |
| Modifier/Config | 基础值、排序/来源/作用域、标签、阶段绑定、动态依赖及配置模板 | BehaviorSubject、Observable、cleanup 函数不能 JSON 化；需显式表达式/注册表 |
| Phase/Context | 嵌套栈、等待点、排序后队列、技能命中/暴击/多段/目标/伤害、父引用与阶段状态 | Promise、resolver、WeakMap、异常和调用栈不能 JSON 化 |
| Transform | 全部临时/永久记录、优先级、来源、原型/效果策略、HP比率 | 原型与函数应稳定引用，不能序列化函数 |
| Host | Timer/animation 状态、消息监听、AI决策、真实时间 | 需要宿主时钟/输入事件契约 |

不提供部分 Pet/Skill/Mark 快照冒充完整恢复。当前没有 BattleSnapshot、restore 或中途恢复；不复用 #228 的缩水状态表示。下一步在本清单上设计完整快照协议与等待点恢复，并为动态 RxJS/任意函数明确可恢复能力边界。



## 已验证后才加入的最小现代化

- `createBattle(Player, Player, options?, ConfigSystem?)` 只调用原版 Battle 构造器；`startBattle / setSelection / getAvailableSelection / getState / registerListener / unregisterListener / cleanup` 仍是原版接口。示例及实际运行见 test/v4/scenario.ts；Node CLI 验证命令 `node scripts/verify-v1-hosts.mjs` 会构建并运行原版内核，无需服务。
- 可注入 `BattleRng { next, nextInt }`，默认仍是 Prando，保留非零种子的 V1 随机序列；修复种子 0 被当作未提供的问题。洗牌及 AI 选项选择改用该流。这是明确的局部行为修正，单独提交，未改伤害/印记/行动顺序算法。
- `getActionLog()` 返回经 Battle.setSelection 接受的选择、当前回合/阶段及顺序，采用副本隔离。直接 Player.setSelection（包括原版 AI）不在该日志范围内；日志使用本局随机实例 ID，尚非持久重放协议。
- Battle Event 沿用原版有序 BattleMessage/sequenceId 及监听接口，没有替换或删减事件。尚未统一随机 ID/时间戳、真实计时、动态 RxJS 状态和自定义效果闭包；固定种子重跑只对已测试场景归一化后的事件类型/状态/伤害一致。
- **没有实现持久 Replay、BattleSnapshot、restore 或阶段中途恢复**。把同种子与同动作再次执行称为回归重跑，不能据此宣称 #204 验收通过。

使用入口：`@arcadia-eternity/battle/v4`；保留旧 DSL 的可选内容工具入口：`@arcadia-eternity/battle/v4/legacy`。浏览器构建保留原版类名（历史阶段类型识别依赖 constructor.name），不要在未专项验证前开启丢失类名的压缩。

## 验证结果（2026-10-16）

| 命令 | 结果 | 证据 |
| --- | --- | --- |
| `pnpm build` | 通过：全仓 lint、全部 package build、根 typecheck、CLI bundle | [完整构建](./validation/full-build.log) |
| `pnpm test:battle-baseline` | 19 文件；108 通过、3 项既有预期失败，共 111 | [#201/V2 原样回归](./validation/v2-baseline.log) |
| `pnpm test:battle-v4` | 4 文件；24 通过、1 项 V1 历史缺陷预期失败，共 25 | [V1 运行测试](./validation/v1-tests.log) |
| `pnpm typecheck:battle-v4`、`pnpm typecheck:battle-baseline`、`pnpm lint:battle-v4` | 通过；V4 检查包括全部 legacy 源码与测试。原版源码保留上述风格豁免 | [类型和新增代码 lint](./validation/typecheck-lint.log) |
| `pnpm verify:battle-v4-source` | 42 核心文件均来自原 commit；87 个映射文件中 63 字节一致、24 有明确兼容/局部现代化改动；相对依赖闭包通过 | [校验结果](./validation/source-check.json)、[完整差异](./v1-compatibility.patch) |
| `pnpm verify:battle-v4-hosts` | Node + 真实 Chrome 均完成相同 4 回合战斗；完整结果一致；原版气力 DSL 实际把攻击变为 1.5 倍 | [跨宿主结果](./validation/node-browser.log) |
| `pnpm battle:v4-demo` | 无服务 CLI 实跑原版 YAML/DSL 的 7 回合战斗，A 胜；双方各 8 动作 | [CLI 完整状态](./validation/cli-result.json) |
| `pnpm -r --filter './packages/**' --if-present run test:run --maxWorkers=2` | 未通过；在 P2P 3 失败处停止，不能声称全仓 tests 全绿 | [递归测试](./validation/recursive-tests.log) |

V1 唯一预期失败为 **V1-BUG-01**：真实技能已造成伤害，实际玩家怒气仍使用调用者未回填的 DamageContext。准备阶段在 beforeAll 中单独断言伤害实际发生且无失败阶段，不能让准备异常被 test.fails 吞掉。后续应独立修复上下文/伤害结果回传，并把该测试改为普通通过；本轮未把缺陷固化为目标规范。

递归测试已完成：engine 4、schema 14（另跳过 6）、client 3、V2 battle 108+3 expected、P2P 12 通过/3 失败。P2P 的 `test/battleE2e.test.ts` 从 `../node` 导入 `runInMemoryP2PBattleE2E`，但 `node.ts` 只导出 webSocket 模块；相关文件与 `refactor/v4` 的 #201 基线完全相同。本轮不修改 P2P。递归命令在此停止，后面的包不计为已验证。

Node/browser 验证读取公开 package 子入口并检查实际模块图；不包含 engine、engine-plugins、server、database、rules、interface、p2p、web-ui。Node 266、browser 267 模块（含原 RxJS/Zod 等依赖），不以“模块更少”衡量成功。Chrome 校验完整结果与 Node 一致，不只是 bundler 成功。CI 会保存模块图、Node 结果及浏览器 DOM 为 artifact。

## 交付边界与下一阶段

- **已移植**：42/42 Battle 核心源码、全部内部依赖、历史 DSL 运行/解析/校验闭包与只读数据；包括计时器、属性/配置和变身等机制，未因未知机制删除代码。
- **仍未完成**：全部官方效果的逐项实战等价验收、历史缺陷修复、全局 Config/动态 RxJS 隔离、稳定实例/效果身份、完整快照/恢复/持久重放、通用 CLI/Web/Electron/Server 产品接入。上文状态盘点是后续协议设计输入。旧 Rollup/Babel/Node scriptLoader 的宿主工具链没有重建。
- #202：原类公开 API + Node/Browser 实跑已经可用，但完整宿主边界/取消等契约尚待验收；#203：直接移植领域模型已经落实，领域缺陷/机制验收仍待审查；#204：仅完成 RNG 边界与有限 ActionLog，不关闭 Issue。
- 下一阶段先修复已验证的 V1-BUG-01 与 HP 参数问题，补印记反转/变身/阶段配置的专项回归；随后基于真实状态清单设计稳定引用、动态依赖注册及等待点恢复。保留当前 DSL 直到 TS EffectTemplate 有逐项等价证据。

本轮没有替换默认 V2 入口，没有修改 #201 源码/fixtures/预期，没有改动 main，也没有重写或删除 #227/#228 分支。
