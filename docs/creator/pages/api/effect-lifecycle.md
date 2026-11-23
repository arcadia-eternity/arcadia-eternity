在 `src/effects/*.effect.ts` 中从 `@arcadia-eternity/content-sdk` 导入 `effect`、`on` 和所需类型。先说清楚机制响应哪件事、哪一个来源、哪一个目标，再选择触发点。

| 机制意图                     | 触发点                                                | `context.parent`                                            |
| ---------------------------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| 这招命中或未命中时追加效果   | `OnHit`、`OnMiss`                                     | `UseSkillContext`，可取 `skill` 与 `actualTarget`           |
| 伤害数值处理、读取结算结果   | `OnDamage`、`PostDamage`                              | `DamageContext`                                             |
| 治疗前调整、治疗响应         | `OnBeforeHeal`、`OnHeal`                              | `HealContext`                                               |
| 印记创建、销毁、持续时间结束 | `OnMarkCreated`、`OnMarkDestroy`、`OnMarkDurationEnd` | 分别为 `AddMarkContext`、`RemoveMarkContext`、`TurnContext` |
| 回合开始或结束               | `TurnStart`、`TurnEnd`                                | `TurnContext`                                               |
| 进场或离场                   | `OnSwitchIn`、`OnSwitchOut`                           | `SwitchPetContext`                                          |

## 从一次事件找到自己的来源

技能和印记都可能监听同一时机。技能只在自己命中时生效，用 `context.source === context.parent.skill` 筛选。若印记响应持有者出招，应比较持有者与本次事件的行动者。`NativeEffectContext<T>` 会按触发点推导父上下文，`context.battle` 指向当前对局。[霜击的完整回调](./on-hit.md)

## 例子：命中后给自己回复体力

把下面的类放入 `src/effects/heal-on-hit.effect.ts`。在需使用它的技能上新增一个独立的 `useId`，让 `definitionId.$ref` 指向本项目的 `behavior/heal-on-hit`，写法见[技能定义](./skill-behaviors.md)。

```ts
import { effect, on, EffectTrigger, Pet, HealContext, type NativeEffectContext } from '@arcadia-eternity/content-sdk'

@effect({ id: 'heal-on-hit', sourceKind: 'skill' })
export class HealOnHit {
  @on(EffectTrigger.OnHit)
  static apply(context: NativeEffectContext<EffectTrigger.OnHit>) {
    if (context.source !== context.parent.skill) return
    const owner = context.source.owner
    if (owner instanceof Pet) owner.heal(new HealContext(context, context.source, owner, 20))
  }
}
```

测试时先让使用者损失超过 20 点体力，再触发一次命中，核对使用者增加了 20 点、对手没有获得这次治疗。另建未命中场景，预期体力不变。满体力精灵会掩盖这个例子的效果。
