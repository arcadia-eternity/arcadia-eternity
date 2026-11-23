**导入入口**　`@arcadia-eternity/content-sdk`，适用于印记效果。

在 `EffectTrigger.OnMarkCreated` 时，用 `targets.ownerPet` 选中印记持有者。`ops.bindAttribute` 将变化量绑定到其属性；霜击模板把 `spe` 的 `delta` 绑定到数值参数 `amount`，默认值为 −25。

## 调用签名

```ts
bindAttribute: (options: AttributeBindingOptions<keyof PetAttributes>) => Operator<Pet>
```

将返回的操作传给 `targets.ownerPet.apply(...)`，由回调为本次印记的持有者建立绑定。

<<< src/effects/slow.effect.ts#speed-penalty

`amount.follow(...)` 让属性变化量跟随该参数。`lifetime: 'sourceMark'` 让贡献跟随印记的生命周期，印记到期或被移除后速度恢复。`rebindOnOwnerTransfer` 使贡献随印记转移到新的持有者。

[刷新印记](./mark-duration.md)会延长这项贡献的持续时间。要把霜击延长一回合，只改印记的 `duration` 即可。
