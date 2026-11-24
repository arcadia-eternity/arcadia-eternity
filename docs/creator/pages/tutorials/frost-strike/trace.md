用项目队伍 `blue` 和 `orange` 开始试玩。蓝队先使用霜击，再连续使用轻触。记下对手获得减速后的速度，以及印记消失后的速度。后面用相同队伍和等级比较改动。

## 从技能找到效果

在工作台搜索「霜击」，打开技能的 `behaviors`，沿 `definitionId` 找到 `apply-slow`。打开 `src/effects/slow.effect.ts`：

<<< src/effects/slow.effect.ts#apply-slow

命中回调先比较效果来源与本次使用的技能，再取实际目标。目标存在时，`ops.addMark` 把本包的 `slow` 印记加到对手身上。[查看 OnHit 的触发时机](/sdk/triggers/OnHit) · [查看 addMark 的参数](/sdk/values/ops/addMark)

## 找到控制持续时间的文件

打开 `data/marks/slow.yaml`。其中的 `config.duration` 决定计时起点，印记上的 `speed-penalty` 行为负责把速度降低 25 点。印记离开时，这个修正也会移除。[查看速度绑定](../../api/bind-attribute.md)
