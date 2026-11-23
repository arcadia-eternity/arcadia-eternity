一条可重复的测试应同时给出初始条件、行动和预期状态。霜击适合从三个条件入手：未命中、第一次命中、已有减速时再次命中。试玩检查画面和操作，场景测试检查命中结算瞬间的数值。

## 在模板现有的测试里加断言

打开 `test/pack.test.mjs`。模板在 `before` 中调用 `prepareContentPack()`，把构建后的包作为安装内容准备好。下面的用例可以追加到该文件，复用已有导入和 `example`。它在模板默认的两回合减速上验证速度降幅，与持续时间的具体取值无关。

```js
test('连续命中只扣一次速度', async () => {
  const battle = await example.createBattle()
  const target = battle.playerB.activePet
  const speed = target.stat.spe

  battle.applyEffects(attack(battle), EffectTrigger.OnMiss)
  assert.equal(target.stat.spe, speed)

  battle.applyEffects(attack(battle), EffectTrigger.OnHit)
  battle.applyEffects(attack(battle), EffectTrigger.OnHit)
  assert.equal(target.marks.length, 1)
  assert.equal(target.marks[0].stack, 1)
  assert.equal(target.stat.spe, speed - 25)
})
```

`attack(battle)` 取蓝队首发的第一招并设置实际目标，所以保持霜击在第一格。这个用例直接派发命中事件；若要验证命中判定、整回合结算或手动选择，再用固定种子开一场完整对战。

## 运行并读结果

从项目的上级目录运行：

```sh
arcadia-content workspace frost-pack check
arcadia-content workspace frost-pack test --execute
```

工作台中也可运行「场景测试」，助手使用 `test_start` 与 `job_get`。断言失败时，先核对观察时点。例如回合末减过一次的持续时间，与刚刚施加时的初值相差 1。检查过期任务的 `sourceRevision`，保存修改后重新测试。

## 扩展到整个生命周期

| 情况       | 设置                                 | 观察结果                                     |
| ---------- | ------------------------------------ | -------------------------------------------- |
| 再次施加   | 把已有印记设为只剩一回合，然后命中   | 剩余回合回到初值，层数和速度降幅不变         |
| 参数变化   | 针对这枚印记调整 `amount`            | 当前目标速度随参数变化，另一局的精灵不受影响 |
| 移除与恢复 | 等待点保存、恢复，连续使用轻触至到期 | 计时继续，最后恢复原速度                     |

需要助手实际出招时，见[固定种子试战的工具顺序](../api/battle-test.md)。
