# 受控目标、取值与持续绑定

[#242](https://github.com/arcadia-eternity/arcadia-eternity/issues/242) 将一组有限的原生作者能力开放为可保存的数据规则。规则继续通过 `compileRule` 或[行为定义与使用](behavior-uses.md)进入正式内容目录；目标、取值和持续绑定编译为现有作者 API 的构件，执行和恢复由现有 Battle 负责。

## 保存格式与注册

规则可增加 `values` 数组。每个节点有稳定 `nodeId`、注册能力 `id`、有限 `params` 和命名 `inputs`。动作保留有序 `actions` 数组，并可使用相同的 `inputs` 引用：

- `{ node: 'defense' }` 引用本规则的值节点。
- `{ parameter: 'ratio' }` 引用本行为使用的公开或内部参数。
- `{ instanceParameter: 'bonus' }` 引用当前来源印记的已注册实例参数。

节点数组的排列不决定求值顺序；输入依赖决定编译关系，动作数组决定执行顺序。引用不能跨规则，节点必须唯一，循环、过深依赖与不匹配插槽会在运行前拒绝。复制规则保留局部节点和连接，由新行为使用身份隔离参数与绑定。

宿主使用 `defineRuleValue`、`defineRuleOperation` 注册可信实现，并传入 `CapabilityRegistry` 的 `values`、`operations`。`describeValues()` / `describeOperations()` 提供参数 schema、输入和结果类别、上下文要求、适用来源、缺失输入与时间策略。导入数据只能引用注册表中允许的 ID，不能声明执行函数或自行提升能力。

## 首批开放范围

以下名称均带 `core.` 前缀。

| 能力                                              | 输入与结果                | 语义                                                     |
| ------------------------------------------------- | ------------------------- | -------------------------------------------------------- |
| `ownerPet`、`opponentActive`、`sourceMark`        | 目标集合                  | 当前来源拥有者、对手出战位置、来源印记；缺失时为空集合。 |
| `firstPet`、`firstMark`                           | 集合 → 单个实体           | 每次读取选择首个对象；缺失值向下传播。                   |
| `petAttribute`、`markStack`                       | 实体 → 即时数字           | 精灵公开战斗属性或印记层数；选择实体与读取属性是两步。   |
| `number`、`multiply`                              | 常量、数字 × 数字         | 有限数字及乘法；保留左右读取顺序，拒绝非有限结果。       |
| `followPet/Mark/Number`、`capturePet/Mark/Number` | 即时值 → 持续计划         | 跟随当前输入，或在绑定生命周期内捕获。                   |
| `boundPetAttribute`、`boundMarkStack`             | 持续实体 → 持续数字       | 属性可跟随，或在绑定／输入代次内捕获。                   |
| `multiplyBinding`                                 | 两个持续数字 → 持续数字   | 保留两侧各自的捕获和跟随策略。                           |
| `dealDamage`                                      | 精灵集合、即时数字 → 动作 | 非负伤害经正式 `DamageContext`、伤害阶段和战斗事件结算。 |
| `bindAttribute`                                   | 精灵集合、持续数字 → 动作 | 安装归来源印记所有的属性贡献。                           |

持续节点和属性绑定仅向 `petMark` 来源开放。`bindAttribute` 要求 `lifetime: 'sourceMark'`、`missing: 'detach'`，支持 `delta`、`percent`、`override`，同一绑定重复安装可选择 `replace` 或 `append`。目标在安装动作执行时确定；这里的“跟随目标”描述值计划的输入，不表示贡献会自动搬到新目标。

印记创建沿用 `defineAddMarkAction` 和正式 `AddMarkContext`，可传入独立 `instanceParams`、层数和持续时间。可信注册工厂可通过 `createContentCatalog` 第五个参数取得本次装配的正式印记，供规则动作和等价原生导出共同引用。

瞬时数字、实体、集合和持续计划有不同插槽类别。首批不开放可写引用、任意对象路径、自由表达式、动态导入或任意事件；伤害能力不暴露直接改写 HP 的入口。

## 保存后的伤害规则

下面的规则读取对手当前防御，乘以本次行为使用的 `ratio`，再通过核心伤害路径结算：

```json
{
  "formatVersion": 1,
  "id": "demo/defense-damage",
  "parameters": {
    "ratio": { "nodeId": "ratio-param", "kind": "number", "value": 0.5 }
  },
  "trigger": { "nodeId": "hit", "id": "core.selfSkillHit" },
  "values": [
    { "nodeId": "opponents", "id": "core.opponentActive" },
    { "nodeId": "opponent", "id": "core.firstPet", "inputs": { "target": { "node": "opponents" } } },
    {
      "nodeId": "defense",
      "id": "core.petAttribute",
      "params": { "attribute": "def" },
      "inputs": { "target": { "node": "opponent" } }
    },
    {
      "nodeId": "amount",
      "id": "core.multiply",
      "inputs": { "left": { "node": "defense" }, "right": { "parameter": "ratio" } }
    }
  ],
  "actions": [
    {
      "stepId": "damage",
      "id": "core.dealDamage",
      "inputs": { "target": { "node": "opponents" }, "amount": { "node": "amount" } }
    }
  ]
}
```

使用 `encapsulateRule` 可将它封装为一级预设，并将 `ratio` 限制在公开范围内。二级组合和一级配置均使用同一个能力注册表、参数限制及执行预算。

## 捕获与跟随

“跟随对手出战位置，捕获每次入选时的防御”由独立步骤表达：`opponentActive → firstPet → followPet → boundPetAttribute`，最后一步配置 `{ attribute: 'def', mode: 'capture', scope: 'input' }`。

例如 A 入选时防御为 40，之后防御改为 60，捕获值仍为 40；B 换入时捕获 B 的值；A 离开后再次入选会产生新输入代次，重新捕获 A 此时的防御。若把属性步骤配置为 `mode: 'follow'`，同一个实体的属性改变也会更新结果。捕获实体身份本身不会冻结其所有属性。

目标缺失时暂停贡献，目标再次出现后按各步骤的时间策略恢复。来源被压制时贡献暂时不生效，计划继续观察输入；解除压制不会无条件重置捕获。来源销毁时清理该来源的订阅与贡献。另一个来源、行为使用或 Battle 保持独立。

## 预算、身份与验证

所有受控动作共享当前 Battle 的执行预算，递归触发、嵌套动作和持续计算均计费；不能通过拆成多个行为使用绕过额度。不同 Battle 的预算独立。预算耗尽后停止结算，错误容忍选项不能吞掉故障；可信回调内部任意无限循环仍不属于可抢占范围。

可信能力的合同和实现随宿主构建产物生成摘要。同一能力 ID 下修改实现或约束也改变构建身份；自定义注册能力须纳入宿主产物。作品数据不能自行声明兼容。完整作品依赖与跨宿主环境装配分别由 #243、#244 接续。

`pnpm verify:battle-v4-capabilities` 对伤害、层数绑定和入选捕获运行规则／原生对照，分别构建 Node 与压缩浏览器产物，在真实 Chrome 中双向交换 JSON 快照，以新编译工厂比较状态、效果顺序和 RNG。恢复仅使用已有初始或行动等待点；不扩展阶段过程快照。
