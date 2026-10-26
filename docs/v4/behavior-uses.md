# 可复用行为与独立使用

行为定义（`BehaviorDefinition`）保存可复用规则或可信原生导出的引用。技能、印记上的行为使用（`BehaviorUse`）保存稳定 `useId`、`definitionId` 和自己的 `params`。同一个定义可以使用多次，每次使用独立编译为既有 Effect，继续使用现有 Battle、参数作用域和快照机制。

这是 [#241](https://github.com/arcadia-eternity/arcadia-eternity/issues/241) 的底层接口。完整作品版本、依赖锁定和跨宿主环境身份分别由 #243、#244 实现；编辑器、持久存储和房间协议消费这些接口。

普通 UGC 使用基础包的 [官方效果模板目录](ugc-effect-catalog.md)，只选择、配置和组合已安装的原生能力。`createOfficialContent` 已拒绝普通数据规则；下文的规则示例是底层兼容接口，不是玩家编辑器方案。

## 数据与装配

`createContentCatalog` 的 `ContentPrototypeData.behaviors` 保存定义数组；技能和印记元数据中的 `behaviors` 保存使用数组。原有 `effect: string[]` 继续引用静态效果。目录列表按 `effect`、`behaviors` 的顺序装配，实际执行仍遵循既有优先级，同优先级保持列表顺序。行为使用不能再次通过 `effect` 引用，也不能挂到另一拥有者上。

```ts
const definition = {
  formatVersion: 1,
  id: 'demo/heal',
  sourceKind: 'skill',
  parameters: { amount: { kind: 'number', default: 10, minimum: 0, maximum: 100 } },
  implementation: {
    kind: 'rule',
    rule: {
      formatVersion: 1,
      id: 'demo/heal-rule',
      parameters: { amount: { nodeId: 'amount', kind: 'number', value: 10 } },
      trigger: { nodeId: 'hit', id: 'core.selfSkillHit' },
      actions: [{ stepId: 'heal', id: 'core.healOwner', params: { amount: { parameter: 'amount' } } }],
    },
  },
}

// 放入某个技能的 behaviors 字段。
const uses = [
  { useId: 'first', definitionId: 'demo/heal', params: { amount: 10 } },
  { useId: 'second', definitionId: 'demo/heal', params: { amount: 20 } },
]
```

公开参数名对应规则的参数名；没有公开的参数仍可在规则内部使用，但不能通过 `params` 改写。公开合同支持有限的数字范围、整数、布尔和字符串枚举／长度，拒绝未知字段和非法默认值。约束同时进入运行参数目录，后续 `set` 和有效值读取仍检查范围。

`behaviorEffectId({ kind, id }, useId)` 生成运行身份，拥有者类型参与编码。修改参数、调整动作顺序或保存重读均不改变使用身份；复制使用必须分配新 `useId`。参数值、捕获结果、层数和持续贡献属于每场战斗的具体技能／印记实例，定义只保存静态合同。

目录先检查全部使用和数据规则，再调用可信原生构建函数。`BehaviorCompilationError.diagnostics` 提供拥有者 `contentId`、`useId`、字段及规则节点定位。草稿层可以保留未完成内容；运行目录要求完整校验通过。

## 可信原生导出

宿主通过 `defineNativeBehavior` 注册导出，并在 `createContentCatalog(data, revision, legacyFactory, packs, { nativeExports })` 中提供。普通数据定义使用 `{ kind: 'native', exportId }` 引用它，且公开参数合同必须与注册导出一致。默认受控规则注册表可以通过同一选项中的 `registry` 替换。

需要引用本次装配的印记时，第五个参数也可传入可信注册工厂 `({ marks, skillIds }) => ({ registry, nativeExports })`。它在印记分配后运行，规则能力与原生导出因此使用同一份正式 `BaseMark`；工厂不能由导入数据指定。目录仍先校验所有行为使用和规则，再执行原生行为的 `build`。

```ts
const native = defineNativeBehavior({
  id: 'trusted/heal',
  sourceKind: 'skill',
  parameters: { amount: { kind: 'number', default: 10, minimum: 0, maximum: 100 } },
  build({ effectId, params }) {
    const amount = numberParam({ default: params.amount as number })
    return defineEffect({
      id: effectId,
      on: 'OnHit',
      parameters: { amount },
      when: conditions.selfUsesSkill,
      execute: targets.ownerPet.apply(ops.heal(amount)),
    })
  },
})
```

`build` 每次创建新的作者定义和参数／绑定计划，使用传入的 `effectId`。统一编译层绑定来源、重建参数地址和快照注册；返回已经编译的静态 Effect 会被拒绝。新行为使用拒绝 `legacyAliases`，参数通过使用身份和参数名定位；原有官方效果的别名行为保持。

`compileBehaviorUse` 可用于单次编译，返回效果、参数目录及公开参数地址。批量候选可先 `normalizeBehaviorDefinitions`、`normalizeBehaviorUses`、`validateBehaviorUse`，再调用 `compilePreparedBehaviorUse`。可信构建函数由宿主维护和准入，数据不能携带函数或伪造注册导出。

字符串参数可声明 `reference: "mark" | "skill"`；目录先检查它属于对应内容集合，再执行构建器。单独调用 `compileBehaviorUse` 时必须提供 `references`。`static: true` 参数以及所有内容引用在编译后成为单值合同，运行时不能改变结构选择；修改这些值需重新装配内容。

## 封装、展开与复制

- `encapsulateRule` 将未绑定拥有者的规则封装成行为定义，并声明公开参数子集。可复用定义不能固定 `sourceMarkId`，实际印记来源在使用时绑定。
- `copyBehaviorUse` 生成新使用身份，`copyBehaviorDefinition` 生成新定义身份；规则内部节点和共享参数连接保持，外部引用不自动改写。
- `expandBehaviorUse` 返回独立的 `expandedDefinition` 和 `expandedUse`，保存时应保存两者。局部节点、共享参数扇出和参数范围保留，副本不再跟随上游定义。返回的编译后 `rule` 是执行产物，单独保存它不能代表完整公开参数合同。
- 展开保留原使用位置的 `useId`；需要并列两次使用时先复制使用。原生导出不可展开，任意 TS 闭包中的硬编码引用也不能自动改写。

## 验证

`behavior-contracts.test.ts` 验证数据合同、复制／展开及参数限制；`behavior-catalog-validation.test.ts` 验证正式目录拒绝错误输入。`behavior-uses.test.ts` 经过保存重读、正式目录和真实 Battle，验证两次 10/20 恢复、两个印记来源、参数与持续绑定隔离，以及初始／行动等待点恢复。

`pnpm verify:battle-v4-behaviors` 分别构建 Node 和压缩浏览器产物，在真实 Chrome 中运行同一数据，并双向交换 JSON 快照，以新编译的工厂比较状态、效果顺序和 RNG。现有等待点恢复范围保持。
