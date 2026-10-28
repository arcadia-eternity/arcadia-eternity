# 可复用行为与独立使用

普通 UGC 用于内容创作：玩家编辑精灵、技能和印记，选择、配置并组合已安装且获准使用的效果模板。新机制由专业作者使用 TypeScript 实现，再通过可信构建与安装流程公开为模板。通用 Rule Graph、规则预设展开和节点编程不属于当前玩家创作方案。

本文说明 [#241](https://github.com/arcadia-eternity/arcadia-eternity/issues/241) 保留的行为复用合同。实际模板见[官方效果模板目录](ugc-effect-catalog.md)，作品身份、引用、发布与宿主接入见[UGC 作品](ugc-works.md)，可信实现见[TypeScript 效果编写](effect-authoring.md)。

## 定义、导出与使用

| 对象                   | 职责                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `NativeBehaviorExport` | 宿主注册的可信 TS 构建器，声明适用来源和公开参数合同，创建效果实现。                                                   |
| `BehaviorDefinition`   | 可复用行为的静态数据合同；当前作品使用 `{ kind: 'native', exportId }` 指向已安装且获准的导出，参数合同必须与导出一致。 |
| `BehaviorUse`          | 技能或印记上的一次使用，保存稳定 `useId`、`definitionId` 和独立 `params`。同一定义可以使用多次。                       |

普通玩家使用现有模板时，只需保存行为使用，不需要重新声明模板定义或编写实现。例如，以下是同一技能 `behaviors` 字段中的两次独立治疗配置：

```json
[
  {
    "useId": "first",
    "definitionId": "base/template/heal-fixed",
    "params": { "amount": 10 }
  },
  {
    "useId": "second",
    "definitionId": "base/template/heal-fixed",
    "params": { "amount": 20 }
  }
]
```

`heal-fixed` 固定在本技能命中后通过正常治疗流程恢复自身生命。这里分别请求治疗 10 和 20，实际生命变化仍由治疗上下文、生命上限等战斗语义决定。修改一份配置不会改变另一份，也不会修改模板定义。

公开参数支持数字范围、整数、布尔和字符串枚举／长度等约束，拒绝未知参数及非法默认值。省略的参数按模板合同补默认值；未完成草稿可保存，但生成固定版本或试玩必须通过完整校验。运行参数目录继续校验允许变化的参数值。

## 装配、顺序与实例隔离

底层 `createContentCatalog` 的 `ContentPrototypeData.behaviors` 保存行为定义；技能和印记元数据的 `behaviors` 保存使用数组。原有 `effect: string[]` 继续引用静态效果。目录按 `effect`、`behaviors` 的顺序装配，实际执行仍遵循既有优先级，同优先级保持列表顺序。组合顺序不能覆盖模板自身的事件与来源条件。

每次使用独立编译为既有 Effect。生成的行为效果不能再通过 `effect` 重复引用，也不能挂到另一拥有者上。多个使用之间没有隐式参数共享或任意数据流连接；读取结算伤害等上下文的能力由模板实现明确提供。

`behaviorEffectId({ kind, id }, useId)` 从拥有者类型、运行 ID 和 useId 生成效果身份。同一拥有者下修改参数、调整使用列表顺序或保存重读不改变该身份；复制使用必须分配新 useId，移动到不同拥有者或修改作品 namespace 会改变运行身份。参数值、捕获结果、层数和持续贡献属于具体战斗实例，定义只保存静态合同。

目录先校验定义、所有行为使用、参数与引用，再执行可信原生构建器。`BehaviorCompilationError.diagnostics` 提供所属 `contentId`、`useId` 和字段位置。运行编译严格拒绝未知定义、来源不符、重复使用身份、非法参数及缺失引用。

## 作品引用与 namespace

作品源记录使用局部 ID；编译后的对象 ID 为 `namespace:id`，对象类型独立表达。projectId 是稳定作品身份，与 namespace 不同。已有官方模板仍保留 `base/template/*` 等 ID，不批量改名为新格式。

模板的字符串参数可以声明 `reference: 'mark' | 'skill'`。引用作品对象时，源参数使用结构化引用，例如“命中附加印记”模板的一次使用：

```json
{
  "useId": "apply-slow",
  "definitionId": "base/template/apply-mark-on-hit",
  "params": {
    "mark": {
      "$ref": { "projectId": "frost-project", "kind": "mark", "id": "slow" }
    },
    "target": "opponent",
    "chance": 30,
    "stacks": 1
  }
}
```

当选定作品 `frost-project` 的 namespace 为 `frost_pack` 时，作品编译器将该参数解析为 `frost_pack:slow`，再交给底层 BehaviorUse 编译。**上例是作品源数据，不能把 `$ref` 对象直接传给只接受标量参数的底层 `compileBehaviorUse`。** 跨作品引用必须声明直接依赖的精确版本和摘要；普通字符串引用仅用于官方目录。

目录检查引用属于本次装配的对应内容集合，构建器使用正式印记原型。单独调用 `compileBehaviorUse` 时必须提供其引用校验所需的 `references`。声明 `static: true` 的参数以及所有内容引用在编译后成为单值合同；改变结构选择或引用需要重新装配，不能在战斗中改成另一个对象。

## 可信 TS 导出

宿主通过 `defineNativeBehavior` 注册可信实现，并向 `createContentCatalog(data, revision, legacyFactory, { nativeExports })` 提供导出。以下是开发者侧的治疗示例片段，相关 API 由 V4 内核及 authoring 入口提供；它不是作品文件中可上传执行的代码：

```ts
const native = defineNativeBehavior({
  id: 'trusted/heal',
  sourceKind: 'skill',
  parameters: { amount: { kind: 'number', default: 10, minimum: 0, maximum: 100 } },
  build({ effectId, params }) {
    const amount = numberParam({ default: params.amount as number })
    return defineEffect({
      id: effectId,
      triggers: [EffectTrigger.OnHit],
      parameters: { amount },
      when: conditions.selfUsesSkill,
      apply: targets.ownerPet.apply(ops.heal(amount)),
    })
  },
})
```

对应的数据定义使用 `implementation: { kind: 'native', exportId: 'trusted/heal' }`，声明与导出相同的 sourceKind 和 parameters。只有宿主已经安装并允许该导出时才能使用；写出 exportId 不会下载、安装或授权代码。

需要引用本次装配的印记时，目录第四个参数可以使用可信注册工厂 `({ marks, skillIds }) => ({ nativeExports })`。它在印记分配后运行，以便构建器引用同一份正式 BaseMark；导入数据不能指定这个工厂。

`build` 每次创建新的作者定义和参数／绑定计划，使用传入的 effectId。统一编译层绑定来源、建立参数地址与快照注册；返回已经编译的静态 Effect 会被拒绝。新行为使用拒绝 `legacyAliases`，参数通过使用身份和参数名定位；原有官方效果的别名行为保持。

`compileBehaviorUse` 可用于单次底层编译，返回效果、参数目录及公开参数地址。批量路径可先使用 `normalizeBehaviorDefinitions`、`normalizeBehaviorUses`、`validateBehaviorUse`，再调用 `compilePreparedBehaviorUse`。产品应通过作品编译及环境准备入口完成依赖、能力准入和身份校验，而不是仅凭一次底层编译成功就宣布可运行或可进入房间。

## 复制与原生能力边界

`copyBehaviorUse` 为一次使用生成新 useId；`copyBehaviorDefinition` 复制静态定义，不会复制或生成原生实现。作品 Fork 则由作品层生成新 projectId 和 namespace，改写显式内部引用、保留外部依赖。可信 TS 闭包中的硬编码引用无法自动改写，含自定义原生导出的作品不能宣称自动 Fork 成功。

行为定义仅接受原生导出。旧 Rule Graph、规则编译／封装／展开、能力注册表和独立规则包环境已移除；目录不再接受 compiledPacks 或规则 registry 参数。作品编译只允许已安装且获准的原生导出，普通基础包入口仍禁止替换官方模板。

目标选择、数值计算、捕获／跟随与持续绑定继续由可信 TS Authoring API 提供。普通玩家不需要通过展开模板来编辑这些实现细节。

## 验证与接入边界

- [模板合同测试](../../packages/battle/test/v4/official-template-contracts.test.ts)与[模板战斗测试](../../packages/battle/test/v4/official-template-behavior.test.ts)覆盖公开参数、实际印记引用、多个独立使用及贡献生命周期。
- [行为目录校验](../../packages/battle/test/v4/behavior-catalog-validation.test.ts)覆盖正式目录拒绝非法输入；[行为使用测试](../../packages/battle/test/v4/behavior-uses.test.ts)覆盖实例隔离与已有等待点恢复，使用可信原生行为。
- `pnpm verify:battle-v4-templates` 用 Node、压缩构建与真实 Chrome 验证原生模板及双向 JSON 恢复；`pnpm verify:battle-v4-behaviors` 验证原生行为的独立参数、印记绑定及初始／行动等待点恢复。宿主探针不代替完整作者产品验收。

作品编译、creator 试玩和 CLI 加载／replay 已接入。普通组队与本地对战入口、Electron 安装版、服务端批准环境目录及真实房间匹配仍见 #243/#244/#209/#224。完整 Mod 安装准入由 #218 跟踪。房间只校验事先具备的环境，不下载或同步作品。
