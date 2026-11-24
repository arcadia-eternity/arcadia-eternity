**导入入口**　`@arcadia-eternity/content-sdk`，适用于内容包技能效果。

`@on(EffectTrigger.OnHit)` 监听技能命中。`NativeEffectContext<EffectTrigger.OnHit>` 的 `parent` 是本次出招的 `UseSkillContext`，`parent.actualTarget` 是实际目标。触发收集会遍历相关来源，因此用 `context.source === context.parent.skill` 判断这次命中是否来自绑定该效果的技能。

## 常用签名

`addMark(context: AddMarkContext)` 返回 `"parameter-conflict" | undefined`。参数冲突时可检查该返回值。实际目标的类型为 `Pet | undefined`，应在施加印记前判断。

## 给实际目标加印记

<<< src/effects/slow.effect.ts#apply-slow

`content.id('slow')` 按当前包的命名空间解析印记 ID。`addMark` 接受一个 `AddMarkContext`；这里传入当前效果上下文、实际目标和印记定义。省略持续时间时取[印记配置](./mark-duration.md)。如果攻击未命中，这个命中回调不会执行。

[查触发时机与上下文字段](/sdk/triggers/OnHit) · [查 addMark 签名](/sdk/functions/addMark)
