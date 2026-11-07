# 战斗行为约定

## 运行时约定

| 领域       | 当前约定                                                                                                                           | 回归入口（`packages/battle/test/v4/`）                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 同步值     | Signal/ReactiveValue/derived 提供同步读取、订阅与释放；自定义 RxJS 输入需适配                                                      | `reactivity.test.ts`、`value-binding.test.ts`                              |
| RNG        | 独立 `sfc32-v1`，支持状态续接                                                                                                      | `rng.test.ts`                                                              |
| 阶段错误   | 默认传播；非零 retryCount/timeout 在修改前拒绝，自动回滚重试尚未实现                                                               | `phase-lifecycle.test.ts`                                                  |
| 阶段 scope | Current 取最近活跃匹配实例，无则取下一实例；Next 跳过注册时活跃实例；显式 phaseId 优先；Any 在匹配类型中生效并于首个匹配完成时清理 | `historical-fixes.test.ts`                                                 |
| 伤害/怒气  | 保留真实上下文；技能伤害来源为 SkillInstance，按 DamageType 分类；取消伤害不派发衍生怒气；Rage 前事件在结算前、后事件在结算后      | `historical-damage-lifecycle.test.ts`、`historical-rage-lifecycle.test.ts` |
| 层数消耗   | 经 ConsumeStackPhase；前事件可取消/修改，扣层固定后派发后事件与消息，后事件取消不回滚已扣层                                        | `historical-stack-consumption.test.ts`                                     |
| 技能结束   | SkillUseEnd 效果在技能 finally 的印记清理后派发；try 之前的早期失败不派发                                                          | `automatic-stack-consumption.test.ts`                                      |
| 临时效果   | 绑定最近 Skill、其次 Turn、否则当前阶段；阶段 finally 清理；加入效果不重派当前触发器                                               | `temporary-effects.test.ts`、`random-temporary-effect.test.ts`             |

变身恢复使用切换前当前 HP 比例，原生印记采用 suppression 保留身份与来源清理。完整状态约定见[快照](v1-snapshots.md)。

## 行动顺序

计划与派发使用 UseSkillContext priority。相同优先级、速度下保持 A 后 B 派发，计划 pop 视图相反。`contexts` 按 pop 顺序保存计划，`contextQueue` 在派发前移除当前项；`appledContexts` 在 Skill/Switch wrapper 的钩子前登记尝试，包含随后失败的尝试。first/last 查询递归查找最近技能与回合，跳过换宠条目。

多段命中的 `currentHitCount` 从 1 开始，循环条件为 `<= multihitResult`，后者表示总数。命中后游标递增，miss 不递增，同一上下文再次执行不重置游标。

## 内容行为

- 飞旋阵：换宠怒气为 `floor(rage * 0.8)`，损失通过 RagePhase 处理。出场印记可取消损失并移除自身；无损失时不消费保护。
- 心灵制约：在百分比/delta 后、取整前，以当前层数限制每次怒气增加；多个上限取最小，减怒和赋值不受影响。
- 连续飞行：以完成的技能使用所保存的元素历史判断，避免 lastSkill 后续变化影响结果。
- 戏法：每次选择一个效果并使用临时效果生命周期。同一 BeforeSort 中新增的优先级效果不追溯改变本次排序。

## 参数作用域

命名与标签 Config 修饰按来源所有者作用域读取。Player 范围不自动覆盖全队，修饰器记录存在也不代表当前读取者会获得加成。效果作者应明确参数接收方和读取方。
