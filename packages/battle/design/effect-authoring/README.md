# Effect authoring API — 最小运行时试验

本目录保留类型与行为验证，正式实现位于 `src/v4/content/authoring`，通过 `compileEffect(definition)` 显式适配成现有 V4 Effect。四个示例在真实战斗对象、效果调度及属性系统上运行；公共入口为 `effectAuthoring` 命名空间；四个示例已成为 `official/authored` 中的候选，并由 `officialAuthoredEffects` 显式导出。尚未进入生产内容目录。用户已授权恢复迁移。

在仓库根目录运行：

```sh
pnpm typecheck:effect-authoring-design
pnpm test:effect-authoring-design
```

也已使用 `pnpm exec tsc -p packages/battle/design/effect-authoring/tsconfig.json` 独立检查。类型检查与测试使用真实 V4 Pet、MarkInstance 和触发上下文，没有另造简化的领域模型；不包含历史遗留的未提交测试文件。

## 阅读顺序

| 文件                                              | 原效果与设计问题                                                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| [fantasy-defense.ts](examples/fantasy-defense.ts) | `effect_skill_consume_huanxiang_raise_def_1_stage`：一个印记选择器分别生成条件和动作；后一步独立查询              |
| [damage-by-hp.ts](examples/damage-by-hp.ts)       | `effect_mark_damage_boost_based_on_hp_percentage`：收集条件与动作数值分别求值，条件分支延迟执行，保留阈值向下取整 |
| [time-rebirth.ts](examples/time-rebirth.ts)       | `effect_mark_shiguangchongsheng`：属性值与可写引用分开；直接赋值不改成治疗                                        |
| [weakness-speed.ts](examples/weakness-speed.ts)   | `effect_mark_reduce_speed_ruodian`：固定实例／跟随层数，以及两个明确不同的跟随方案                                |
| [api.ts](api.ts)                                  | 作者入口；转向 `src/v4/content/authoring` 中的契约与实现                                                          |
| [type-tests.ts](type-tests.ts)                    | 精确类型断言和必须失败的用法                                                                                      |

原始定义位于 `packs/base/data/effect_skill.yaml` 和 `packs/base/data/effect_mark.yaml`，通过上述 ID 查找。示例未改变这些定义。弱点记号示例只选择第一个符合条件的印记，未把旧操作消费首值的行为改成求和。`spd` 是特防，`spe` 是速度；降速示例明确使用 `spe`。

## 编译已验证的接口约束

- `on` 决定 `ctx.event`，直接使用已有 `TriggerContextMap`。回调不能反向改变触发器推导；多触发器用 `ctx.on` 收窄。
- `contexts.nearestSkillUse` 是可能失败的祖先查询，与直接事件上下文不同。
- 选择器的元素类型传入 `where`、`select`、判断器与操作器；上下文特定的操作经 `apply`、`sequence` 组合后保留触发器要求。
- `.first()` 产生可缺失的单值来源。`.map()` 跳过缺失输入并保留 optional；`ctx.read()` 返回 `T | undefined`，调用者必须处理。
- 瞬时数值、可写引用、持续绑定是不同类型。普通数字不能传给赋值操作，印记操作不能作用于 Pet。
- 可写属性暂时仅开放示例需要的 `currentHp`，不是让所有实体字段都可写。
- 实体属性键从实际类型推导。`spd` 与 `spe` 都是合法键；标量没有实体属性。
- 持续计划的 `.attribute()` 返回待指定策略的步骤，必须选 capture/follow 才能用于绑定。
- 持续 `.map()` 仅允许标量到标量的派生。不能在已捕获实体上直接 map 出属性而省略时间策略。
- 参数名字与数值类型由声明推导。公开参数在本试验中是一个值来源；未实现注册、有效范围或旧别名解析。
- 负向测试使用 `@ts-expect-error`；如果错误用法意外变得合法，编译会因未使用的指令失败。正向精确类型断言同时防止退化成 `any`。

## 执行契约与已验证行为

`contexts.damage` 每次查询最近的伤害祖先，和 `nearestSkillUse` 共用祖先查找。`ops.modifyDamage` 先读 percent 再读 delta，各读一次，缺失时跳过整次操作；条件的 all/any/not 按顺序短路。

`.condition()` 在条件调用时查询；`.apply()` 在动作调用时查询。`actions.sequence()` 不预先缓存后续选择，也不隐式要求前一步成功。`values.choose()` 只读取选中分支。效果收集与动作执行不会共享隐式参数或目标快照。

`ops.heal()` 的值按一次操作求值后用于目标集合；它的可缺失值使本次操作跳过。本试验的 consumeStacks、changeStatStage、assign 也按一次操作取值，已有多目标消耗测试；未来新增操作必须独立声明取值时机。

capture/follow 在建立绑定时才生效，不在模块求值时执行。`scope: binding` 对本次绑定捕获；`scope: input` 对输入连续入选期间捕获，离开后重新进入是新一代输入。绑定中 scalar map 随输入更新重新计算，不引入新的捕获步骤。

`lifetime: sourceMark` 复用现有 modifier 清理。`missing: detach` 在这里明确定义为**暂时撤去数值贡献，保留选择器监听**；follow 找到新输入后可恢复，sourceMark 销毁才永久解绑。capture 得到的实例不会改绑；实例失活后属性来源缺失，最初捕获空值也不会追认后来新增的实例。两个 follow 变体仅用于语义对比，未注册进生产内容。

真实调度测试覆盖消耗钩子改变归属后的重新查询、条件通过后 HP 改变、分支惰性求值、复生直接赋值、spe/spd 区分、层数变化、来源销毁、印记替换、初始缺失、无中间读取的同实例重新进入，以及真实换人阶段。既有 value-binding 测试一并运行。

TypeScript 无法证明任意回调纯净，也无法保证节点 key 在运行时唯一。scalar map 约定纯计算；禁止偷偷读取闭包中的可变战斗状态。运行时复用 Evaluation 的 key 检查和既有绑定循环检测；初始缺失仅允许明确的 BindingInputUnavailable，不吞掉非法计划或循环错误。存档不序列化任意闭包，应通过已锁定内容中的声明身份恢复。

## 本次验证结论

四个示例不需要显式泛型、类型断言、`instanceof` 或父链遍历。查询、分支、动作与绑定策略能分开阅读。事件、实体和属性类型由 TypeScript 推导；没有增加字符串类型解析器或运行时 DSL。

这次证明静态接口及上述运行时场景，不宣称与全部旧效果等价。持续计划已通过 `registerEffect(catalog, compiledEffect)` 与效果整批注册；计划身份由 effect ID 与 binding key 决定。组合动作自动收集绑定声明，自定义 execute 回调须在 `bindings` 中显式列出。恢复只持有来源印记引用，不保留旧触发上下文；持续查询不能访问触发事件或执行动作。参数已通过 `effectParameters(compiledEffect)` 接入现有 ParameterCatalog：新战斗需显式安装，读取使用当前来源作用域；恢复保留存档中的参数值。参数同样支持 capture/follow，仍未提供完整 UGC 编辑界面；候选效果需完整验收才能发布。

关系通知现位于 `src/v4/values/relations.ts`，由 Pet、Mark、Skill 构造器及存档恢复初始化，作者 API 不再按需改写领域对象。提前保留的 `pet.marks` 句柄也能通知选择器；整表赋值复制成员数组，之后应通过 `pet.marks` 修改集合，原始传入数组和已替换的旧句柄都不能影响或通知当前集合。列表方法完成后通知一次，直接索引与 length 修改也会通知。其余同步依赖、预算、capture 状态、modifier 及清理均复用现有 V4 实现，没有引入 RxJS。详见 [领域关系验证](../../../../docs/v4/validation/domain-relations.md)。
