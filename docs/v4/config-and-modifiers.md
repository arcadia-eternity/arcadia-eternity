# ConfigValue、属性 modifier 与 V1 迁移契约

历史依据：`c086289812885e7a4903b181e2b8989e201452b8` 的 `config.ts`、`attributeSystem.ts`、`phase/base.ts` 及实体访问器。当前官方效果里存在纹章对技能效果配置的修改，例如 `effect_emblem_fengbaozhixing_rage_boost_5`；这些能力是领域内核的一部分，不以 #205 尚未迁移效果目录为由删除。

## 所有权和类型

- 每个 Battle 有自己的 `configSystem` 和 `valueSystem`。Pet / Player / Skill / Mark 各有 `AttributeSystem<TAttributeSet>`，实际 getter 和结算读取该系统，字段与修改器值类型关联。
- `ConfigValue` 保留 string / number / boolean / null，品牌 ID 可作为字符串值。`ConfigSystem<TConfig>` 将配置 key 与值类型绑定；动态默认配置表也提供经过数值校验的 `numberReference`。
- `Modifier<number>` 支持 percent、delta、override、clampMax、clampMin、clamp；boolean/string 属性支持 override。`ConfigModifier` 支持 override，数值 delta、字符串 append/prepend。不匹配的组合有编译反例，并在输入边界验证。
- 优先级越高越先应用，同优先级按稳定登记顺序。原生能力等级作为 priority 0 的属性修改参与同一计算；同优先级时先原生等级、后外部修改。忽略正／负／全部等级只过滤等级，不忽略其他属性修改。
- 变身改变基础原型和值，独立 modifier 保持绑定；撤销后仍能正常计算。印记层数、时长、激活状态和玩家怒气也通过各自属性系统读取。

## 配置作用域与可信效果

配置基值从最具体的作用域向上查找：Skill/Mark → Pet → Player → Battle，最后回落到全局基值。修饰符按相同作用域继承；有来源的配置修饰只影响该来源拥有者及其后代，不能泄漏到对手。

```ts
const config = battle.configSystem
config.registerConfig('effect-example.rage', 20)
config.addScopedConfigModifier(
  'effect-example.rage',
  new ConfigModifier(ConfigDurationType.binding, 'emblem-rage', 5, ConfigModifierType.delta, 0, sourceMark),
  pet,
)
```

可信效果使用 `context.getConfigValue('rage')`，按 `${effect.id}.rage` 和 `context.source` 的作用域解析；没有注册配置时回落到该效果引用的 params。复杂 JSON 参数仍由效果自己处理，不强行变成标量配置。模板参数默认值及 schema 的正式注册仍属于 #205/#223，这里不解释官方 DSL。

配置支持标签注册、查询、增删和按标签添加修改。阶段也有 `addConfigModifier` / `addDynamicConfigModifier`，ID 来自当前确定性阶段 ID 和局部计数器。

## 动态值与确定性

修改器在读取时重新计算，可接收：

1. 普通有限标量；`modifier.value.next(value)` 可更新运行时值。
2. `source.attributeSystem.reference('stack')` 等带类型的属性引用。
3. `config.reference(key, scope)` / `numberReference` 配置引用。
4. `computed<T>(id, version, params)`：外部 `EffectRegistry` 第二个参数注册的可信 TS `TrustedValue<T>`。

计算代码不从存档加载，也不写入存档。快照只保存引用、参数、版本和当前标量；恢复后从同一可信注册表关联计算代码。缺失版本、过期来源、错误字段、非有限值和循环依赖均失败；可信操作内的失败会回滚，不使用历史采样值掩盖循环。

不直接接收旧 RxJS Observable、Subject 或任意计算闭包。属性／配置引用及版本化计算提供规则所需的动态关系；外部运行时值句柄不是跨恢复的持久句柄，宿主应从恢复后的对象重新取得。没有引入 RxJS、全局注册表、事件循环、时间或宿主依赖。

## 生命周期

- `instant`：沿用独立修改的含义，保留到显式清理，不自动改写永久基值。
- `binding`：必须有来源。来源印记销毁、耗尽或到期时，清理全战斗内该来源的配置和属性修改；来源失效时也不会继续计算旧效果。
- `phase`：当前具体 Phase 结束或清理时移除，阶段作用域配置也一起移除，不跨存档保存活 Phase 对象。
- `phaseType`：Current 绑定当前匹配阶段；Any 使用当前或首个后续匹配阶段；Next 跳过创建时所在的匹配阶段，绑定随后一次。匹配阶段结束时移除。V1 对 Next 的 TODO 行为在这里明确实现。
- Turn 使用 `@turn/<number>` 表示逻辑回合，跨 TurnStart/各行动/TurnEnd 的原子推进及存档；到整个回合结束才清理。Battle 绑定到整场结束。

实体 getter 的基值与有效值分别存档，避免恢复后重复应用 modifier。HP、怒气、层数、时长的实际写入使用有效值赋值，按修改顺序反推基础值，防止扣除时再次叠加修改。资源读取保持整数，时长允许 -1；移除修改时归一基础资源，避免隐藏负值在恢复前后产生差异。override 和饱和 clamp 保持其约束，不绕过锁定值；对不可逆部分保留之前的基础值。所有配置、作用域、来源、动态值引用、等待阶段绑定均为纯数据；恢复时重建实体引用并校验。

## 变身来源的生命周期

覆盖特性／纹章时，如果旧原生印记仍是某一变身的来源，保留该实例作为休眠来源并抑制其效果及绑定修改，避免“销毁来源→撤销自身”的递归。撤销时恢复原印记；外部销毁或到期仍会结束相应变身。快照记录休眠状态与来源 ID。

已经存在、恰好与目标特性同类的普通状态印记可以复用，但不会被变身取得销毁所有权，撤销时不删除它。

## 验证边界

专项测试覆盖计算顺序、阶段 Current/Next、跨回合原子存档、动态引用、可信计算版本、作用域隔离、参数读取、来源销毁、变身保留独立 modifier、循环／坏存档拒绝及异常回滚。Node/真实 Chrome 的公开 `/core` 场景同时执行变身、动态属性／配置、JSON 恢复、来源到期撤销和动作重放。

官方 `AfterAttacked` 当前无效果引用，指定 V1 提交也没有实际派发；依用户要求保留声明并搁置，不新增规则触发或改动原官方 golden。

## 本轮复核与修正

独立 Standards/Spec 复核发现并修复了有效资源值写回原始基值而重复应用 modifier 的问题。新增实际 Damage/Heal/Rage/ConsumeStack/MarkUpdate 路径测试，覆盖 delta/percent、盾量、倒计时及 override/clamp 约束；临时 HP 耗尽后的来源清理会归一基值，恢复前后行为一致。配置在登记后的完整计算图上验证循环，失败替换会保留旧修改器及其动态值句柄；失败操作仍整体回滚。
