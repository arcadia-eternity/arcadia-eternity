# V1 领域契约盘点与本轮修正

参考提交：`c086289812885e7a4903b181e2b8989e201452b8`。用户复核指出首版 PR #228 把 Phase 降为存档标签、Context 降为联合数据、删除实体基契约；该版架构验收撤回，PR 保持草稿，#202–#204 未关闭。

## 应保留的类型关系

- `Prototype` 标识内容原型；`Instance<TPrototype>` 的 base 必须与具体实例匹配；`OwnedEntity<TOwner>` 约束所有者及所有权生命周期。
- `MarkOwner` 提供统一印记操作；`EffectContainer` 将可信效果引用绑定在技能/印记来源上。Player→Battle、Pet→Player、Skill→Pet、Mark→Pet/Battle 关系必须进入声明与类型测试。
- `Context<TParent>` 保留实际父对象。Battle 是根，TurnContext 属于 Battle，UseSkillContext 属于 TurnContext；Damage/Rage/Heal/AddMark/RemoveMark/Stack/Switch/Transform 各有对应父类型和领域字段，不能以任意 Context 替代。
- `TriggerContextMap[TTrigger]` 决定触发点的上下文；`EffectContext<TTrigger>` 的 parent 随 trigger 精确变化。效果回调不应面对一个需要自行猜测的平坦联合。
- `BattlePhaseBase<TContext, TResult>` 的初始化、执行、等待、完成、失败/取消/清理与实际 context 关联。`PhaseManager` 管理执行栈、嵌套关系和确定性 ID；不能以一个 kind 字符串替代所有结算 Phase。

## V1 Phase 职责对应

| 历史模块                                                            | 应由具体 Phase 承担的职责                                                                            |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| battleStart / battleLoop                                            | 初始化效果与主循环推进；只协调，不集中全部技能/印记规则                                              |
| selection / battleSwitch                                            | 双方选招与强制/奖励换宠收集；等待外部输入                                                            |
| turn                                                                | 排序、TurnStart/End、执行行动、回合怒气及印记更新                                                    |
| skill                                                               | 技能检查、目标刷新、命中/暴击/连击、伤害子阶段、击杀与收尾                                           |
| switch                                                              | 离场/上场、印记离场子阶段、怒气取整                                                                  |
| damage / heal / rage                                                | 各自修改量、阈值/可用性、触发点及结果                                                                |
| AddMark / RemoveMark                                                | 添加校验/互斥/实例化与完整销毁生命周期                                                               |
| MarkStack / MarkSwitchOut / MarkTransfer / MarkUpdate / MarkCleanup | 叠层、离场清理、转移、时长到期与失效清理；复用统一入口                                               |
| effect / effectExecution                                            | 带 TriggerContextMap 的可信调用接缝与来源收集；完整效果系统仍属于 #205                               |
| transform                                                           | 具体 Transform/TransformEnd Phase、临时优先级层、永久变更策略、来源清理和快照重建；target→prototype 保持类型关系 |

## 可以调整的实现责任

- 不恢复旧的全局 config、RxJS、日志器、随机 Phase ID、timer/animation、宿主消息及 DSL 解释器。
- InteractivePhase 在输入不足时显式 Waiting，等待由宿主驱动，不将 resolver/Promise 写入快照。
- 存档用独立 continuation DTO，包含确定性计数器/阶段数据；恢复时重新建立类实例和父关系。DTO 不是运行时模型。
- 新增类型反例测试证明错误 owner、prototype、trigger-parent 和 phase-context 组合不能编译；运行测试证明实际结算经过具体 Phase，并保留父链。

此文是修正依据，完成状态以代码、类型反例、运行证据及后续复核为准，不因存在同名类就视为完成。

## 当前实现证据

- 实体契约落在 `src/core/entity.ts`，具体对象实现原型/实例/所有者的泛型关联；runtime ID 使用 const 的品牌类型，内容 Definition 与队伍 build 为纯数据输入。
- Context 父类型和触发器映射落在 `context.ts`；`EffectContext.effect` 与 `EffectPhase.definition` 使用 NoInfer 约束，防止错误 handler 反向推宽 trigger 泛型。
- `phase/` 实际包含各结算职责的实现，`Battle` 不再集中规则体。`continuation.ts` 只承载存档数据，不冒充运行时 Phase。
- 运行测试有 51 项，包括 Phase/Context 真正的父链、TurnContext 数据恢复、BeforeSort 选招/目标连续性、替换技能的默认目标刷新、覆盖印记配置和跨 Battle 隔离。另有 13 个有效编译反例；错误匹配不能编译。
- EffectPhase 已执行 BeforeEffect/AfterEffect 的真实生命周期。变身/撤销及配置/属性 modifier 已补回，契约和验证见 [config-and-modifiers.md](config-and-modifiers.md)。AfterAttacked 未找到官方效果使用，按用户要求搁置；正式 EffectTemplate 仍属后续。

这份状态仍是草稿 PR 的可审查进展；Issues 保持打开，未据此自动宣布完整架构验收。

## 后续用户复核补齐

TransformPhase / TransformEndPhase、分层 TransformationSystem 和原型类型关系已落实；具体支持 Pet/Skill/Mark、临时与永久策略、来源到期/销毁、HP 比例转换、效果保留/覆盖，以及纯 JSON 恢复/重放。ConfigSystem、AttributeSystem<T> 和 Modifier<T> 已重新进入实际实体 getter 和结算，并有来源/阶段清理与动态值重建。此前文档中“未实现 Transform/modifier”的记录仅对应先前版本，不再描述当前代码。
