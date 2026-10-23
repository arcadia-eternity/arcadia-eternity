# V1 兼容与显式行为修正

初始移植来源见 [V4 指南](direct-v1-port.md)。后期 V1 参考为 `61c349fa7ca35c392b0e751c9238759b02aefcb3`；[历史审计 JSON](validation/historical-v1-audit.json)保存具体路径和定位。同一提交还包含 V2 实现，V1 parser 缺字段不能推出整个项目从未实现该能力。

## 保留的迁移原则

保留真实领域对象与阶段链，再处理宿主、同步值、RNG 和快照适配。发现差异时沿源定义、selector/operator、事件派发、来源归属与最终状态核对；效果名与测试数量不能代替规则。

历史 DSL 与原生效果的比较分开记录：原样行为、显式修正、未验收。candidate JSON 中的 E/C/U、Cxx 和 source hash 属于固定比较记录，具体 ID/节点映射保留在 [validation](validation/README.md)；上线使用原生目录不自动改变这些历史分类。

## 运行时约定

| 领域       | 当前约定                                                                                                                           | 回归入口（`packages/battle/test/v4/`）                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 同步值     | Signal/ReactiveValue/derived 提供同步读取、订阅与释放；历史 Observable 类型标签保留，自定义 RxJS 输入需适配                        | `reactivity.test.ts`、`value-binding.test.ts`                              |
| RNG        | 独立 `sfc32-v1`，支持状态续接；同种子序列与 Prando 不同                                                                            | `rng.test.ts`                                                              |
| 阶段错误   | 默认传播；非零 retryCount/timeout 在修改前拒绝，自动回滚重试尚未实现                                                               | `phase-lifecycle.test.ts`                                                  |
| 阶段 scope | Current 取最近活跃匹配实例，无则取下一实例；Next 跳过注册时活跃实例；显式 phaseId 优先；Any 在匹配类型中生效并于首个匹配完成时清理 | `historical-fixes.test.ts`                                                 |
| 伤害/怒气  | 保留真实上下文；技能伤害来源为 SkillInstance，按 DamageType 分类；取消伤害不派发衍生怒气；Rage 前事件在结算前、后事件在结算后      | `historical-damage-lifecycle.test.ts`、`historical-rage-lifecycle.test.ts` |
| 层数消耗   | 经 ConsumeStackPhase；前事件可取消/修改，扣层固定后派发后事件与消息，后事件取消不回滚已扣层                                        | `historical-stack-consumption.test.ts`                                     |
| 技能结束   | SkillUseEnd 效果在技能 finally 的印记清理后派发；try 之前的早期失败不派发                                                          | `automatic-stack-consumption.test.ts`                                      |
| 临时效果   | 绑定最近 Skill、其次 Turn、否则当前阶段；阶段 finally 清理；加入效果不重派当前触发器                                               | `temporary-effects.test.ts`、`random-temporary-effect.test.ts`             |

变身恢复使用切换前当前 HP 比例，原生印记采用 suppression 保留身份与来源清理。完整状态约定见[快照](v1-snapshots.md)。V2 基线的已知差异见[基线指南](battle-baseline.md)。

## 顺序与路径决策

C08 保持实际阶段排序与计划一致。`contexts` 按 pop 顺序保存完整计划，`contextQueue` 在派发前移除当前项，`appledContexts` 在 Skill/Switch wrapper 的钩子前登记尝试，含随后失败的尝试。first/last 查询递归查找最近技能与回合，跳过换宠条目。

当前计划与派发都使用 UseSkillContext priority。后期 V1 的计划使用该 priority、阶段却按 SkillInstance priority 排序；BeforeSort 改优先级是显式修正。相同优先级/速度保持 A 后 B 派发，计划 pop 视图相反。选择尚未收集完时的计划可见性仍需单独比较。定位见 `historical-turn-order.test.ts`、`turn-order-correction.json`。

C09 对明确记录的旧字段路径逐节点修正，例如 `skillId` → `skill`、Pet 的 `spa/atk` → `stat.spa/stat.atk`。修正只适用于记录的定义和节点，不设全局别名；它建立与 V1 对象模型的兼容，不能据此否认 V2 的 ID 字段。具体映射与源定义保留在 candidate JSON 及对应 corrected-\* 测试。

多段命中恢复后期 V1 游标：`currentHitCount` 从 1 开始，循环条件为 `<= multihitResult`，后者保持总数；命中后递增，miss 不递增，同上下文再次执行不重置游标。天气效果的 C07/C10/C13 修正及怒气触发器的 C15 重写已撤回。相关回归为 `historical-hit-cursor.test.ts`、`random-weather-application.test.ts` 与怒气生命周期测试；不能将旧 Cxx 结论批量沿用。

## 官方内容的明确修正

- 飞旋阵：换宠扣怒气通过 RagePhase，保留最终 `floor(rage * 0.8)`，出场印记可取消本次损失并移除自身；无损失不消费保护。参见 `switch-rage-protection.test.ts`。
- 心灵制约：在百分比/delta 后、取整前，以当前层数限制每次怒气增加；多个上限取最小，减怒/赋值不受影响。参见 `rage-gain-limit.test.ts`。
- 连续飞行：以完成的技能使用所保存的元素历史判断，避免 lastSkill 引用后来变化；旧快照缺该字段时不推断历史。参见 `consecutive-flying-rage.test.ts`。
- 戏法：原扁平动作数组在随机选择前执行的缺陷不作为原生选择合同；原生只选择一个效果并使用已有临时生命周期。相同 BeforeSort 内新增的优先级效果不会追溯改变本次排序。参见 `historical-action-selection.test.ts`、`random-temporary-effect.test.ts`。

## 仍需单独处理的语义

- 命名/标签 Config 修饰仍受来源所有者作用域约束；存到对手 Player 的修饰器可能不影响对手读取，自己的 Player 范围也不自动覆盖全队。不能只凭记录存在判断加成生效。参见 `named-parameters.test.ts`、`tagged-parameters.test.ts`。
- 经验加成效果保留原 TODO 空动作，尚无经验结算能力；参见 `experience-placeholder.test.ts`。
- 旧阈值 parser 忽略字面量 0，而 raw:number 的 0 为显式配置；原生作者 API 允许显式 0，比较历史效果时需区分。参见 `damage-thresholds.test.ts`。

逐效果最终分类、完整依赖行为和私房宿主恢复继续按相应验收场景检查。历史 parser 名称齐全只证明入口存在，不能证明方法体、时序和完整战斗等价。
