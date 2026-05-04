# Effect Editor 重构设计方案

## 1. 问题定义

### 1.1 当前状态

| 组件 | 状态 | 问题 |
|------|------|------|
| `@comfyorg/litegraph` v0.17.2 | 已安装但无任何引用 | 依赖完全无用 |
| VSCode 扩展 `effectEditorProvider.ts` | 裸 `<textarea>` 编辑 YAML | 无结构化编辑，无校验 |
| Web UI `PropertyPanel.vue` | effects 实体落到 raw JSON dump | 无专用编辑器，schema 只有 `id` + `trigger` |
| `game-config/base.ts` | effects 使用简陋 schema | 未接入 `effectDSLSchema` |
| 数据文件 `effect_skill.yaml` | 12,000+ 行 YAML，手写 | 错误率高，维护困难 |

### 1.2 DSL 特性分析

Effect DSL 是一个**声明式规则系统**，每条 effect 是一个独立的规则声明：

```
Effect (单条规则)
├── trigger: 48 种触发器枚举（OnHit, BeforeHit, OnDamage, ...）
├── priority: number
├── condition: 可选的 ConditionDSL（条件树，支持 every/some/not 组合，最大嵌套深度无限制）
│   ├── evaluate { target: SelectorDSL, evaluator: EvaluatorDSL }
│   ├── selfUseSkill, continuousUseSkill, skillSequence（上下文条件）
│   ├── selfHasMark, statStageChange, probability（状态条件）
│   └── some / every / not（布尔组合）
├── apply: OperatorDSL | OperatorDSL[]（60+ 种操作符）
│   ├── target: SelectorDSL（base selector + chain 链，chain 可嵌套任意深度）
│   │   ├── base: self | opponent | target | selfTeam | mark | skill | ...
│   │   └── chain: [select(extractor), where(evaluator), flat, sum, randomPick, ...]
│   ├── value: Value（5 种变体）
│   │   ├── raw:number | raw:string | raw:boolean（带 tag 标记）
│   │   ├── entity:baseMark | entity:baseSkill | entity:species | entity:effect（实体引用）
│   │   ├── dynamic { selector: SelectorDSL }（运行时计算）
│   │   ├── selectorValue { value, chain[] }（值 + 管道处理）
│   │   └── conditional { condition, trueValue, falseValue? }（条件值）
│   └── type-specific fields（如 addMark 有 mark/stack/duration 字段）
├── consumesStacks?: number
└── tags?: string[]
```

**关键特性**：
- 深层嵌套：`apply.value.selector.chain[2].whereAttr.extractor` 可达 10+ 层
- 强类型约束：`dealDamage.target` 必须是 `PET_ID`，`value` 必须是 `NUMERIC`（typing metadata 已定义）
- YAML anchor/alias 模板系统：`&template` 定义 + `*template` 引用 + `<<: *template` 覆写
- 一条 effect 内 `apply` 和 `condition` 各自递归引用同一套 DSL 节点类型

### 1.3 约束条件

1. **YAML anchor 必须是一等公民**：模板系统基于 anchor 构建，不能破坏现有数据
2. **兼容 12,000 行现有数据**：编辑保存后不损坏 YAML anchor 结构
3. **复用现有架构**：接入 `features/data-editor/` 的 PropertyPanel + RichSchemaRenderer 体系
4. **TypeScript 类型安全**：利用 `@arcadia-eternity/schema` 中的 TypeBox schema 和 typing metadata

---

## 2. 架构总览

### 2.1 编辑模式选择：树形表单为主 + 流程图预览为辅

**不用纯节点图的原因**：
- Effect DSL 是声明式规则，不是控制流程序——没有"执行顺序"语义
- 深层嵌套（10+ 层）在节点图中会纠缠不清
- 60+ 种操作符类型用节点表示，可发现性差
- YAML anchor 模板系统无法自然地映射到节点图

**树形表单的优势**：
- 递归组件天然处理任意深度嵌套
- 折叠/展开机制让复杂 effect 可管理
- typing metadata 直接驱动下拉选项，类型安全
- 与现有 `RichSchemaRenderer` 模式一致

### 2.2 数据流

```
┌─────────────────────────────────────────────────────┐
│                   GameData Store                     │
│  effects: { byId: Record<string, Effect>, allIds[] } │
└──────────────────────┬──────────────────────────────┘
                       │ selectedRecordId → byId[id]
                       ▼
┌─────────────────────────────────────────────────────┐
│               PropertyPanel (existing)               │
│  entityComponents['effects'] = EffectProperties     │
│  draft: reactive deep copy of selected effect        │
└──────────────────────┬──────────────────────────────┘
                       │ :draft, :schema, @update:draft
                       ▼
┌─────────────────────────────────────────────────────┐
│              EffectProperties.vue (NEW)              │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  EffectForm (tree-structured)                 │   │
│  │  ├── EffectHeader (id, trigger, priority)     │   │
│  │  ├── ConditionTreeEditor (递归)               │   │
│  │  │   └── ConditionNode × N                   │   │
│  │  ├── OperatorListEditor                       │   │
│  │  │   └── OperatorEditor × N                  │   │
│  │  │       ├── target: SelectorBuilder          │   │
│  │  │       ├── value: ValueEditor               │   │
│  │  │       └── ...type-specific fields          │   │
│  │  └── EffectFooter (consumesStacks, tags)      │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  TemplatePanel (可折叠侧栏)                    │   │
│  │  ├── 模板库浏览                               │   │
│  │  ├── 拖入/选择模板引用                          │   │
│  │  └── 模板编辑入口                              │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  ┌──────────────────────────────────────────────┐   │
│  │  FlowPreview (可切换，只读)                     │   │
│  │  触发器 → 条件 → 操作符 流程概览               │   │
│  └──────────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────┘
                       │ update:draft
                       ▼
┌─────────────────────────────────────────────────────┐
│            YAML Serializer / Template Engine         │
│  序列化 draft → YAML（保留 anchor/alias/merge）       │
└─────────────────────────────────────────────────────┘
```

### 2.3 与现有 DataEditor 的集成点

修改以下文件：

| 文件 | 改动 |
|------|------|
| `game-config/base.ts` | 将 effects schema 从简陋的 `{ id, trigger }` 替换为 `effectDSLSchema`；添加 `summaryColumns`（trigger count, operator count, has condition） |
| `game-config/seer2.ts` | 将 `effects` 加入 `seer2Config.entities`（目前只在 baseEntities） |
| `PropertyPanel.vue` | 在 `entityComponents` 中注册 `'effects': EffectProperties` |
| `game-config/types.ts` | 无需改动（EntityConfig 接口已足够通用） |

---

## 3. 组件树设计

### 3.1 EffectProperties.vue（入口组件）

```
职责：接收 { record, draft, schema } props，编排子组件
状态：本地 UI 状态（展开/折叠、当前 Tab）
子组件：EffectHeader, ConditionTreeEditor, OperatorListEditor, EffectFooter
```

### 3.2 EffectHeader

```
Props: draft.trigger, draft.priority
UI:
  - trigger: 多选下拉（48 种触发器，来自 EffectTrigger enum）
  - priority: 数字输入
  - id 显示（只读，来自 record.id）
```

### 3.3 ConditionTreeEditor（递归组件）

```
Props: modelValue (ConditionDSL | undefined)
递归渲染：
  - evaluate → target: SelectorBuilder + evaluator: EvaluatorEditor
  - every/some → conditions: [ConditionTreeEditor × N]
  - not → condition: ConditionTreeEditor
  - selfUseSkill/selfHasMark/... → 类型特定字段
  - null/undefined → 空状态 + "添加条件"按钮
UI:
  - 每个节点一行，左侧类型标签，右侧可折叠内容
  - "+" 按钮添加子条件（根据 typing metadata 过滤可选条件类型）
  - 拖拽排序（sortablejs）
```

### 3.4 OperatorListEditor

```
Props: modelValue (OperatorDSL | OperatorDSL[])
UI:
  - 如果只有一个操作符：直接渲染 OperatorEditor
  - 如果有多个：列表视图，每行一个 OperatorEditor
  - "添加操作符"按钮
  - 当选中 conditional 操作符时，展开 trueOperator / falseOperator 子编辑器

添加操作符时的类型选择（分类导航，非平铺下拉）：

┌──────────────────────────────────────────────────────────┐
│  选择操作符类型                                [搜索...] │
│                                                           │
│  [伤害/治疗] [标记/堆叠] [属性修改] [能力阶段]            │
│  [必中/必暴] [威力/怒气] [特殊效果]                       │
│                                                           │
│  ── 伤害/治疗 ────────────────────────────────────────── │
│  ┌──────────┐ ┌──────┐ ┌───────────┐ ┌──────────────┐   │
│  │ dealDamage│ │ heal │ │executeKill│ │preventDamage │   │
│  │ 造成伤害  │ │ 治疗 │ │ 击杀      │ │ 阻止伤害     │   │
│  └──────────┘ └──────┘ └───────────┘ └──────────────┘   │
│  ┌───────────┐ ┌─────────────┐                           │
│  │addModified│ │ addThreshold│                           │
│  │ 伤害修正  │ │ 伤害阈值    │                           │
│  └───────────┘ └─────────────┘                           │
└──────────────────────────────────────────────────────────┘

分类映射（基于 effect_skill.yaml 实际数据分布）：
  伤害/治疗: dealDamage, heal, executeKill, preventDamage, addModified, addThreshold
  标记/堆叠: addMark, destroyMark, transferMark, addStacks, consumeStacks,
             modifyStackResult, setMarkDuration, setMarkStack, setMarkMaxStack,
             setMarkPersistent, setMarkStackable, setMarkStackStrategy,
             setMarkDestroyable, setMarkIsShield, setMarkKeepOnSwitchOut,
             setMarkTransferOnSwitch, setMarkInheritOnFaint, setStatLevelMarkLevel,
             overrideMarkConfig
  属性修改: addAttributeModifier, addDynamicAttributeModifier,
            addClampMaxModifier, addClampMinModifier, addClampModifier,
            addSkillAttributeModifier, addDynamicSkillAttributeModifier,
            addSkillClampMaxModifier, addSkillClampMinModifier, addSkillClampModifier,
            addConfigModifier, addDynamicConfigModifier, addTaggedConfigModifier,
            addPhaseConfigModifier, addPhaseDynamicConfigModifier,
            addPhaseTypeConfigModifier, addDynamicPhaseTypeConfigModifier,
            registerConfig, registerTaggedConfig, setConfig
  能力阶段: statStageBuff, clearStatStage, reverseStatStage, transferStatStage
  必中/必暴: setSureHit, setSureCrit, setSureMiss, setSureNoCrit, setIgnoreShield
  威力/怒气: amplifyPower, addPower, addCritRate, addAccuracy, addRage, setRage
  特殊效果: stun, setSkill, setActualTarget, disableContext, transform,
            transformWithPreservation, removeTransformation, executeActions,
            addTemporaryEffect, addValue, setValue, toggle,
            setIgnoreStageStrategy, setMultihit, addMultihitResult
```

### 3.5 OperatorEditor

```
Props: modelValue (OperatorDSL), operatorType (string)
动态渲染（根据 type 切换到对应的子编辑器），一次性覆盖所有 60+ 种操作符：

  伤害/治疗：
    dealDamage → target: SelectorBuilder + value: ValueEditor
    heal → target: SelectorBuilder + value: ValueEditor
    executeKill → target: SelectorBuilder
    preventDamage → target: SelectorBuilder
    addModified → target: SelectorBuilder + delta: ValueEditor + percent: ValueEditor
    addThreshold → target: SelectorBuilder + min?: ValueEditor + max?: ValueEditor

  标记/堆叠：
    addMark → target: SelectorBuilder + mark: ValueEditor + duration?: ValueEditor + stack?: ValueEditor
    destroyMark → target: SelectorBuilder
    transferMark → target: SelectorBuilder + mark: ValueEditor
    addStacks / consumeStacks → target: SelectorBuilder + value: ValueEditor
    modifyStackResult → target: SelectorBuilder + newStacks?: ValueEditor + newDuration?: ValueEditor
    setMarkDuration / setMarkStack / setMarkMaxStack / setMarkPersistent /
    setMarkStackable / setMarkStackStrategy / setMarkDestroyable /
    setMarkIsShield / setMarkKeepOnSwitchOut / setMarkTransferOnSwitch /
    setMarkInheritOnFaint / setStatLevelMarkLevel →
      target: SelectorBuilder + value: ValueEditor
    overrideMarkConfig → target: SelectorBuilder + config: MarkConfigSchema form

  属性修改：
    addAttributeModifier → target: SelectorBuilder + stat: ValueEditor + modifierType: ValueEditor +
      value: ValueEditor + (phaseType/scope/phaseId/priority): ValueEditor?
    addDynamicAttributeModifier → 同上，observableValue: SelectorBuilder 替代 value
    addClampMaxModifier / addClampMinModifier → target + stat + maxValue/minValue + priority?
    addClampModifier → target + stat + minValue? + maxValue? + (phaseAware)?
    addSkillAttributeModifier / addDynamicSkillAttributeModifier → 同上，attribute 替代 stat
    addSkillClampMaxModifier / addSkillClampMinModifier / addSkillClampModifier → 同 clamp 系列
    addConfigModifier → target + configKey + modifierType + value + priority?
    addDynamicConfigModifier → 同上，observableValue: SelectorBuilder
    addTaggedConfigModifier → target + tag + modifierType + value + priority?
    addPhaseConfigModifier / addPhaseDynamicConfigModifier → 同上 + phase 参数
    addPhaseTypeConfigModifier / addDynamicPhaseTypeConfigModifier → 同上 + phaseType/scope/phaseId
    registerConfig → target + configKey + initialValue
    registerTaggedConfig → target + configKey + initialValue + tags
    setConfig → target + key: ValueEditor + value: ValueEditor

  能力阶段：
    statStageBuff → target + statType + value + strategy?
    clearStatStage → target + statType? + cleanStageStrategy?
    reverseStatStage → target + statType? + cleanStageStrategy?
    transferStatStage → source: SelectorBuilder + target: SelectorBuilder + statType? + cleanStageStrategy?

  必中/必暴：
    setSureHit / setSureCrit / setSureMiss / setSureNoCrit → target + priority: number
    setIgnoreShield → target

  威力/怒气：
    amplifyPower / addPower / addCritRate / addAccuracy → target + value
    addRage / setRage → target + value
    setMultihit → target + value
    addMultihitResult → target + value

  特殊效果：
    stun → target
    setSkill → target + value: ValueEditor + updateConfig?: boolean
    setActualTarget → target + newTarget: ValueEditor
    disableContext → target
    transform → target + newBase + transformType? + priority? + permanentStrategy?
    transformWithPreservation → 同上
    removeTransformation → target
    executeActions → target
    addTemporaryEffect → target + effect: ValueEditor
    addValue / setValue / toggle → target + value
    setIgnoreStageStrategy → target + value
    setAccuracy → target + value

  条件操作符（递归）：
    conditional → condition: ConditionTreeEditor + trueOperator: OperatorEditor + falseOperator?: OperatorEditor
```

### 3.6 SelectorBuilder（管道视图）

这是整个编辑器最复杂的组件。Selector 的本质是一个**数据管道**——从 base 选取实体，然后通过 chain 逐步转换。chain 的**顺序有语义**（先 filter 再 sum vs 先 sum 再 filter 结果不同），因此 UI 必须清晰展示这个流程。

设计为**管道卡片视图**（类似 GitHub Actions step 或 IFTTT 规则链）：

```
┌─────────────────────────────────────────────────────────────┐
│  Selector 管道                                    [折叠 ▾] │
│                                                              │
│  数据源 ┌──────────────────────────────────────────────┐    │
│         │ base: [selfMarks               ▼]           │    │
│         │ ➜ 来源: 自身所有标记 (复数)                  │    │
│         └──────────────────────────────────────────────┘    │
│              │                                               │
│              ▼                                               │
│  Step 1 ┌──────────────────────────────────────────────┐    │
│         │ [whereAttr ▼]               [拖拽 ≡] [✕ 删除] │    │
│         │ ┌─ extractor: [baseId     ▼]               ─┤    │
│         │ ├─ evaluator: same("mark_kongqichuliang")  ─┤    │
│         │ └─ ➜ 结果: 过滤后的 marks 列表              │    │
│         └──────────────────────────────────────────────┘    │
│              │                                               │
│              ▼                                               │
│  Step 2 ┌──────────────────────────────────────────────┐    │
│         │ [select ▼]                   [拖拽 ≡] [✕ 删除] │    │
│         │ ┌─ extractor: [stack ▼]                      │    │
│         │ └─ ➜ 结果: 数值数组 [5, 3, 2]               │    │
│         └──────────────────────────────────────────────┘    │
│              │                                               │
│              ▼                                               │
│  Step 3 ┌──────────────────────────────────────────────┐    │
│         │ [sum ▼]                      [拖拽 ≡] [✕ 删除] │    │
│         │ └─ ➜ 结果: 数值 10                           │    │
│         └──────────────────────────────────────────────┘    │
│                                                              │
│  [+ 添加 step]                                              │
└─────────────────────────────────────────────────────────────┘
```

关键设计决策：
- **每步一张卡片**，而非一行文本。卡片内部根据 step 类型展开不同的子编辑器。
- **视觉箭头连接**各 step，强调顺序语义。
- **每步显示结果预览**（类型 + 简短描述），帮助用户理解数据变换。
- **拖拽排序**（sortablejs）允许调整 step 顺序（注意：改变顺序会改变语义）。
- base 和 chain 在同一个管道视图中，不分开。
- 简单 selector（无 chain，如 `target: opponent`）自动折叠为紧凑单行。

Chain 类型与编辑器映射：

| Step 类型 | 子编辑器 | 说明 |
|-----------|---------|------|
| `select` | Extractor 选择（base/attribute/relation/field/dynamic） | 从每个实体提取属性 |
| `selectPath` | 文本输入（如 `baseStats.hp` 或 `config.duration`） | 点路径提取 |
| `selectProp` | 文本输入 | 属性名提取 |
| `where` | EvaluatorEditor | 过滤：保留满足条件的实体 |
| `whereAttr` | Extractor + EvaluatorEditor | 过滤：比较提取值与条件 |
| `flat` | 无参数 | 展平嵌套数组 |
| `and` / `or` | SelectorBuilder（内嵌） | 集合运算：交集/并集 |
| `randomPick` | ValueEditor（数量） | 随机选取 N 个 |
| `randomSample` | ValueEditor（数量） | 随机采样 |
| `sum` / `avg` | 无参数 | 数值聚合 |
| `add` / `multiply` / `divide` | ValueEditor | 算术运算 |
| `shuffled` | 无参数 | 乱序 |
| `limit` / `clampMax` / `clampMin` | ValueEditor | 限幅 |
| `configGet` | ValueEditor（key） | 读取配置 |
| `selectObservable` / `selectAttribute$` | 文本输入 | 响应式值提取 |
| `asStatLevelMark` | 无参数 | 强制转型 |
| `sampleBetween` | 无参数 | 区间采样 |
| `when` | ConditionTreeEditor + trueValue + falseValue | 条件分支 |

base selector 的下拉选项由 typing metadata 过滤（如 `dealDamage` 的 `target` 只允许 `PET_ID` 对应的 self/opponent/target）。
```

### 3.7 ValueEditor（递归 + 快速类型切换）

Value 的类型决定编辑界面，且 Value 可以递归嵌套（`conditional` 的 `trueValue` 可以是 `dynamic`，`dynamic` 的 `selector` 可以有 chain）。

设计为**类型切换按钮组**（一键直达常用类型）+ **递归展开**（复杂类型）：

```
┌──────────────────────────────────────────────────────────────┐
│  value:   [🔢 num] [📝 str] [✓ bool] [🏷️ mark] [⚔️ skill]  │
│           [✨ effect] [🔄 dynamic] [⛓️ selVal] [🔀 cond]     │
│                                                               │
│  ── 当前: 🔢 raw:number ──────────────────────────────────── │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  value: [  100                  ]                    │    │
│  │  configId: [  (可选)            ]                    │    │
│  │  tags: [  (可选标签)           ]                     │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                               │
│  ── 切换为 🔄 dynamic 后 ────────────────────────────────── │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  selector:                                           │    │
│  │  ┌──────────────────────────────────────────────┐    │    │
│  │  │  [SelectorBuilder 管道视图]                  │    │    │
│  │  │  base: [self          ▼]                     │    │    │
│  │  │  └─ chain: [select(maxHp)] → [divide(8)]     │    │    │
│  │  └──────────────────────────────────────────────┘    │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                               │
│  ── 切换为 🔀 conditional 后 ────────────────────────────── │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  condition: [ConditionTreeEditor]                    │    │
│  │  trueValue: ┌───────────────────────────────────┐    │    │
│  │             │ [🔢 num] ... [ValueEditor 递归]   │    │    │
│  │             └───────────────────────────────────┘    │    │
│  │  falseValue: ┌──────────────────────────────────┐   │    │
│  │              │ (可选) [ValueEditor 递归]         │    │    │
│  │              └──────────────────────────────────┘   │    │
│  └──────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

类型切换按钮组：
- 始终可见，当前类型高亮
- `allowedTypes`（来自 typing metadata）过滤可选类型 —— 如 `dealDamage.value` 只显示 `num` + `dynamic`
- 切换类型时保留可兼容的已有数据

递归展开规则：
- 顶层渲染当前类型的编辑器
- 当子字段也是 Value 类型时（如 `conditional.trueValue`），递归渲染 ValueEditor
- 最大展开深度默认 4 层，超出后折叠为「...（深层嵌套）」+ 点击展开

各类型编辑器：

| 类型 | 编辑器 | 说明 |
|------|--------|------|
| `raw:number` | 数字输入 + configId 文本 + tags 多选 | 最常见类型，一键可达 |
| `raw:string` | 文本输入 | |
| `raw:boolean` | el-switch 开关 | |
| `entity:baseMark` | 搜索下拉（从 gameData.marks 过滤 `mark_` 前缀） | 支持搜索，hundreds of marks |
| `entity:baseSkill` | 搜索下拉（从 gameData.skills 过滤 `skill_` 前缀） | |
| `entity:species` | 搜索下拉（从 gameData.species 过滤 `pet_` 前缀） | |
| `entity:effect` | 搜索下拉（引用其他 effect） | |
| `dynamic` | SelectorBuilder（递归） | 运行时求值 |
| `selectorValue` | ValueEditor（内嵌值）+ SelectorChain 管道 | 值 + 管道处理 |
| `conditional` | ConditionTreeEditor + trueValue: ValueEditor + falseValue?: ValueEditor | 条件值，本组件递归 |
| 裸 number/string/boolean | 同 raw:* 编辑器 | 自动推断类型，可「升级」为 typed value |
| Array\<Value\> | 列表，每项一个 ValueEditor | |
| OperatorDSL inline | OperatorEditor（递归） | value 字段嵌套另一个操作符 |
```

### 3.8 EvaluatorEditor

```
Props: modelValue (EvaluatorDSL)
根据 type 动态渲染：
  - compare → operator: 下拉(>, <, >=, <=, ==) + value: ValueEditor
  - same/notSame → value: ValueEditor
  - any/all → conditions: [EvaluatorEditor × N]
  - not → condition: EvaluatorEditor
  - probability → percent: ValueEditor
  - contain → tag: 文本输入
  - exist → 无参数
  - anyOf → value: ValueEditor
```

### 3.9 TemplateSystem

```
职责：
  1. 模板发现：解析当前文件的 YAML anchor（局部）+ 加载全局模板库
  2. 模板库 UI：双层标签（「局部」/「全局」），可搜索、可预览
  3. 模板引用编辑：当 effect 的 apply/condition 引用模板时，显示为只读（可覆写特定字段）
  4. 模板管理：创建、编辑、删除（局部和全局分开管理）

YAML Anchor 与模板的映射：
  - YAML anchor (&name) → 局部模板 { id: name, definition: {...}, scope: 'local' }
  - YAML alias (*name) → TemplateRef { templateId: name, scope: 'local' }
  - YAML merge (<<: *name) → TemplateMerge { templateId: name, overrides: {...}, scope: 'local' }
  - 全局模板 → { id, definition, scope: 'global' }

序列化时：
  - 局部模板引用 → *name（当前文件内 YAML alias）
  - 局部模板覆写 → <<: *name + 覆写字段
  - 全局模板引用 → 展开为完整定义（不使用 anchor）
  - 展开的完整对象 → 内联定义
```

### 3.10 FlowPreview（可选，只读）

```
Props: effect (完整的 EffectDSL 对象)
渲染：
  - 使用纯 SVG/Canvas 或 litegraph 绘制简化流程图
  - 只读，不可编辑
  - 显示 trigger → condition → operator 的拓扑关系
  - 折叠深层嵌套（selector chain 不展开到每一层）
  - 支持导出为 PNG
```

---

## 4. Typing Metadata 集成方案

### 4.1 数据来源

```typescript
// packages/schema/src/effectTypingMetadata.ts
export const effectDslTypingMetadata = {
  condition: {
    evaluate: {
      selectorFields: { target: ANY_SELECTOR_RESULT },
      valueFields: { evaluator: DSL_EVALUATOR_OBJECT },
    },
    selfHasMark: {
      valueFields: { baseId: BASE_MARK_REF },
    },
    // ...
  },
  operator: {
    dealDamage: {
      selectorFields: { target: PET_ID },
      valueFields: { value: NUMERIC },
    },
    heal: {
      selectorFields: { target: PET_ID },
      valueFields: { value: NUMERIC },
    },
    // ... 60+ operators
  },
}
```

### 4.2 运行时使用

```typescript
// 在 OperatorEditor 中使用
import { getEffectDslNodeTyping } from '@arcadia-eternity/schema'

const typing = getEffectDslNodeTyping('operator', 'dealDamage')
// → { selectorFields: { target: { allow: [{ kind: 'id', targets: ['pet'] }] } },
//     valueFields: { value: { allow: [{ kind: 'scalar', valueTypes: ['number'] }] } } }

// target 字段：只允许选择 pet 目标 → 下拉限于 self, opponent, target
// value 字段：只允许数值 → 自动选择 raw:number 类型
```

### 4.3 字段级约束展开

```typescript
// 将 typing rule 展开为 UI 可用的选项列表
function resolveSelectorOptions(rule: EffectDslFieldTypingRule): BaseSelectorKey[] {
  const constraints = rule.allow
  const owners = new Set<string>()
  for (const c of constraints) {
    if (c.kind === 'id' && c.targets) {
      // 'pet' → self, opponent, target
      // 'mark' → mark, selfMarks, opponentMarks
      mapTargetsToSelectors(c.targets, owners)
    }
    if (c.kind === 'owner') {
      // useSkillContext, damageContext → 上下文 selector
      owners.add(...c.owners!)
    }
  }
  return [...owners] as BaseSelectorKey[]
}

function resolveValueType(rule: EffectDslFieldTypingRule): ValueType[] {
  // scalar:number → [raw:number, dynamic(number)]
  // scalar:string → [raw:string, dynamic(string), entity:*]
  // object:dsl:operator → [OperatorDSL inline]
  // ...
}
```

### 4.4 三级验证体系

验证分为三个级别，触发时机和阻断策略各不相同：

| 级别 | 触发时机 | 反馈方式 | 阻断保存？ | 示例 |
|------|---------|---------|-----------|------|
| **L1: 结构** | 每次编辑（debounce 300ms） | inline 红色边框 + 具体错误文案 | 否（允许草稿） | "操作符 `dealDamage` 缺少必填字段 `target`" |
| **L2: 类型** | 每次编辑（debounce 300ms） | inline 黄色边框 + 警告图标 + tooltip | 否（允许草稿） | "`value` 字段应为数值类型，当前为字符串" |
| **L3: 引用完整性** | 保存前（显式触发） | 弹窗列出所有问题 + 逐项确认 | **是**（阻断保存） | "引用的 effect `effect_xxx` 不存在" / "引用的 mark `mark_yyy` 未定义" |

L1/L2 实现：
- 从 `effectDSLSchema`（TypeBox）读取结构约束 → 校验必填字段、枚举值范围
- 从 `effectTypingMetadata` 读取类型约束 → 校验字段类型匹配
- 验证结果缓存在组件本地状态，避免每次渲染重算
- 错误信息使用中文（直接显示给用户）

L3 实现：
- 遍历 effect 中的所有 `entity:baseMark`、`entity:baseSkill`、`entity:species`、`entity:effect` 引用
- 在 `gameData` store 中查证目标是否存在
- 对于 YAML anchor 引用，检查目标 anchor 是否在当前文件中定义
- 保存时弹窗：
  ```
  ┌────────────────────────────────────────────────┐
  │  ⚠️  保存前检查发现 2 个问题                    │
  │                                                 │
  │  ❌ 引用缺失                                    │
  │  effect_xxx → 引用的 mark_yyy 不存在            │
  │  [跳转到该字段]                                 │
  │                                                 │
  │  ⚠️  引用警告                                   │
  │  effect_zzz → 引用的模板 not_a_template 未定义   │
  │  将自动展开为内联定义                            │
  │  [跳转到该字段]                                 │
  │                                                 │
  │  [仍然保存（不推荐）]  [返回修改]               │
  └────────────────────────────────────────────────┘
  ```

验证 Composable：

```typescript
// composables/useEffectValidation.ts
interface ValidationResult {
  level: 'L1' | 'L2' | 'L3'
  path: string           // 字段路径，如 "apply.value.selector.chain[0].extractor"
  message: string        // 中文错误信息
  field: string          // 字段名
}

function validateEffect(draft: EffectDraft): ValidationResult[]
function validateReferences(draft: EffectDraft, gameData: GameDataState): ValidationResult[]
```
```

```typescript
// 将 typing rule 展开为 UI 可用的选项列表
function resolveSelectorOptions(rule: EffectDslFieldTypingRule): BaseSelectorKey[] {
  const constraints = rule.allow
  const owners = new Set<string>()
  for (const c of constraints) {
    if (c.kind === 'id' && c.targets) {
      // 'pet' → self, opponent, target
      // 'mark' → mark, selfMarks, opponentMarks
      mapTargetsToSelectors(c.targets, owners)
    }
    if (c.kind === 'owner') {
      // useSkillContext, damageContext → 上下文 selector
      owners.add(...c.owners!)
    }
  }
  return [...owners] as BaseSelectorKey[]
}

function resolveValueType(rule: EffectDslFieldTypingRule): ValueType[] {
  // scalar:number → [raw:number, dynamic(number)]
  // scalar:string → [raw:string, dynamic(string), entity:*]
  // object:dsl:operator → [OperatorDSL inline]
  // ...
}
```

---

## 5. YAML Anchor / 模板系统设计

### 5.1 两层模板体系

YAML anchor 的作用域是**单个 YAML 文档**（一个文件）。`effect_skill.yaml` 中的 anchor 无法在 `effect_mark.yaml` 或 `effect_ability.yaml` 中引用。因此模板系统设计为两层：

```
┌─────────────────────────────────────────────────────────────┐
│  模板系统                                                    │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Layer 1: 局部模板（YAML anchor，单文件作用域）       │   │
│  │                                                       │   │
│  │  effect_skill.yaml:                                   │   │
│  │    &prob_5_template → 只在 effect_skill.yaml 内可用   │   │
│  │                                                       │   │
│  │  保存为: *prob_5_template                             │   │
│  │  覆写为: <<: *prob_5_template + overrides             │   │
│  │                                                       │   │
│  │  编辑时：只读 + 可覆写字段，切换模板限于同文件         │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Layer 2: 全局模板（编辑器特性，跨文件共享）           │   │
│  │                                                       │   │
│  │  存储在编辑器内部（单独的 YAML 文件或 localStorage）   │   │
│  │                                                       │   │
│  │  使用全局模板时：                                      │   │
│  │    编辑时：显示模板引用（同局部模板体验）              │   │
│  │    保存时：展开为完整定义（不使用 YAML anchor）        │   │
│  │    理由：跨文件 YAML anchor 不合法，必须展开            │   │
│  │                                                       │   │
│  │  全局模板管理：                                        │   │
│  │    - 创建：从任意 effect 的 apply/condition → 保存为   │   │
│  │            全局模板                                    │   │
│  │    - 使用：在任意文件的 effect 中选择引用              │   │
│  │    - 同步：修改全局模板 → 提示受影响文件，手动更新     │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 模板发现

```typescript
// 解析 effect_skill.yaml 时提取所有 anchor
interface DiscoveredTemplate {
  id: string              // anchor 名称，如 "apply_opponent_statstage_-1_template"
  category: 'apply' | 'condition' | 'evaluator'  // 模板类别
  definition: unknown     // anchor 定义的完整内容
  usageCount: number      // 被引用的次数
}

// 枚举所有 effect 中的 anchor 使用
function discoverTemplates(effects: Effect[]): DiscoveredTemplate[]
```

### 5.3 模板引用编辑

```
┌────────────────────────────────────────────────────┐
│  apply: 📋 apply_opponent_statstage_-1_template    │
│  ┌──────────────────────────────────────────────┐  │
│  │  type: statStageBuff                     🔒  │  │  ← 模板定义，只读
│  │  target: opponent                        🔒  │  │
│  │  statType: [def         ▼]              ✏️  │  │  ← 可覆写字段
│  │  value: -1                               🔒  │  │
│  └──────────────────────────────────────────────┘  │
│  [切换模板 ▼] [解除引用] [编辑模板定义]              │
└────────────────────────────────────────────────────┘
```

- **🔒 只读字段**：模板中定义的字段，灰色显示，不可直接编辑
- **✏️ 可覆写字段**：当前 effect 在 merge 时覆写的字段，正常可编辑
- **[解除引用]**：将模板引用展开为完整的内联定义（放弃 anchor）
- **[切换模板]**：选择其他模板替换当前引用
- **[编辑模板定义]**：跳转到模板编辑模式（慎用，会影响所有引用者）

### 5.4 序列化策略

```typescript
interface SerializedEffect {
  // 完全引用（无覆写）
  // → 输出: apply: *template_name
  fullReference?: string

  // 合并引用（有覆写）
  // → 输出: apply: <<: *template_name + overrides
  mergeReference?: {
    templateId: string
    overrides: Record<string, unknown>
  }

  // 展开定义（不使用模板）
  // → 输出: apply: { type: ..., target: ..., ... }
  inlineDefinition?: unknown
}

function serializeToYaml(effect: EffectDraft): string {
  // 根据 effect 的模板引用状态选择序列化方式
  // fullReference → 输出 alias
  // mergeReference → 输出 merge key
  // inlineDefinition → 输出完整对象
}
```

### 5.5 模板管理

模板存储在 `effect_skill.yaml` 中（通常是数据文件开头或结尾的模板定义区）。

**局部模板操作**：
- 模板创建：选择现有 effect 的 apply/condition → 「保存为模板」→ 在当前文件创建 YAML anchor
- 模板编辑：修改模板定义（级联影响当前文件所有引用者，需确认）
- 模板删除：展开当前文件所有引用为内联定义，然后删除模板

**全局模板操作**：
- 全局模板库存储在编辑器单独的配置文件（如 `templates/effects.yaml`）
- 创建：同局部模板，但勾选「保存为全局模板」
- 使用：在任意文件的 effect 编辑器中，模板面板的「全局」标签页选择
- 引用全局模板保存时**自动展开**为内联定义（不使用 YAML anchor，因为跨文件 anchor 不合法）
- 修改全局模板：提示所有受影响文件路径，用户手动逐文件更新

---

## 6. 实现路线图

### Phase 1: 完整编辑器（4-6 周）

**目标**：完整覆盖所有 DSL 节点类型，可编辑 `effect_skill.yaml` 中任意 effect。

- [ ] 在 `game-config/base.ts` 中接入 `effectDSLSchema`，添加 `summaryColumns`，加入 `fieldHints`
- [ ] 在 `PropertyPanel.vue` 中注册 `EffectProperties` 组件
- [ ] 实现 `EffectHeader`（id 只读，trigger 多选，priority 输入）
- [ ] 实现 `OperatorEditor` — 覆盖全部 60+ 种操作符，分类导航
- [ ] 实现 `SelectorBuilder` — 管道卡片视图，覆盖全部 20 种 chain 类型
- [ ] 实现 `ValueEditor` — 递归 + 快速类型切换，覆盖全部 12 种 value 变体
- [ ] 实现 `EvaluatorEditor` — 覆盖全部 10 种 evaluator 类型
- [ ] 实现 `ConditionTreeEditor` — 递归组件，覆盖全部 25+ 种条件类型
- [ ] 实现 `OperatorListEditor` — 多操作符列表 + 拖拽排序
- [ ] 集成 typing metadata（`SelectorBuilder` 和 `ValueEditor` 的选项由 typing 约束驱动）
- [ ] 实现三级验证体系（L1 结构 / L2 类型 inline + L3 引用保存前弹窗）
- [ ] 保存/加载流程整合到 DataEditor 的 pack I/O 系统

**验证标准**：能打开并编辑 `effect_skill.yaml` 中任意 effect，所有字段通过表单编辑（非 Monaco），字段选项正确过滤，非法组合提供警告/错误，保存后 YAML 格式正确。

### Phase 2: 模板系统（2-3 周）

- [ ] 模板发现：解析当前文件的 YAML anchor → 局部模板；加载全局模板库
- [ ] 模板库面板 UI：双层标签（「局部」/「全局」），搜索过滤，内容预览
- [ ] 模板引用编辑：只读模板字段渲染 + 可覆写字段 + 「解除引用」+ 「切换模板」
- [ ] 模板创建 / 编辑 / 删除（局部和全局分开管理）
- [ ] YAML 序列化器（局部模板 → anchor/alias/merge 输出；全局模板 → 内联展开）

**验证标准**：能基于现有模板创建新 effect，覆写部分字段，保存后 YAML 正确使用 `*template` 或 `<<: *template` 语法。全局模板可跨文件引用，保存时自动展开。

### Phase 3: 流程图预览 + 打磨（2 周）

- [ ] `FlowPreview` 组件：纯 SVG 渲染，只读
  - [ ] 基于 effect 数据生成拓扑结构（trigger → condition → operators）
  - [ ] 折叠深层嵌套（只显示顶层，可展开/折叠节点）
  - [ ] 导出为 PNG
- [ ] Monaco 源码视图（只读，与表单并列）
  - [ ] 点击流程图节点 → 高亮对应 YAML 行
- [ ] 性能优化（12,000 行数据的大表格）
- [ ] 国际化（模板面板、错误提示）

---

## 7. 风险与权衡

### 7.1 技术风险

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| 递归组件深度过大导致性能问题 | 编辑卡顿 | 虚拟滚动 + 懒加载嵌套节点；默认折叠深层 chain |
| YAML anchor 语义复杂，序列化出错 | 数据损坏 | 序列化器有完善的单元测试覆盖；模板引用编辑前对原始 YAML 做快照备份 |
| typing metadata 覆盖不全 | 部分字段缺少约束 | 对未定义的字段回退到通用编辑器（自由输入） |
| 与现有 DataEditor 的 draft/undo 系统冲突 | 编辑状态丢失 | 复用现有 `useEditorUndo` 和 `injectedDraft` 模式 |

### 7.2 设计权衡

| 权衡 | 选择 | 理由 |
|------|------|------|
| 树形表单 vs 节点图 | 树形表单 | DSL 是嵌套声明式规则，不是控制流；表单处理嵌套更优雅 |
| 通用组件 vs 专用组件 | 专用组件 | 60+ 种操作符形态差异大，通用组件会导致大量配置 |
| Monaco vs CodeMirror | 已有 Monaco | 项目已安装 monaco-editor，无需新依赖 |
| litegraph vs SVG | SVG（轻量） | litegraph 不维护、不受 Vue 支持；SVG 足够满足只读预览 |
| 只读预览 vs 双向编辑 | 只读预览 | 双向同步极难维护；表单为主、预览为辅保证单一事实源 |

### 7.3 不做什么

- ❌ 不做全功能节点图编辑器（不适合此 DSL）
- ❌ 不做 YAML ↔ 图形双向同步编辑
- ❌ 不做 effect 的实时预览/沙盒执行（属于 battle engine 的职责）
- ❌ 不替换现有的 pack I/O 系统（effect 文件仍通过 pack 管理）

---

## 9. 未来方向：DSL 改进（远期，不在此次重构范围内）

当前 DSL 的表达能力是一流的，但存在表达效率问题。以下改进方向记录下来供未来参考，**本次重构不改 DSL 本身**。

### 9.1 现状评价

**优势**：
- Selector 管道设计（`base → chain[where → select → sum]`）极度灵活，本质是一套可组合的 type-safe query language
- `conditional` 操作符让条件分支成为 DSL 一等公民，复杂 effect 可在单条内表达
- YAML anchor 模板系统务实高效，`<<: *template` 覆写语义简洁
- **三层校验管线保证了从编辑到运行时的强类型安全**：
  - Layer 1: TypeBox schema（结构校验，default-fill + convert + check）
  - Layer 2: compile-time validator（`effect-compile-validator.ts` 1185 行，验证 selector/value 引用路径正确性）
  - Layer 3: typing metadata（`effectTypingMetadata.ts` 683 行，手写字段级类型约束）
  
  这套管线在游戏 modding/脚本领域是罕见的投入——绝大多数同类项目到运行时才发现 `target` 用错了类型。

**劣势**：
1. **操作符数量膨胀**：17 个 modifier 系列操作符（`addAttributeModifier` / `addDynamicAttributeModifier` / `addClampModifier` / `addSkillAttributeModifier` / `addConfigModifier` 及其变体 × N）本质是同一概念因 TypeScript tagged union 缺乏高阶抽象而被迫穷举的结果
2. **`value` 字段的类型歧义**：裸值 / tagged 值 / 动态选择器 / 条件值用同一个 `value` 键承载，parser 需回溯猜测类型
3. **深层嵌套 + YAML 缩进 = 阅读灾难**：一个「自身身高 < 对手身高」的条件在 YAML 中占用 18 行、16 层缩进，同一层级出现 5 个不同语义的 `type` 字段
4. **typing metadata 是手写的外在约束**，与 TypeScript 类型定义不同步时可能产生漏报

### 9.2 改进方向（按优先级）

| 优先级 | 方向 | 效果 | 破坏性 |
|--------|------|------|--------|
| 1 | **语法糖**：高频模式加简写（如 `selector('self.height')` 替代深层 chain、`probability 5%` 替代 evaluator 嵌套） | 表达效率提升 50%+，缩进减半 | 低——糖展开后还是现有 DSL |
| 2 | **合并操作符**：modifier 系列 17 个操作符 → 1 个参数化 `modify`，`clampMax/clampMin/clamp` → 1 个带可选参数的 `clamp` | 操作符数量从 60+ 降到 ~35，认知负担大幅下降 | 中——需改 parser + interpreter + 现有数据 |
| 3 | **区分 value 键名**：`staticValue` / `dynamicValue` / `taggedValue` / `conditionalValue` 替代 `value` + `type` 标签 | 消除类型歧义，parser 无需回溯，YAML LSP 可直接提示 | 中——所有现有 effect 需迁移 |
| 4 | **typing metadata 自动生成**：从 TypeScript 类型定义 + 装饰器自动提取字段约束，替代手写的 683 行 | 消除同步风险，减少维护成本 | 低——仅影响构建管线，不影响数据 |

### 9.3 前提条件

上述改进需要在以下条件满足后才值得投入：
- effect 编辑器已投入使用，用户反馈收集完毕
- 有一套完整的 DSL 迁移工具（CLI 批量转换 + 校验），确保 12,000 行数据不损坏
- typing metadata 自动生成方案经过原型验证

**当前阶段（编辑器重构期间）不改 DSL。** 编辑器做好 UX（分类导航、管道视图、三级验证）来弥补 YAML 的冗长，让用户不需要直接面对缩进地狱。

---

## 10. 附录

### 10.1 关键文件索引

| 文件 | 作用 | 改动类型 |
|------|------|---------|
| `packages/schema/src/effectDsl.ts` | DSL 类型定义（987 行） | 读取，不改动 |
| `packages/schema/src/effectSchema.ts` | TypeBox 校验 schema | 读取，不改动 |
| `packages/schema/src/effectTypingMetadata.ts` | 字段约束定义（683 行） | 读取，不改动 |
| `packages/schema/src/effectDslManifest.ts` | 运行时 manifest | 读取，不改动 |
| `packages/schema/src/effectPrimitives.ts` | 枚举常量 | 读取，不改动 |
| `packages/web-ui/src/features/data-editor/game-config/base.ts` | effects 实体配置 | **修改**：接入完整 schema |
| `packages/web-ui/src/features/data-editor/game-config/seer2.ts` | Seer2 配置 | **修改**：注册 effects |
| `packages/web-ui/src/features/data-editor/components/property-panel/PropertyPanel.vue` | 属性面板 | **修改**：注册 EffectProperties |
| `packs/base/data/effect_skill.yaml` | 效果数据 | 读写 |

### 10.2 新增文件清单

```
packages/web-ui/src/features/data-editor/
└── components/property-panel/entity-properties/
    └── EffectProperties.vue                    # 入口组件
    └── effect-editor/
        ├── EffectHeader.vue                    # 头部（trigger, priority）
        ├── ConditionTreeEditor.vue             # 递归条件树
        ├── OperatorListEditor.vue              # 操作符列表 + 分类导航
        ├── OperatorEditor.vue                  # 单一操作符编辑器（60+ 种全覆盖）
        ├── SelectorBuilder.vue                 # 管道卡片视图
        ├── ValueEditor.vue                     # 递归值编辑器 + 快速类型切换
        ├── EvaluatorEditor.vue                 # 求值器编辑器
        ├── TemplatePanel.vue                   # 模板库面板（局部/全局双层）
        ├── FlowPreview.vue                     # 流程图预览 (SVG, 只读)
        └── composables/
            ├── useEffectTyping.ts              # typing metadata 集成
            ├── useTemplateDiscovery.ts         # 模板发现（局部 + 全局）
            ├── useYamlSerializer.ts            # YAML 序列化
            └── useEffectValidation.ts          # 三级验证（L1/L2/L3）
```
