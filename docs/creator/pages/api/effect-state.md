机制数据应跟随它的拥有者。「这只精灵在本局叠了几层」属于精灵或印记实例；「这个效果基础减速多少」是效果参数；「这一次出招打到了谁」只在当前回调里读取。

| 需要保存什么           | SDK 入口                                                            | 例子                                       |
| ---------------------- | ------------------------------------------------------------------- | ------------------------------------------ |
| 可由其他机制调节的数值 | `numberParam`、`parameterAddress`                                   | 霜击默认 −25，可针对这枚印记调整           |
| 参数变化时同步更新属性 | `amount.follow(...)`、`ops.bindAttribute`                           | 印记被移除时，速度恢复                     |
| 两次触发之间的计数     | `defineEffectState`、`getEffectState`、`context.ops.setEffectState` | 同一技能实例已经命中过几次                 |
| 可复现的随机选择       | `context.read(values.randomInt(min, max))`                          | 同一固定种子和输入可以复现，区间两端都包含 |

## 计数归谁

在效果的 `static create({ sdk, id })` 中声明一个数值状态字段，再在命中回调中，对本局的来源实例读写。下面两个片段分别位于创建定义和执行回调的位置：

```ts
const hits = sdk.defineEffectState({ id: id('hit-count'), type: 'number', default: 0 })
```

```ts
const skill = context.parent.skill
const previous = context.getEffectState(skill, hits)
context.ops.setEffectState(skill, hits, previous + 1)
```

用两个独立对局验证隔离：在第一局连续命中两次，第二局的同名技能仍从零开始。还需要支持存档时，在等待输入的位置保存并恢复，再触发一次，核对计数继续增长。模块变量、类静态计数器和长期保存的回调上下文无法表达这种实例归属。

要验证印记参数和快照恢复，可直接对照[模板的场景测试](../test/scenarios.md)。
