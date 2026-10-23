# TypeScript 效果编写

官方效果维护在 `packs/base/src/effects/`。作者 API 通过 `@arcadia-eternity/battle/v4/authoring` 或内核的 `effectAuthoring` 命名空间使用，示例见[作者 API 示例](../../packages/battle/design/effect-authoring/README.md)。

## 一次执行

`defineEffect` 的 `on` 推导事件类型，`compileEffect` 适配为现有 Effect。直接事件与 `contexts.nearestSkillUse` 等祖先查询分别使用；嵌套伤害/效果不能凭直接父级推断施放者。

- 条件在收集时读取；动作在执行到该步时重新查询。条件通过后，HP、归属或目标可能已变化。
- `actions.sequence` 按顺序执行，每步独立查询；后续步骤不隐式依赖前一步成功。
- all/any 按顺序短路，`values.choose` 只读取选中分支；查询失败与数值缺失按各操作合同处理。
- 瞬时值、可写引用、持续绑定采用不同类型。写操作先检查目标属于本局，避免跨战斗修改。
- `values.randomInt` 每次取值通过本局 RNG 抽样，包含两端；声明不抽样，单点区间也消耗一次。随机查询不能直接放入持续 capture/follow。

`selfPlayer`、`opponentPlayer` 在直接技能上下文按施放者/实际目标查询，其他上下文按效果所有者及其对手查询。持久绑定按来源身份查询，不携带临时事件。体重/身高条件使用 Pet 的可选原始字段，缺失不补成属性回退值；`spe` 为速度，`spd` 为特防。

## 持续取值与生命周期

绑定的每一步明确选择 capture 或 follow。选择实例与读取属性是两步：捕获实例后仍可跟随它的属性；跟随位置后也可对每次入选实例捕获属性。

- `scope: binding` 在建立本次绑定时捕获；`scope: input` 在当前输入连续入选期间捕获。真正离开后重新进入形成新输入代次，即使没有中间读取。
- 持续 map 只做纯标量计算。读取可变战斗状态须通过声明的依赖，不能藏在闭包里。
- `missing: detach` 暂撤数值贡献并保留结构监听，follow 找到有效输入后可恢复；capture 的空值不会追认后来实例，已捕获实例不会改绑。
- 来源印记销毁永久释放绑定；suppression 暂停贡献并保留跟踪与捕获。刷新不重跑效果或 RNG。
- 图节点 key 在计划内唯一，循环依赖明确报错。持续计划通过稳定 Effect ID、binding key 与可信工厂恢复。

领域关系由构造器与快照恢复初始化。`pet.marks` 赋值复制成员数组，修改应通过当前 `pet.marks` 句柄；旧句柄与原传入数组不再影响当前集合。列表方法完成后统一通知，索引及 length 修改也会通知，避免中间数组移动制造虚假离开/重新进入。

## 参数

`numberParam` / `booleanParam` 声明配置值，编译后使用 `parameterAddress(effectId, 'parameters', name)`。`effectParameters(effect)` 返回现有 `ParameterCatalog`，新对战在派发前安装；读取使用当前来源作用域。恢复注册相同定义与工厂，保留保存的参数值。

参数读取可 capture/follow。未安装或未声明的参数明确失败；别名解析到规范地址，同一 token 不能在一个效果内使用两个名字。命名/标签修饰复用 ConfigSystem 的排序、作用域和来源清理。已知的对手作用域限制见[兼容约定](compatibility.md#仍需单独处理的语义)。

实例印记参数在 OnMarkCreated 之前注入。叠层合并时校验参数兼容性，冲突在副作用前拒绝；快照注册同一参数合同。

## 有限 UGC 与执行预算

UGC 使用 `defineAction`、CapabilityRegistry、`compileRule`、`compileContentPack` 和 `lockContentEnvironment`，输入为有边界的数据，执行使用可信能力实现。编译先完整验证 ID、schema、上下文保证及引用，再发布不可变结果；每个动作在执行前解析自己的上下文。例子保存在 [examples](examples/ugc-recovery-pack.json)。

公开 Config 参数与内容常量分开：内容 schema 验证声明，effective schema 验证配置读取。稳定节点/参数 ID 保持引用；复制规则需重映射本地身份。不可变环境以可信构建身份、策略和编译后内容计算摘要，transport 摘要另标识原始文本；顺序有语义，默认值与空白归一化按编译结果处理。

执行预算由 Battle 拥有，嵌套派发复用当前 root，回合累计跨 root 保留。耗尽后 fault 锁存并停止计时、释放等待，skipOnError 不能吞掉；快照保存已花费的回合预算。限额见 [budget.ts](../../packages/battle/src/v4/execution/budget.ts)。可信任意回调中的无限循环无法由同步计数器抢占；旧 ReactiveValue 内部与未来 Config 图的全面计费仍需扩展。

完整 UGC 编辑流程、跨包引用/预设、全部结构预算与逐效果行为验收仍有独立工作，使用现有编译器时按其实际能力与拒绝条件处理。

## 维护与检查

修改行为直接编辑 TS，调整相应机制或完整战斗回归；历史 YAML 与 candidate JSON 只作比较输入。类型负向测试、持续值、参数、领域关系和 JSON 恢复的回归入口分别位于作者设计目录与 `packages/battle/test/v4/`。常用命令统一见 [V4 验证](direct-v1-port.md#验证)。
