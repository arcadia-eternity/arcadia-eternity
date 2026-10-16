# Direct V1 port — preserve first

关联 #200、#202、#203、#204。本 PR 不关闭这些 Issue。

来源与完整依赖审计见 [V1 Port Inventory](./v1-port-inventory.md)。原始导入提交 `7c70415f` 的 42 个文件与历史源文件逐字节一致；`58b85316` 另导入原版 EffectBuilder、DSL 解析器及内容仓库。后续补齐其 schema/parser 闭包和历史 YAML，映射在 `v1-extra-source-map.json`。不合并 #227/#228 的替代内核，不覆盖其工作分支。

## 兼容修改（业务现代化另记）

- core/context.ts：当前 const 比 V1 多 5 个触发器。保留 V1 精确映射，为新增 enum 项提供 AllContext 类型回退以便构建；没有新增触发派发，不能视为支持 V2 新触发器。
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

最终验证命令、结果及 RNG/ActionLog/Replay 实际范围在完成测试后补入本文件。
