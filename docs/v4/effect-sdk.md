# Effect SDK：使用现有战斗 API 编写 TypeScript 效果

SDK 公开官方效果使用的领域类、上下文和操作。公共入口是 `@arcadia-eternity/battle/v4/authoring`；npm 包运行时使用宿主传入的 `sdk`，类型从这个入口导入。当前兼容版本为 `arcadia.sdkApi: 1`，类型入口和本地打包物料已提供，公开 npm 发行另行管理。

## 从一个效果开始

```ts
import type { CodeEffectModuleContext } from '@arcadia-eternity/battle/v4/authoring'

export function createEffects({ sdk, id }: CodeEffectModuleContext) {
  const { defineCodeEffect, EffectTrigger, Pet, HealContext } = sdk
  return [
    defineCodeEffect({
      id: id('heal-on-hit'),
      sourceKind: 'skill',
      triggers: [EffectTrigger.OnHit],
      when: context => context.source === context.parent.skill,
      apply(context) {
        const owner = context.source.owner
        if (owner instanceof Pet) {
          owner.heal(new HealContext(context, context.source, owner, 20))
        }
      },
    }),
  ]
}
```

`triggers / priority / when / apply / consumesStacks / tags` 与官方 `defineNativeEffect` 一致。`defineCodeEffect` 只把定义接入 npm 内容导出和每次使用的注册流程；回调收到原本的 `EffectContext`，领域方法走原有战斗阶段。简单定义无需 `build`。旧的 `build({ effectId, sourceMark }) → { on, execute, ... }` 写法继续支持。

在 package.json 的 `arcadia.exports` 中声明 `{ "id": "heal-on-hit", "sourceKind": "skill" }`，并在技能的 `behaviors` 中通过独立 `useId` 引用它；完整内容与安装格式见 [npm 内容包](npm-content.md)。`createEffects` 返回的导出必须与声明一致。

独立的官方内容宿主也可以使用 `sdk.defineNativeEffect` 构造内核 `Effect`，由自己的内容目录注册；npm 的 `createEffects` 返回 `defineCodeEffect` 产生的导出。

## 现有 API 索引

| 用途               | 公开 API 与常用操作                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 触发与上下文       | `EffectTrigger`、`nativeEffectTriggers`、`EffectContext`、`UseSkillContext`、`TurnContext`；`NativeEffectContext<T>` 根据触发类型推导 `parent`             |
| 领域对象           | `Battle`、`Player`、`Pet`、`BaseSkill`、`SkillInstance`、`BaseMark`、`MarkInstanceImpl`，以及原有实例类型与枚举                                            |
| 伤害和治疗         | `DamageContext`、`HealContext`；`pet.damage(context)`、`pet.heal(context)`；伤害事件的 `addModified(percent, delta)`                                       |
| 怒气               | `RageContext`；`pet.addRage(context)`、`pet.reduceRage(context)`，分别走获得和损失事件                                                                     |
| 印记               | `AddMarkContext`、`RemoveMarkContext`、`StackContext`、`ConsumeStackContext`；`pet.addMark`、`battle.removeMark`、`mark.consumeStack`、`pet.transferMarks` |
| 属性贡献           | `Modifier`、`DurationType`、`attributeSystem.addModifier`；`Signal`、`ReactiveValue`、`projectValue`、`combineValues`                                      |
| 参数               | `numberParam`、`booleanParam`、`stringParam`；`parameterAddress`、`ParameterCatalog`、`defineParameter`、`ConfigSystem`、`ConfigModifier`                  |
| 即时选择与操作工具 | 原有 `targets`、`contexts`、`conditions`、`values`、`ops`、`actions`，按需使用                                                                             |
| 持续取值工具       | 原有 capture/follow、`bindings`；底层值计划集中在 `sdk.valuePlans`，避免与即时 `sdk.values` 混淆                                                           |
| 执行预算           | `executionBudgetPolicy`、`ExecutionBudgetExceeded`；本局的 `battle.executionBudget`                                                                        |

这是现有实现的统一入口；可直接阅读 [官方效果](../../packs/base/src/effects/)，使用相同的领域方法。`CodeEffectModule` 和 `CodeEffectModuleContext` 定义模块签名，`EffectSdk` 是注入对象的类型；旧 `NpmEffectModuleContext` 类型名仍兼容。

## 上下文和执行顺序

`context.source` 是当前技能或印记实例，`context.parent` 是当前触发对应的真实事件，`context.battle` 是本局。比如 `OnHit` 的 parent 是 `UseSkillContext`，`OnDamage` 是 `DamageContext`。多个触发用 `context.trigger` 缩窄类型。

触发收集会遍历相关来源。声明 `OnHit` 本身不意味着只有该来源使用技能时才运行，示例通过 `context.source === context.parent.skill` 明确这一条件。印记若监听持有者出招，需比较 `source.owner` 和事件的 `pet`。嵌套伤害的直接父事件不一定是技能，应遍历祖先，或使用已有上下文查询工具。

`when` 在收集时执行，按优先级结算前还会触发 `BeforeEffect`。`apply` 应重新读取可能变化的 HP、目标、归属或印记状态。回调同步执行；顺序、分支、循环和复用直接使用 TypeScript。原生领域方法保留原有检查；操作其他对局的对象需要作者自行避免，选择器工具的跨局写入校验并不覆盖任意直接调用。

## 身份、参数和持久状态

- `id(localId)` 是 namespace 下稳定的导出 ID。文件名和 npm 包名不替代内容身份。
- 内容的 `useId` 决定每次使用的编译身份，运行时在 `context.effect.id` 取得；同一导出的多次使用互不共用参数地址。
- `context.source.id` 区分本局的来源实例。跨回合状态保存于引擎实例、配置或支持恢复的属性贡献中。模块变量和回调闭包不作为对局存档。
- 可修改参数用现有 `numberParam` 等声明在 `parameters` 中。原生回调通过 `context.battle.configSystem.get(parameterAddress(context.effect!.id, 'parameters', 'amount'), context.source)` 读取当前来源作用域；检查返回值类型。持续跟随参数可使用现有 `amount.follow(...)` 与绑定工具。

随机值使用 `context.battle.random()`、`randomInt(min, max)` 或 `shuffle`，复用本局 RNG；`randomInt` 包含两端。不要使用模块共享 RNG、`Math.random` 或时间决定战斗结果。持续刷新不得重复抽样；需要保存的随机结果应进入引擎支持的持久状态。

## 属性贡献与清理

原生贡献示例见 [native-effects.ts](../../examples/ugc/native-effects.ts)：用 `Modifier(DurationType.binding, ..., source)` 关联来源，通过 `projectValue` 跟随印记层数，并把 `addModifier` 返回的清理函数交给来源印记。这样沿用既有抑制、销毁和快照支持。

需要随印记转移到新持有者的贡献，声明 `rebindOnOwnerTransfer: true`，并设置 `modifier.followsMarkOwner = true`。初始化只允许无条件、无层数消费的 `OnMarkCreated`，内容必须是可重建的属性贡献，避免混入治疗、抽样或加印记等一次性动作。普通目标绑定沿用原语义。

`projectValue` 使用内核已有的可恢复计算描述。任意 `derived(() => ...)` 闭包和临时订阅并不自动具备持久恢复能力；复杂捕获、跟随和缺失输入行为参见 [效果编写](effect-authoring.md)。

快照只支持既有普通选择、强制／奖励换宠和队伍预选等待点。恢复须提供匹配的内容、代码与构建，以及原有参数和绑定工厂；不保存任意函数，不扩展到阶段中断点。

## 执行预算与失败

递归派发共享同一 root 的深度和计数；同回合累计预算跨 root 保留，支持的等待点快照保留累计计数。一次编译后的 SDK 效果回调计一项 action。选择器 apply、sequence 的每个子动作、choose 的选中分支和 frame 的伤害修改操作也计费；这些嵌套开销累加。即时值读取和受计费的持续计划使用 computation 计数。具体限额来自 `executionBudgetPolicy`，由宿主决定。

预算耗尽锁存本局的 `ExecutionBudgetExceeded`，停止计时、释放等待并阻止继续进入引擎结算；捕获异常、消息监听器重入或 skipOnError 不重置预算。它不选择胜负，也不回滚此前操作。普通条件错误跳过该次收集；普通 apply 错误产生 `EffectApplyFail` 并按既有规则继续，已有副作用不回滚。

计数覆盖引擎入口和已计费工具调用。直接领域方法中的全部计算、独立注册的底层 Effect 回调、任意 JS 循环、闭包计算和外部 I/O 不因此自动受逐步计费或抢占。获准的 npm 代码仍在 Node 宿主中执行；不可信代码的进程终止和系统资源边界由 #218 负责。

核心／SDK 的构建身份保留，内容元数据、依赖图和策略参与环境身份；本地代码不做逐文件摘要准入，相同元数据不证明代码语义相同。版本更新准备新环境，活动对局保留原环境。见 [npm 环境生命周期](npm-content.md#环境生命周期)。

## 可运行示例和验证

- [原生回调与属性贡献](../../examples/ugc/native-effects.ts)：使用本局随机治疗、层数贡献和来源清理。[真实 Node 引擎测试](../../packages/battle/test/v4/effect-sdk-native.test.ts)覆盖重复使用、双局隔离、抑制、转移、移除和 JSON 等待点恢复。
- [slow npm 包](../../examples/ugc/slow)：原生 OnHit 回调加印记，现有绑定 API 跟随运行时参数；实际打包、安装和试打测试覆盖命中／未命中、刷新、到期与恢复。
- [类型验证](../../packages/battle/design/effect-authoring/type-tests.ts)：事件类型推导、多触发缩窄及错误用法；[预算测试](../../packages/battle/test/v4/execution-budget.test.ts)验证递归、重入、累计限额和失败。

```sh
pnpm typecheck:battle-v4
pnpm typecheck:effect-authoring-design
pnpm test:battle-v4
pnpm --filter @arcadia-eternity/pack-loader test:run
pnpm exec tsc -p examples/ugc/slow/tsconfig.json
node --test examples/ugc/slow/test/slow.test.mjs
```

本地 SDK 物料仍用 `node scripts/stage-author-sdk.mjs /absolute/new-directory` 生成，先构建依赖包。同宿主构建的包和类型一起安装，清单记录 SDK API 版本、核心／SDK 构建身份和各包产物哈希，用于核对物料；本工具不发布 npm，也不声明已完成正式发行。
