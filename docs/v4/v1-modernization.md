# V1 缺陷修复与依赖替换

本轮在已经跑通的直接移植版本 `14125996` 上继续，原始导入提交与来源 commit 保留。默认 V2 入口、#201 fixtures/预期及其他分支均未改动。P2P 测试按用户本轮指示跳过。完整来源映射见 [inventory](./v1-port-inventory.md)，逐行改动见 [历史源码对照](./v1-compatibility.patch)。

## 已修复的行为与回归

| 问题                                                     | 修复                                                                | 实际验证                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------- |
| V1-BUG-01：DamagePhase 重建上下文，受击怒气读取旧结果    | Pet.damage 使用调用者的真实 DamageContext；拒绝伤害的结果为 0       | 原 expected-failure 改普通通过；实际技能伤害、怒气公式及拒绝伤害测试 |
| Heal/Rage/AddMark/RemoveMark 同样丢失上下文身份          | 阶段接收原上下文，保留效果写入的结果和标志                          | 治疗/怒气及真实战斗印记流程；OnRageGain 拒绝后不加怒气               |
| Pet/Parser 忽略显式 maxHp、性别                          | 传递并使用参数；移除官方战斗测试对 HP 的手工补写                    | PetParser 初始化后 HP=37 且性别正确；#201 配置直接运行               |
| 能力等级跨正负时 detach 后再读取 owner                   | 保存原 owner 再移除/重建                                            | +1 → -1 后新印记所属和 0.66 倍属性正确                               |
| 治疗把 isActive 方法本身当布尔值                         | 调用 isActive()                                                     | 替补精灵 HP 不被治疗                                                 |
| Builder 默认 accuracy=1、multihit=0                      | 默认 100、1；显式配置照旧                                           | Builder 回归                                                         |
| BeforeSort 改写 priority 后排序仍读原 Skill              | 使用已创建 UseSkillContext 的优先级                                 | 真实 TurnPhase 技能执行顺序反转                                      |
| sureCrit/ignoreOpponentStageStrategy 未进入技能上下文    | 传递基础配置；setSkill 更新对应配置和目标                           | sureCrit 在暴击率 0 时仍生效；忽略能力阶段策略保留                   |
| PhaseManager 把异常转换成结果后调用方继续                | 默认向上传播，显式 skipOnError 保留；嵌套完成恢复父阶段             | 同步阶段抛错、完整战斗无失败阶段                                     |
| cleanup/投降时输入等待悬挂                               | 唤醒等待；取消检查；战斗结束后不再执行缺少动作的回合                | 真实 startBattle 等待中 cleanup 与 abandon 均结束                    |
| 阶段配置使用全局 ConfigSystem                            | 查询本局配置；同步递增通知取代异步 import + 时间戳                  | 两局嵌套运行不串配置；注入的 ConfigSystem 同样有效；阶段完成即清理   |
| Next 等同 Current，scoped 修饰器未正确清理               | 绑定具体阶段实例，排除注册时已活跃实例                              | Current/Next、属性与 scoped 配置回归                                 |
| 阶段属性绑定晚于通知                                     | 先完成实例绑定，再发布修饰器                                        | 阶段中注册后订阅者立即得到新值                                       |
| 变身结束恢复到初始 HP 比例                               | 每次切换形态前读取当前比例，使用 currentHp setter                   | 变身期间受伤后还原不回满血                                           |
| 原生特性/徽章 Override 直接从数组删掉，丢失来源恢复/清理 | 暂时抑制原生印记，保留身份、owner、持续时间                         | 来源印记到期仍还原形态；其效果、属性、配置修饰与护盾在抑制时不生效   |
| TransformPhase 与系统重复派发；OnTransform 未派发        | 集中到系统，Before → 应用 → On → After 各一次                       | 通过真实 TransformPhase 记录顺序                                     |
| 内置变身策略声明 async，异常成为无人等待的 rejection     | 保持同步接口并同步传播错误                                          | 类型/构建及真实变身回归                                              |
| 批量清理未释放 clamp 订阅，部分新建对象未加入本局清理    | 共用幂等 disposer；Skill/StatLevel 的 AttributeSystem 注册 battleId | 来源移除、动态分支切换、最后观察者退出、失败订阅均释放               |

这里没有把 V2 规则自动应用到 V1。#201 已确认的三个 V1/V2 行为差异（换宠怒气取整、行动时刷新目标、阵亡后的回合怒气）保持原 V1 语义，V2 的三个预期失败原样保留。

### 错误执行选项

历史 `retryCount` 在已经 Failed 且可能部分改写状态的阶段上递归重试；没有回滚，也无法安全再次执行。现在在任何修改发生前明确拒绝非零 retryCount；原来未落实的非零 timeout 同样明确拒绝。`skipOnError` 仍可显式请求返回失败结果。它们不是“实现了重试/超时”：自动重试需要回滚边界，超时需要合作式取消，尚未完成。这是公开行为收紧，不是删掉未知战斗机制。

### 阶段 scope 的精确定义

Current：绑定注册时最近的对应阶段；若没有，则绑定下一个进入的匹配实例。Next：跳过注册时全部活跃实例，绑定下一个进入的匹配实例。完成绑定实例时清理。显式 phaseId 优先指定实例。Any 保留历史“处于匹配类型时生效，首个匹配完成时清理”的语义，本轮没有重新定义为永久生效。自定义阶段可以显式设置 phaseType；内置阶段仍保留类名。随机阶段 ID 不再参与类型识别。

## RxJS 替换前后

原代码使用的能力是同步当前值、组合/映射、按修饰器变化重新订阅、值去重和清理。未发现需要保留的异步 producer 或 scheduler。新的 `reactiveValue.ts` 只提供这些同步能力，未重写 Battle 对象或 DSL operator。

```ts
// 原：AttributeSystem/Modifier 中的 RxJS（片段）
new BehaviorSubject(initialValue)
combineLatest([base$, modifiers$, phaseChange$]).pipe(
  switchMap(([base, modifiers]) => combineLatest([...modifierValues]).pipe(map(...))),
  distinctUntilChanged(), shareReplay(1),
)
// 原 Observable 输入需要同步首值，且桥接订阅有重复订阅/清理问题。

// 现：属性计算算法仍在 calculateAttributeValueSafely 中
const computed$ = derived(() => {
  void AttributeSystem.phaseVersion.value
  const base = this.baseAttributes.get(key)!.value
  const modifiers = this.modifiers.get(key)!.value
  for (const modifier of modifiers) void modifier.value.value
  return this.calculateAttributeValueSafely(key, base, modifiers)
})
```

- `Signal` 保存可变值；`derived` 动态收集依赖；`.value` 同步读取；`.subscribe(fn)` 立即给当前值并按 Object.is 去重；返回 unsubscribe；`.map`/`combineValues` 组合。只有被观察时才订阅依赖，分支切换和最后观察者退出时释放。
- 读取时重新计算，避免菱形依赖路径的旧缓存中间值。保留原 AttributeSystem 循环检测、回退、修饰器排序与 percent/delta/override/clamp 算法。
- 真实旧 DSL 的动态属性、sum/add/multiply/divide/clamp 及 `selectObservable` API 名保持。DSL schema/type-metadata 的 `Observable<...>` 字符串是历史类型标签，保留以兼容历史内容，运行时已不依赖 RxJS。
- **接口变化**：自定义 TypeScript 效果传入的 RxJS Observable/Subject 必须改为 Signal/ReactiveValue；不提供 `.pipe`、异步 Observable 或 RxJS 完整订阅协议兼容。旧代码本就要求同步首值，官方历史 YAML 不需要重写。
- battle package 不再声明 rxjs/prando；完整 V4 源码和实际 Node/browser 模块图均禁止重新引入。仓库其他包仍使用的 RxJS 未擅自删除。

## Prando 算法替换前后

```ts
// 上一里程碑
this.rng = options?.rng ?? new Prando(options?.rngSeed ?? ...)
// 当前
this.rng = options?.rng ?? new GameRng(options?.rngSeed)
```

`GameRng` 把现有 `packages/engine/src/rng.ts` 的 sfc32 算法移到独立文件，未引入 engine 运行时；增加 `algorithm: 'sfc32-v1'`、范围/状态校验、字符串/0 种子和 JSON 状态恢复。种子扩展、12 次预热和前 8 次输出由固定向量锁定。注入 BattleRng 接口继续可用，技能随机、洗牌和 AI 选择仍用同一流。

**不保持 Prando 的同种子序列**。更换算法是用户本轮授权的行为变化；不把新的伤害数值描述为逐次等价于 Prando。V4 场景的精确预期依据实际 sfc32 运行更新，同时保留状态/效果/伤害公式断言。#201/V2 预期没有修改。RNG.getState/fromState 只恢复随机流，不恢复 Battle。

## 实际范围与后续缺口

全量历史 YAML 仍由真实 parser/EffectBuilder 加载：666 Effects、280 Marks、576 Skills、91 Species。真实战斗仍走原版阶段链、伤害、印记、怒气与结算。本轮测试不是全官方效果实战等价证明。

尚未把 AfterAttacked、OnTransformEnd 的所有调用路径和 inheritOnFaint 的规则确认为完整能力；本轮不猜测规则补齐。新 const 触发器仍只是兼容类型，不冒充 V1 已支持。变身永久/临时栈的所有交叉组合、计时器竞态和任意自定义效果闭包尚无穷尽验收。Suppress 的原生印记仍留在 marks 内维护持续时间，序列化时必须保存 suppression、来源和形态关系；不能仅保存消息中的 isActive。

仍未实现完整 BattleSnapshot/restore、持久 replay、稳定运行实例/效果身份、动态函数的可恢复注册表、等待点恢复。Signal 替代 RxJS 并不会自动使动态函数或阶段栈可 JSON 化。下一步以这些真实状态设计序列化边界，继续保留旧 DSL 到 EffectTemplate 有逐项等价证据。

## 2026-10-17 续作

上述报告是依赖替换里程碑。之后已在真实 V1 上增加正常选择等待点的直接数据快照/恢复、动态依赖/清理重建和原版 AI 监听重绑；未实现的边界及独立进程/Browser 验证见 [快照报告](./v1-snapshots.md)。
