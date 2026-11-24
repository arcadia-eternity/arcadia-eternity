# 伤害事件与延迟伤害

## 一次命中的生命周期

技能负责使用条件、命中、支付怒气和命中次数。每次伤害走一次 DamagePhase，阶段管理器继续负责作用域与清理。DamageContext 连接当前对象和父事件，为选择器提供求值环境。DamageIntent 记录提案身份、原目标、数值输入、来源和适用规则。DamageContext 为本次提案保存数值项、替代规则和预留层数。DamagePhase 校验并一次提交 HP 与层数，再依次处理支付回调、受伤回怒与击倒。DamageResult 保存可以传输的只读结果。

| 时点                                   | 适合放在这里的规则                          | 作者读取的数据                     |
| -------------------------------------- | ------------------------------------------- | ---------------------------------- |
| OnBeforeCalculateDamage                | 倍率、固定增减、保底和封顶                  | 伤害提案、实时属性、配置和参数     |
| OnDamageReplacement                    | 重定向、伤害转治疗、保留 HP、按条件防止伤害 | 当前结算目标、可支付层数和预计伤害 |
| Shield                                 | 适用于这次伤害的护盾规则与吸收量            | 剩余伤害和可用护盾                 |
| 提交                                   | 写入 HP 和应支付的层数，发布结果            | 最终目标、支付计划和 HP 前值       |
| OnDamage、PostDamage、OnCritPostDamage | 反伤、吸血、附加印记                        | 已提交结果的 hpLoss、来源和轨迹    |
| 状态检查                               | 确认击败、标记击败者并派发 OnDefeat         | 反应后的实时 HP 和已提交事件的归因 |

dealtDamage 记录经过减伤、护盾和保命效果后实际造成的伤害，包含过量部分。战斗消息的 damage 使用该值。hpLoss 仅记录目标实际扣除的 HP，吸血、反伤和受伤回怒按此值计算。反伤和吸血可以依次产生新的事件，每个事件独立提交。父事件的 HP 后值记录它提交时的状态，嵌套治疗或复活有自己的结果。零损血不会触发受伤收益。宿主与全信息监听器收到带 result 的 Damage 或 DamageFail 消息，trace 记录每一步变化，payments 列出实际支付的印记、层数与用途。玩家与受限观战视角只收到公开伤害数据。旧回放仍可读取。

OnDamageReplacement 先选重定向或转治疗，再选部分或全部防止。之后处理护盾，最后处理致命保命。层内按优先级降序，同级按稳定的容器与声明顺序。每次改变目标或剩余量都重新检查条件，已生效的规则 ID 在本次事件内跳过。重定向携带当前剩余量，新目标的替代和防止规则可以接续生效。反应按深度优先同步执行，同一来源效果重复出现在伤害因果链时以 reaction-cycle 终止，Phase 与效果共用宿主执行预算。

ops.cancelDamage() 取消整个提案，释放全部预留。ops.preventDamage() 完全防止伤害，已生效规则的结算成本仍然支付。伤害转治疗时先检查治疗是否允许。成功后，hpAfter 记录治疗后的 HP，hpLoss 为 0。治疗被否决时记录 heal-failed，HP 和结算成本均保持原值。

## 数值、作用域与支付

AttributeSystem 管理持续属性、来源清理和 ReactiveValue 依赖。ConfigSystem 管理类型化的规则配置和 Phase 作用域。它们使用相同的基本数值运算。持续属性按优先级逐项作用，例如两个 +50% 会把 100 提高到 225。一次伤害的百分比在同一层相加，再结算固定增减，所以两个 +50% 将 100 提高到 200。多个下限取最大值，多个上限取最小值，两者冲突时伤害上限优先。选择器和即时 Value 在事件回调中读取，持久 Binding 继续用于跨事件订阅和快照恢复。

发动技能时支付的怒气属于使用成本。「斗战之魂」在命中段的 PreDamage 支付怒气，以本次实际扣除量追加伤害。随后的取消或替代会保留这笔发动成本。消耗印记层数来防止伤害属于结算成本，同一事件中的后续规则只能使用尚可支付的层数。取消和资源失效均须在任何 HP 或层数写入前处理。OnConsumeStack 观察已支付的层数。新的伤害、治疗、印记操作属于提交后的响应。

ops.dealDamage 可为效果发起的定量伤害显式选择 damageType、element 与 policy。skillModifiers、shields、skillReactions 独立控制数值钩子、护盾和技能伤害响应。原始精灵、技能、执行者、持有印记和直接原因分别记录在 origin 与 causeId。UGC 通过沙箱只读投影查询这些信息。数值求值中的 SDK 写操作受当前提案限制，可信进程内模块仍按宿主代码的权限运行。

## 预知未来式技能

在伤害技能的 BeforeHit 上注册以下效果，holder 是环境中可用的普通印记原型。调用方可通过条件限定仅在自己的技能命中时使用。

```ts
when: conditions.selfUsesSkill,
apply: contexts.skillUse.apply(ops.deferSkillDamage(holder, { afterTurns: 2 })),
```

第一回合施放，第三回合的行动、TurnEnd 效果和回合怒气都完成后，在印记更新阶段触发。afterTurns 为 0 表示施放回合结束时触发。印记绑定战场和目标玩家的位置，换宠后读取该位置当前的精灵。描述中保存原施法者、技能定义和实例、伤害公式以及目标位置。派发时重新读取攻防、属性克制和可用护盾，并使用战斗 RNG。capturePower 可单独锁定施放时的威力。技能检查、支付、使用次数和命中流程只在施放时执行一次。

默认 sourcePolicy 为 any，原施法者在替补或倒下时仍可结算。alive 要求存活，active 还要求仍在场。提前移除会取消，压制状态下到期会丢弃。刷新或叠加同一位置的印记保留原描述，替换策略选用新描述。保存的印记和 RNG 随战斗快照恢复。基础包的「预知」是对自身施放的变化技能，验证场景另建了特殊攻击技能。

## 旧效果迁移

| 旧写法                                                       | 新写法                                                                                       |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| 在 OnDamage 改写 damageResult 或设置伤害上下限               | 数值项在 OnBeforeCalculateDamage 声明。致命保命在 OnDamageReplacement 使用 ops.surviveDamage |
| 先扣印记层数再调用 preventDamage，或先治疗再取消伤害         | 用 preventDamage 的 stacks 参数或 replaceDamageWithHeal 声明一次性规则和费用                 |
| 从实时 HP 差或可变 Context 推算吸血、反伤和怒气              | 从 contexts.damageResult 读取 hpLoss，从 origin 取得真正的来源                               |
| 在 SkillPhase 自行宣告击败                                   | 监听 OnDefeat，从 DefeatContext 读取 target、killer 和 skill                                 |
| 外部拼装 DamagePhase 的位置参数、手工调用 updateDamageResult | 使用 pet.damage(proposal)，阶段和求值由引擎建立。SDK 的普通定量伤害使用 ops.dealDamage       |

伤害的 modified 兼容读数由数值项计算。直接修改返回的二元组不会注册规则。每个事件的阶段配置沿用 PhaseManager 的清理边界，结算器的候选、预留和临时 Context 都随事件释放。将来推广到治疗、怒气与印记时，可以复用提案身份、数值运算和提交结果的约定，各领域保留自己的费用与状态规则。

## 架构依据

万智牌规则 603 区分事件发生与触发响应，614、615 和 616 在事件发生前处理替代、防止和重新检查适用条件。704 单独定义状态检查。Arcadia 将这些边界接到现有同步阶段与濒死响应窗口中，规则选择使用引擎确定的次序。[Magic 综合规则](https://media.wizards.com/2026/downloads/MagicCompRules%2020261106.txt)

Forge 的 ReplacementHandler 按事件和层级收集候选，并记录已经作用过的替代效果。这个做法用于确定一次伤害内的规则身份和终止条件。[Forge ReplacementHandler](https://github.com/Card-Forge/forge/blob/master/forge-game/src/main/java/forge/game/replacement/ReplacementHandler.java)

Unreal GAS 将效果定义和运行时 Spec 分开，Modifier 处理属性运算，Execution Calculation 处理具体执行。Arcadia 对应复用技能和印记定义、属性系统与即时求值环境，使用独立结果记录一次伤害的结算。[Gameplay Effects](https://dev.epicgames.com/documentation/en-us/unreal-engine/gameplay-effects-for-the-gameplay-ability-system-in-unreal-engine)
