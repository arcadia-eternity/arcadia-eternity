# Effect SDK：使用现有战斗 API 编写 TypeScript 效果

从 `@arcadia-eternity/content-sdk` 导入装饰器和效果类型，在 `src/effects/*.effect.ts` 中声明效果。效果接口版本通过 `arcadia.sdkApi: 4` 声明。npm 效果由 [Arena / Comlink 宿主](effect-sandbox.md) 执行，沙箱开放明确允许的效果能力。

从 API 3 迁移时，将直接调用阶段函数的代码改为在当前回调执行 `ops`，再将内容包的 `arcadia.sdkApi` 更新到 `4` 并重新构建。

## 从一个效果开始

```ts
import {
  effect,
  on,
  EffectTrigger,
  conditions,
  targets,
  ops,
  type NativeEffectContext,
} from '@arcadia-eternity/content-sdk'

@effect({ id: 'heal-on-hit', sourceKind: 'skill' })
export class HealOnHit {
  @on(EffectTrigger.OnHit)
  static apply(context: NativeEffectContext<EffectTrigger.OnHit>) {
    if (conditions.selfUsesSkill(context)) targets.ownerPet.apply(ops.heal(20))(context)
  }
}
```

`@on` 的静态方法收到与 `defineEffect` 相同的效果上下文。需要参数或绑定时，可在装饰类的 `static create(context)` 中返回 `defineCodeEffect`。见 [slow 示例](../../examples/ugc/slow/src/effects/slow.effect.ts)。

在技能或印记的 `behaviors` 中通过独立 `useId` 引用效果 ID。SDK 从 `effectSources` 指定的目录发现装饰类，构建 `effectArtifact`；加载器在准入后读取产物，检查实际效果是否适用于引用它的对象。未被内容引用的效果不会注册。完整格式见 [npm 内容包](npm-content.md)。

基础包用 `defineEffects` 编译固定效果，由 `@effectGroup` 汇总。普通 npm 内容包使用 `@effect` 与 `@on`。两种写法均通过 `ops` 提交战斗操作。

## 事件与操作

`context.parent` 提供当前触发事件的只读字段。多触发回调用 `context.trigger` 缩窄类型。条件收集与结算之间可能发生其他效果，需要最新目标或数值时，在执行操作时重新读取。伤害提交与结果的时机见[伤害结算](damage-resolution.md)。

| 用途                         | SDK                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------ |
| 确认本技能出招、取得实际目标 | `conditions.selfUsesSkill(context)`、`context.parent.actualTarget`                               |
| 定量伤害与治疗               | `ops.dealDamage(amount)`、`ops.heal(amount)`                                                     |
| 怒气变化                     | `ops.addRage(amount)`、`ops.reduceRage(amount)`                                                  |
| 印记生命周期                 | `ops.addMark(mark)`、`ops.removeMark()`、`ops.consumeStacks(amount)`、`ops.transferMarks(marks)` |
| 当前伤害提案                 | `context.ops.modifyDamage(event, { percent, delta })`                                            |
| 读取参数、抽样               | `context.read(params.amount)`、`context.read(values.randomInt(min, max))`                        |

选择器可以直接执行操作，例如 `targets.ownerPet.apply(ops.heal(20))(context)`。已有目标时，可写 `ops.heal(20)(context, [target])`。随机整数使用本局 RNG，包含两个端点。

### 状态归属与引用生命周期

Effect 保存逻辑和不可变定义；影响后续触发结果的可变状态归属于本局实体。此合同统一适用于官方与 UGC 效果、开发、本地和服务端执行。

- 普通函数、闭包、不可变配置和单次调用内的局部变量可以正常使用。
- 跨触发的计数、历史目标、已使用标记、阶段进度和抽样结果，必须通过引擎支持的状态接口保存。按语义归属技能实例、印记实例、精灵、玩家或 Battle，并由引擎管理清理、转移和快照恢复。
- 模块变量、工厂闭包、对象或函数属性、类静态字段、Map/WeakMap 等作者私有容器，不得保存这类状态。`const` 声明不代表引用的对象不可变。
- `context`、`context.parent`、辅助 frame 及其操作能力仅用于当前同步回调。不得将它们保存到外层变量、返回的延迟回调或异步任务中供以后使用。
- 后续触发应从新的上下文重新取得来源和目标。需要持续追踪或捕获实体时，使用 SDK 管理的绑定和稳定引用；不要自行在长驻逻辑中保存本局领域对象。不可变内容定义和 SDK 声明句柄可以按各自合同复用。

作者不能依赖模块或工厂只执行一次、每局重新执行、某个包独占 VM，或 Worker 的创建与复用顺序来决定战斗结果。相同内容、输入、引擎状态和 RNG 应产生相同结果，与作者模块之前处理过哪些对局无关。

这是作者编程合同。项目不支持隐藏状态的保存、恢复或重置，不将禁止全部闭包或静态证明任意 TypeScript 无状态作为准入要求；现有编译和运行检查不保证识别全部违规写法。通过加载或一次试打不代表符合此合同。

### 自定义实体状态

用 `defineEffectState` 声明不可变字段，通过当前回调和所属实体读写。下例在技能实例上记录命中次数；装饰类只保存字段定义：

```ts
@effect({ id: 'hit-counter', sourceKind: 'skill' })
export class HitCounter {
  static create({ sdk, id }: EffectModuleContext) {
    const hits = sdk.defineEffectState({ id: id('hit-count'), type: 'number', default: 0 })
    return sdk.defineCodeEffect({
      id: id('hit-counter'),
      sourceKind: 'skill',
      triggers: [sdk.EffectTrigger.OnHit],
      when: sdk.conditions.selfUsesSkill,
      apply(context) {
        const skill = context.parent.skill
        const previous = context.getEffectState(skill, hits)
        context.ops.setEffectState(skill, hits, previous + 1)
      },
    })
  }
}
```

字段 ID 使用包命名空间，例如 `id('hit-count')`。同一实体上的同一 ID 指向同一个字段；不同实体互不共享，不继承持有者或 Battle 的值，也不参与参数修饰器计算。同一 ID 的类型和默认值必须一致，快照恢复后仍检查这一约束。

状态支持有限数值、布尔值和最多 16,384 个 UTF-16 代码单元的字符串。对象、函数和实体引用不能作为字段值；持续实体引用使用既有绑定 API。读写通过当前回调访问属于本局的 Battle、玩家、精灵、技能或印记。实体随等待点快照一起保存和恢复，下一局重新使用默认值。

印记创建回调可以初始化该印记的状态。原实例转移时状态随实例保留；被合并吸收、覆盖或销毁的印记释放其状态，不自动合并双方的自定义字段。其他实体状态保留至实体所属对局清理。不能通过随意挂字段或闭包变量绕过这些生命周期。

## 属性贡献与清理

使用 `ops.bindAttribute` 声明属性贡献，通过 `lifetime: 'sourceMark'` 指定印记生命周期，通过 `follow` 跟随层数或参数。需随印记转移时，在创建定义中指定 `rebindOnOwnerTransfer: true`。完整示例见 [native-effects.ts](../../examples/ugc/native-effects.ts)。

快照只支持既有普通选择、强制／奖励换宠和队伍预选等待点。恢复须提供匹配的内容、代码与构建，以及原有参数和绑定工厂；不保存任意函数，不扩展到阶段中断点。

## 执行预算与失败

递归派发共享同一 root 的深度和计数；同回合累计预算跨 root 保留，支持的等待点快照保留累计计数。一次编译后的 SDK 效果回调计一项 action。选择器 apply、sequence 的每个子动作、choose 的选中分支和 frame 的伤害修改操作也计费；这些嵌套开销累加。即时值读取和受计费的持续计划使用 computation 计数。具体限额来自 `executionBudgetPolicy`，由宿主决定。

预算耗尽锁存本局的 `ExecutionBudgetExceeded`，停止计时、释放等待并阻止继续进入引擎结算；捕获异常、消息监听器重入或 skipOnError 不重置预算。它不选择胜负，也不回滚此前操作。普通条件错误跳过该次收集；普通 apply 错误产生 `EffectApplyFail` 并按既有规则继续，已有副作用不回滚。

计数覆盖引擎入口和已计费工具调用。任意 JS 循环和外部 I/O 不因此自动受逐步计费或抢占。npm 作者代码运行于宿主按包或按环境分组的 Arena VM；局级 Worker 看门狗、VM 执行限额和故障锁存另见 [沙箱执行宿主](effect-sandbox.md)。

核心／SDK 的构建身份保留，内容元数据、依赖图和策略参与环境身份；本地代码不做逐文件摘要准入，相同元数据不证明代码语义相同。版本更新准备新环境，活动对局保留原环境。见 [npm 环境生命周期](npm-content.md#环境生命周期)。

## 可运行示例和验证

- [原生回调与属性贡献](../../examples/ugc/native-effects.ts)：使用本局随机治疗、层数贡献和来源清理。[真实 Node 引擎测试](../../packages/battle/test/engine/effect-sdk-native.test.ts)覆盖重复使用、双局隔离、抑制、转移、移除和 JSON 等待点恢复。
- [slow npm 包](../../examples/ugc/slow)：原生 OnHit 回调加印记，现有绑定 API 跟随运行时参数；实际打包、安装和试打测试覆盖命中／未命中、刷新、到期与恢复。
- [类型验证](../../packages/battle/design/effect-authoring/type-tests.ts)：事件类型推导、多触发缩窄及错误用法；[预算测试](../../packages/battle/test/engine/execution-budget.test.ts)验证递归、重入、累计限额和失败。

```sh
pnpm typecheck:battle
pnpm typecheck:effect-authoring-design
pnpm test:battle
pnpm --filter @arcadia-eternity/pack-loader test:run
pnpm --dir examples/ugc/slow build
node --test examples/ugc/slow/test/slow.test.mjs
```

本地 SDK 物料仍用 `node scripts/stage-author-sdk.mjs /absolute/new-directory` 生成，先构建依赖包。同宿主构建的包和类型一起安装，清单记录 SDK API 版本、核心／SDK 构建标识；安装时检查所需包与 API 版本；本工具不发布 npm，也不声明已完成正式发行。
