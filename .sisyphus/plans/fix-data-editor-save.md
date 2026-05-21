# Fix Data Editor Save Persistence

## TL;DR

> **Quick Summary**: Fix 8 bugs preventing data editor changes from persisting to disk — root cause is `PackManagerTab` storing pack IDs instead of folder names, plus silent early returns and a hard-coded effects skip.
>
> **Deliverables**:
>
> - PackManagerTab stores folder names correctly
> - Effect entities save to disk (hard-coded skip removed)
> - All save/delete paths log file targets and skip reasons
> - `doDelete`/`doBatchDelete` get `isBase` handling matching `doSave`
> - `enabledPacks` initialized on DataEditorPage mount
> - Unit tests for edge cases and effect YAML round-trip
>
> **Estimated Effort**: Short
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: PackManagerTab fix → DataEditorPage fixes → tests

---

## Context

### Original Request

用户在 data editor 中所做的任何改动都没有落盘，或者保存到了非预期的地方和非数据来源的地方，没有任何日志提示。

### Interview Summary

**Key Discussions**:

- 通过全面代码审查确认了 8 个具体 bug
- Effect DSL 已实现，`kind === 'effects'` 硬性跳过是多余的
- `PackManagerTab` 隐藏于可折叠面板中，`enabledPacks` 可能从未初始化

**Research Findings**:

- 完整保存流程：UI → PropertyPanel → draftRef → `doSave()` → IPC/HTTP → `fs.writeFile`
- 两个独立的磁盘写入路径：base pack（`writeBasePackFile`）和 workspace packs（`writeWorkspacePackFile`）
- `isBase` 检查使用字面量 `'base'`，但 `enabledPacks` 存储包 ID（`'arcadia-eternity.base'`）
- 所有提前返回路径（3 个）完全静默，零日志输出
- `doDelete`/`doBatchDelete` 缺少 `isBase` 处理

### Metis Review

**Identified Gaps** (addressed):

- Bug 6: `doDelete`/`doBatchDelete` 也缺少 `isBase` 处理 → 纳入范围
- Bug 7: 效果处理不一致（可删除但不能保存）→ 通过移除效果跳过修复
- Bug 8: `doBatchDelete` cfg null-guard 问题 → 保留现有模式（安全）
- 风险：效果 YAML 往返可能损坏 → 在启用效果保存之前添加专项测试
- 风险：已丢失数据的恢复窗口 → 文档说明

---

## Work Objectives

### Core Objective

修复数据编辑器的所有保存路径，确保更改正确持久化到磁盘，并提供诊断日志。

### Concrete Deliverables

- `PackManagerTab.vue` — 存储 `folderName` 而非 `packId`
- `DataEditorPage.vue` — `doSave()`/`doDelete()`/`doBatchDelete()` 全部修复
- `packages/web-ui/src/features/data-editor/__tests__/` — 新增测试文件

### Definition of Done

- [ ] `pnpm --filter @arcadia-eternity/web-ui run test:run` → PASS（0 failures）
- [ ] 效果实体点击保存后数据写入 `effect_skill.yaml`
- [ ] 所有保存路径的 console.log 显示文件目标
- [ ] 提前返回时有 console.warn 说明原因

### Must Have

- 将 `enabledPacks` 值从包 ID 改为文件夹名
- 移除 `kind === 'effects'` 保存跳过
- 为所有保存/删除路径添加日志（成功和跳过均有）
- `doDelete`/`doBatchDelete` 中的 `isBase` 处理

### Must NOT Have (Guardrails)

- 不修改 Electron `main.mjs`
- 不修改 `packWorkspace.ts` 的读写函数
- 不重构重复的 `resolveManifestDataPath`
- 不修改 `doCreate()`（它委托给 `doSave()`）
- 不修改 `enabledPacks` 的数据类型（保持 `string[]`）
- 不在计划中创建单独的文档文件

---

## Verification Strategy

### Test Decision

- **Infrastructure exists**: YES（Vitest v4 + jsdom + Vue Test Utils）
- **Automated tests**: Tests-after（先实现修复，再写测试验证）
- **Framework**: Vitest（globals 已启用，但现有测试显式导入）

### QA Policy

每个任务都包含 agent 可执行的 QA 场景。

- **单元测试**：Vitest + vi.mock/vi.fn
- **API 验证**：Bash（curl 验证服务端响应）
- **前端验证**：Playwright 用于 UI 交互测试

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1（立即开始 — 验证 + 基础设施）：
├── Task 1: 效果 YAML 往返验证测试 [quick]
├── Task 2: 修复 PackManagerTab.vue 文件夹名 [quick]
└── Task 3: 在 onMounted 中初始化 enabledPacks [quick]

Wave 2（Wave 1 之后 — 核心修复）：
└── Task 4: 修复 DataEditorPage.vue 保存/删除函数 [deep]

Wave 3（Wave 2 之后 — 测试）：
├── Task 5: 保存边缘情况的单元测试 [quick]
├── Task 6: PackManagerTab 单元测试 [quick]
└── Task 7: 运行完整测试套件 + 构建检查 [quick]

FINAL（所有实现任务后）：
├── F1: 计划合规审计（oracle）
├── F2: 代码质量审查（unspecified-high）
├── F3: 实际手动 QA（unspecified-high，Playwright）
└── F4: 范围保真度检查（deep）

关键路径：Task 1 → Task 4 → Task 5 → Task 7 → F1-F4
并行加速：相比顺序执行快约 40%
最大并发数：3（Wave 1）
```

### Dependency Matrix

| 任务 | 依赖    | 被阻塞 |
| ---- | ------- | ------ |
| 1    | -       | 4      |
| 2    | -       | 4, 6   |
| 3    | -       | 4      |
| 4    | 1, 2, 3 | 5, 7   |
| 5    | 4       | 7      |
| 6    | 2       | -      |
| 7    | 4, 5    | F1-F4  |

### Agent Dispatch Summary

- **Wave 1**: **3** — T1 → `quick`, T2 → `quick`, T3 → `quick`
- **Wave 2**: **1** — T4 → `deep`
- **Wave 3**: **3** — T5 → `quick`, T6 → `quick`, T7 → `quick`
- **FINAL**: **4** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. 效果 YAML 往返验证测试

  **What to do**:
  - 创建 `packages/web-ui/src/features/data-editor/__tests__/` 目录
  - 创建 `effect-yaml-roundtrip.test.ts`
  - 使用 `fs.readFile` 读取 `packs/base/data/effect_skill.yaml` 的前几条记录
  - 通过完整流水线运行每条记录：`parseYamlAnchoredDataset(content)` → 查找第一条记录 → `upsertYamlAnchoredRecord({ dataset, schema: effectDSLSchema, draft: clone, targetIndex })` → `stringifyYamlAnchoredDataset(dataset)`
  - 再次解析输出并断言 `id`、`trigger`、`priority`、`apply` 字段与原始数据匹配
  - 断言输出是有效的 YAML（`parseDocument` 不会抛出异常）
  - 测试锚点/别名的保留：如果原始数据使用 `<<: *`，确保输出也使用 `<<: *`（通过原始字符串片段检查）

  **Must NOT do**:
  - 不要修改 `effect_skill.yaml`
  - 不要创建临时文件 — 全部在内存中运行
  - 不要测试每条记录 — 5-10 条有代表性的记录即可

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - 原因：包含文件读取和解析逻辑的直接测试文件创建
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1（与 Tasks 2, 3 并行）
  - **Blocks**: Task 4（需要先确认流水线能处理效果数据）
  - **Blocked By**: None

  **References**:
  - `packages/web-ui/src/features/data-editor/schemas/yamlAnchoredRecords.ts:158-211` — `parseYamlAnchoredDataset` 实现；参考数据集的构造方式
  - `packages/web-ui/src/features/data-editor/schemas/yamlAnchoredRecords.ts:284-321` — `upsertYamlAnchoredRecord` 实现；理解 schema 参数的用法
  - `packages/web-ui/src/features/data-editor/schemas/yamlAnchoredRecords.ts:342-344` — `stringifyYamlAnchoredDataset` 实现
  - `packages/web-ui/src/features/data-editor/game-config/base.ts:9` — `effectDSLSchema` 导入和 `dataFile: 'effect_skill.yaml'`
  - `packs/base/data/effect_skill.yaml` — 包含 YAML 锚点/别名的真实效果数据（12,002 行）
  - `packages/web-ui/src/composition/__tests__/animationController.test.ts` — 现有测试模式：vitest + vi.fn()，显式导入 describe/it/expect

  **Acceptance Criteria**:
  - [ ] 测试文件存在：`packages/web-ui/src/features/data-editor/__tests__/effect-yaml-roundtrip.test.ts`
  - [ ] `pnpm --filter @arcadia-eternity/web-ui run test:run -- effect-yaml-roundtrip` → PASS（0 failures）
  - [ ] 测试覆盖至少 5 条效果记录
  - [ ] 测试验证锚点/别名在往返后得以保留

  **QA Scenarios**:

  ```
  Scenario: 带别名的效果记录的往返转换
    Tool: Bash (vitest)
    Preconditions: effectDSLSchema 可从 '@arcadia-eternity/schema' 导入
    Steps:
      1. 读取 effect_skill.yaml 内容
      2. 调用 parseYamlAnchoredDataset(content)
      3. 选择一条包含 '<<: *' 的记录（例如包含 merge key 的记录）
      4. 克隆记录的 .value 并调用 upsertYamlAnchoredRecord
      5. 调用 stringifyYamlAnchoredDataset(dataset)
      6. 断言输出包含 '<<: *'（别名得以保留）
      7. 使用 parseDocument 解析输出，验证无 YAML 错误
    Expected Result: 输出是有效的 YAML，id 字段匹配，锚点引用得以保留
    Failure Indicators: parseDocument errors 不为空，或 id 不匹配，或 '<<: *' 丢失
    Evidence: .sisyphus/evidence/task-1-effect-roundtrip.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-1-effect-roundtrip.txt` — 测试运行输出，显示通过的断言数量

  **Commit**: YES
  - Message: `test(data-editor): add effect YAML round-trip validation`
  - Files: `packages/web-ui/src/features/data-editor/__tests__/effect-yaml-roundtrip.test.ts`

- [x] 2. 修复 PackManagerTab.vue — 存储文件夹名而非包 ID

  **What to do**:
  - 编辑 `packages/web-ui/src/features/data-editor/components/layout/PackManagerTab.vue`
  - 第 39 行：将 `p.id || p.folderName` 改为 `p.folderName`
  - 第 60 行：将 `p.id || p.folderName` 改为 `p.folderName`
  - 根本原因：基础包的 `p.id = 'arcadia-eternity.base'` 但 `p.folderName = 'base'`。`doSave()` 中的 `isBase` 检查（`packFolder === 'base'`）在此修复之前从未匹配
  - 验证：在 `refresh()` 和 `togglePack()` 两个函数中都更新了 `enabledPacks`

  **Must NOT do**:
  - 不要改变 `enabledPacks` 的类型或结构
  - 不要修改包启用/禁用的切换逻辑
  - 不要添加新的依赖或导入

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - 原因：两行改动，影响面清晰
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1（与 Tasks 1, 3 并行）
  - **Blocks**: Task 4, 6
  - **Blocked By**: None

  **References**:
  - `packages/web-ui/src/features/data-editor/components/layout/PackManagerTab.vue:35-39` — `refresh()` 函数，第 39 行需修改
  - `packages/web-ui/src/features/data-editor/components/layout/PackManagerTab.vue:56-60` — `togglePack()` 函数，第 60 行需修改
  - `packages/web-ui/src/features/data-editor/DataEditorPage.vue:87-90` — 使用 `enabledPacks[0]` 的消费者；需要文件夹名
  - `packages/web-ui/src/features/data-editor/components/layout/BattleBottomDrawer.vue:18` — 使用 `enabledPacks[0]` 的消费者；需要文件夹名
  - `packages/web-ui/electron/main.mjs:22` — `BASE_PACK_FOLDER = 'base'`；确认基础的文件夹名就是 `'base'`
  - `packages/web-ui/electron/main.mjs:922-944` — `buildWorkspaceIndex()` 展示 `folderName: 'base'` 和 `id: 'arcadia-eternity.base'`

  **Acceptance Criteria**:
  - [ ] `refresh()` 后 `editorState.packFilters.enabledPacks` 包含 `'base'`（而非 `'arcadia-eternity.base'`）
  - [ ] `togglePack()` 后 `enabledPacks` 使用文件夹名更新
  - [ ] 现有 lint 检查通过（`pnpm run lint` 来自 web-ui 目录）

  **QA Scenarios**:

  ```
  Scenario: 获取工作区包列表后 enabledPacks 包含文件夹名
    Tool: Bash (vitest)
    Preconditions: listWorkspacePacks 返回 [{ folderName: 'base', id: 'arcadia-eternity.base', enabled: true }]
    Steps:
      1. 使用 vi.mock 模拟 listWorkspacePacks
      2. 挂载 PackManagerTab 组件
      3. 等待 refresh() 完成（await nextTick）
      4. 断言 editorState.packFilters.enabledPacks 深等于 ['base']
      5. 断言 enabledPacks[0] === 'base'（而非 'arcadia-eternity.base'）
    Expected Result: enabledPacks = ['base']
    Failure Indicators: enabledPacks = ['arcadia-eternity.base']
    Evidence: .sisyphus/evidence/task-2-packmanagertab-fix.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-2-packmanagertab-fix.txt` — 测试运行输出

  **Commit**: YES
  - Message: `fix(data-editor): store folderName instead of pack ID in enabledPacks`
  - Files: `packages/web-ui/src/features/data-editor/components/layout/PackManagerTab.vue`

- [x] 4. 修复 DataEditorPage.vue 保存/删除函数

  **What to do**:
  编辑 `packages/web-ui/src/features/data-editor/DataEditorPage.vue`，修复所有三个函数：

  **4a. `doSave()`（第 69-139 行）：**
  - 第 72 行：在 `if (!kind || !id) return` **之前**添加 `console.warn('[DataEditor] Save skipped: no entity type or record selected')`
  - 第 75 行：在清空稿件的 return **之前**添加 `console.warn('[DataEditor] Save skipped: empty draft')`
  - 第 93 行：从条件中**移除** `kind === 'effects'`。改为 `if (!cfg) { editorState.isDirty = false; console.warn('[DataEditor] Save skipped: no entity config for', kind); return }`
  - 第 132-133 行：在 `ElMessage.success` **之前**添加 `console.log('[DataEditor] Saved', id, 'to', isBase ? 'base/' : packFolder + '/', relativePath)`

  **4b. `doDelete()`（第 168-222 行）：**
  - 在第 186 行之后（`const packFolder = ...`），添加与 `doSave()` 相同的 `isBase` 逻辑：
    ```typescript
    const isBase = packFolder === 'base' && window.arcadiaDesktop?.readBasePackFile
    ```
  - 将第 191-193 行的读取逻辑替换为与 `doSave` 相同的 `isBase` 分支（读取 manifest 和 data file）
  - 将第 203 行的写入逻辑替换为与 `doSave` 相同的 `isBase` 分支
  - 在第 216 行（`ElMessage.success`）**之前**添加 `console.log('[DataEditor] Deleted', id, 'from', isBase ? 'base/' : packFolder + '/', relativePath)`
  - 将删除成功/失败从 `'[DataEditor] Delete failed:'` 改为更具体的描述

  **4c. `doBatchDelete()`（第 224-291 行）：**
  - 应用与 `doDelete` 相同的修改：添加 `isBase` 逻辑，使用 `isBase` 分支进行读取/写入，添加 `console.log`

  **Must NOT do**:
  - 不要修改 `doCreate()`（它委托给 `doSave()`）
  - 不要改变错误处理模式（保持 `ElMessage.error` + `console.error`）
  - 不要在应用 `isBase` 检查时改变 `resolveManifestDataPath` 的导入来源

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - 原因：多函数编辑，需要细致处理以确保三个函数间的一致性，同时保留现有的 YAML 锚点保留逻辑
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2（单独）
  - **Blocks**: Tasks 5, 7
  - **Blocked By**: Tasks 1, 2, 3

  **References**:
  - `packages/web-ui/src/features/data-editor/DataEditorPage.vue:69-139` — `doSave()` 函数（备份当前实现后再编辑）
  - `packages/web-ui/src/features/data-editor/DataEditorPage.vue:168-222` — `doDelete()` 函数
  - `packages/web-ui/src/features/data-editor/DataEditorPage.vue:224-291` — `doBatchDelete()` 函数
  - `packages/web-ui/src/features/data-editor/DataEditorPage.vue:87-130` — `doSave()` 中的 `isBase` 检查模式；将相同的模式复制到 `doDelete` 和 `doBatchDelete`
  - `packages/web-ui/src/features/data-editor/game-config/seer2.ts:6-44` — Species 实体配置（`dataFile: 'species.yaml'`）— 在保存后使用
  - `packages/web-ui/src/features/data-editor/game-config/base.ts:4-9` — Effect 实体配置（`dataFile: 'effect_skill.yaml'`，`schema: effectDSLSchema`）— 在移除效果跳过之前验证
  - `packages/web-ui/src/features/data-editor/schemas/yamlAnchoredRecords.ts:284-321` — `upsertYamlAnchoredRecord` 接口（`schema` 参数需要 TypeBox TSchema）
  - `packages/web-ui/electron/main.mjs:22` — `BASE_PACK_FOLDER = 'base'`；确认 PackManagerTab 修复后 `packFolder === 'base'` 能正确匹配
  - `packages/web-ui/electron/main.mjs:1614-1628` — `writeBasePackFile` IPC 处理器（显示写入路径：`findBundledBasePackDir()/relativePath`）
  - `packages/web-ui/electron/main.mjs:1159-1173` — `writeWorkspacePackFile` 函数（显示写入路径：`packsDir/folderName/relativePath`）

  **Acceptance Criteria**:
  - [ ] 修复后保存 Species 记录时，`console.log` 显示类似 `'[DataEditor] Saved species_001 to base/ data/species.yaml'` 的输出
  - [ ] 保存 Effect 记录时，`writeWorkspacePackFile` 或 `writeBasePackFile` 被调用（不再静默跳过）
  - [ ] 删除基础包中的记录时，使用 `readBasePackFile`/`writeBasePackFile`（与 `doSave` 模式一致）
  - [ ] 保存因缺少实体类型而跳过时，`console.warn` 显示 `'Save skipped: no entity type or record selected'`
  - [ ] `ElMessage.success('已保存')` 仍然显示用于用户反馈
  - [ ] `ElMessage.error` 仍然显示错误信息，并附带有意义的消息

  **QA Scenarios**:

  ```
  Scenario: 保存效果记录会写入磁盘（不再跳过）
    Tool: Bash (vitest)
    Preconditions: editorState.selectedEntityType = 'effects'，selectedRecordId = 'effect_test'，draftRef.value = { id: 'effect_test', trigger: [], priority: 0, apply: {...}, tags: [] }，enabledPacks = ['base']
    Steps:
      1. 模拟 window.arcadiaDesktop.readBasePackFile 返回有效的 manifest 和 effect_skill.yaml 内容
      2. 模拟 window.arcadiaDesktop.writeBasePackFile 作为 vi.fn()
      3. 调用 doSave()
      4. 断言 writeBasePackFile 被调用（不是 writeWorkspacePackFile）
      5. 断言 writeBasePackFile 的 relativePath 参数包含 'effect_skill.yaml'
      6. 断言 console.log 被调用并包含 'Saved effect_test'
    Expected Result: writeBasePackFile 被调用，参数中 effect_skill.yaml 和正确的 YAML 内容
    Failure Indicators: 函数提前返回（静默），writeBasePackFile 未被调用，或者 console.warn 显示跳过原因
    Evidence: .sisyphus/evidence/task-4-effects-save.txt

  Scenario: 无实体类型选中的保存会提前返回并记录日志
    Tool: Bash (vitest)
    Preconditions: editorState.selectedEntityType = null，selectedRecordId = 'some_id'
    Steps:
      1. 调用 doSave()
      2. 断言 console.warn 被调用并包含 'no entity type or record selected'
      3. 断言 ElMessage.success 未被调用
      4. 断言 writeWorkspacePackFile 和 writeBasePackFile 均未被调用
    Expected Result: console.warn 显示跳过原因，无磁盘 I/O
    Failure Indicators: 函数未提前返回（尝试写入），或无日志输出
    Evidence: .sisyphus/evidence/task-4-silent-return.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-4-effects-save.txt` — 效果保存测试的输出
  - [ ] `task-4-silent-return.txt` — 提前返回测试的输出

  **Commit**: YES
  - Message: `fix(data-editor): fix save/delete persistence — logging, effects, isBase`
  - Files: `packages/web-ui/src/features/data-editor/DataEditorPage.vue`

- [x] 3. 在 DataEditorPage onMounted 中初始化 enabledPacks

  **What to do**:
  - 编辑 `packages/web-ui/src/features/data-editor/DataEditorPage.vue`
  - 在 `onMounted` 的 `listWorkspacePacks()` 调用之后（约第 353 行），新增代码用已启用的包文件夹名填充 `editorState.packFilters.enabledPacks`
  - 代码：`editorState.packFilters.enabledPacks = packs.value.filter(p => p.enabled).map(p => p.folderName)`
  - 确保这行代码位于 `packs.value = await listWorkspacePacks()` 之后
  - 这解决了 PackManagerTab 隐藏于可折叠面板中时 `enabledPacks` 为空的问题

  **Must NOT do**:
  - 不要从 PackManagerTab 移除 `enabledPacks` 的填充逻辑（保留双重填充以确保冗余）
  - 不要修改 `packs` ref 的结构
  - 不要改变初始化顺序

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - 原因：单一的初始化行，影响面清晰
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1（与 Tasks 1, 2 并行）
  - **Blocks**: Task 4
  - **Blocked By**: None

  **References**:
  - `packages/web-ui/src/features/data-editor/DataEditorPage.vue:348-368` — `onMounted` 函数；在第 353 行之后添加初始化代码
  - `packages/web-ui/src/features/data-editor/DataEditorPage.vue:302` — `packs` ref 声明：`const packs = ref<WorkspacePackSummary[]>([])`
  - `packages/web-ui/src/features/data-editor/components/layout/PackManagerTab.vue:35-39` — 用于双重填充的现有模式
  - `packages/web-ui/src/services/packWorkspace.ts:57` — `normalizeWorkspacePackSummary` 展示 `folderName` 和 `id` 字段

  **Acceptance Criteria**:
  - [ ] 页面挂载后，`editorState.packFilters.enabledPacks` 非空（假设至少有一个已启用的包）
  - [ ] `enabledPacks[0]` 是一个有效的文件夹名（如 `'base'`）
  - [ ] 当 PackManagerTab 之后填充时，不会出现重复条目

  **QA Scenarios**:

  ```
  Scenario: 页面挂载后 enabledPacks 已填充
    Tool: Playwright（或 Bash（vitest））
    Preconditions: 应用加载了数据编辑器页面
    Steps:
      1. 导航到数据编辑器页面（/pack-editor）
      2. 等待加载旋转器消失
      3. 在浏览器控制台中执行：获取 Vue 应用实例并检查 editorState.packFilters.enabledPacks
      4. 断言 enabledPacks 长度 > 0
      5. 断言 enabledPacks[0] 是字符串且不包含 '.'（文件夹名，非包 ID）
    Expected Result: enabledPacks = ['base'] 或类似的文件夹名
    Failure Indicators: enabledPacks = [] 或 enabledPacks = ['arcadia-eternity.base']
    Evidence: .sisyphus/evidence/task-3-enabledpacks-init.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-3-enabledpacks-init.txt` — 控制台输出显示 enabledPacks 的值

  **Commit**: YES
  - Message: `fix(data-editor): initialize enabledPacks on DataEditorPage mount`
  - Files: `packages/web-ui/src/features/data-editor/DataEditorPage.vue`

- [x] 4. 修复 DataEditorPage.vue 保存/删除函数

  **What to do**:
  编辑 `packages/web-ui/src/features/data-editor/DataEditorPage.vue`，修复 `doSave()`、`doDelete()` 和 `doBatchDelete()`：

  **4a. `doSave()`（第 69-139 行）：**
  - 第 72 行：在 `if (!kind || !id) return` 之前添加 `console.warn('[DataEditor] Save skipped: no entity type or record selected')`
  - 第 75 行：在空稿件的 return 之前添加 `console.warn('[DataEditor] Save skipped: empty draft')`
  - 第 93-96 行：从条件中移除 `kind === 'effects'`。改为仅有 `if (!cfg)` 的 null-guard，并添加 console.warn
  - 第 132-133 行：在 `ElMessage.success` 之前添加 `console.log('[DataEditor] Saved', id, 'to', isBase ? 'base/' : packFolder + '/', relativePath)`

  **4b. `doDelete()`（第 168-222 行）：**
  - 在 `const packFolder = ...` 之后添加与 `doSave()` 相同的 `isBase` 检测
  - 用 `isBase` 分支替换 manifest 读取（第 191 行）和文件读取（第 193 行）
  - 用 `isBase` 分支替换文件写入（第 203 行）
  - 在 `ElMessage.success` 之前添加 `console.log`

  **4c. `doBatchDelete()`（第 224-291 行）：**
  - 应用与 `doDelete()` 相同的 `isBase` 逻辑

  **Must NOT do**:
  - 不要修改 `doCreate()`
  - 不要改变错误处理模式

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - 原因：多函数的一致性修复，涉及 YAML 锚点保留逻辑
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2（单独）
  - **Blocks**: Tasks 5, 7
  - **Blocked By**: Tasks 1, 2, 3

  **References**:
  - `packages/web-ui/src/features/data-editor/DataEditorPage.vue:87-130` — `doSave()` 中的 `isBase` 模式（复制到 delete 函数）
  - `packages/web-ui/src/features/data-editor/DataEditorPage.vue:69-139` — `doSave()` 完整函数
  - `packages/web-ui/src/features/data-editor/DataEditorPage.vue:168-222` — `doDelete()` 完整函数
  - `packages/web-ui/src/features/data-editor/DataEditorPage.vue:224-291` — `doBatchDelete()` 完整函数
  - `packages/web-ui/electron/main.mjs:22` — `BASE_PACK_FOLDER = 'base'`
  - `packages/web-ui/electron/main.mjs:1614-1628` — `writeBasePackFile` IPC 处理器
  - `packages/web-ui/electron/main.mjs:1159-1173` — `writeWorkspacePackFile` 函数

  **Acceptance Criteria**:
  - [ ] 保存 Species 记录时 `console.log` 显示 `'[DataEditor] Saved species_001 to base/ data/species.yaml'`
  - [ ] 保存 Effect 记录时调用 `writeWorkspacePackFile` 或 `writeBasePackFile`（不再跳过）
  - [ ] 保存因缺少实体类型而跳过时 `console.warn` 有明确提示
  - [ ] `ElMessage.success('已保存')` 和 `ElMessage.error(...)` 仍然正常显示

  **QA Scenarios**:

  ```
  Scenario: 保存效果记录写入磁盘
    Tool: Bash (vitest)
    Preconditions: selectedEntityType = 'effects', enabledPacks = ['base'], valid draft
    Steps:
      1. 模拟 window.arcadiaDesktop.readBasePackFile 返回有效 YAML
      2. 模拟 window.arcadiaDesktop.writeBasePackFile
      3. 调用 doSave()
      4. 断言 writeBasePackFile 被调用且 relativePath 包含 'effect_skill.yaml'
      5. 断言 console.log 包含 'Saved'
    Expected Result: writeBasePackFile 被调用
    Evidence: .sisyphus/evidence/task-4-effects-save.txt

  Scenario: 无实体类型的保存提前返回并记录日志
    Tool: Bash (vitest)
    Preconditions: selectedEntityType = null
    Steps:
      1. 调用 doSave()
      2. 断言 console.warn 包含 'no entity type or record selected'
      3. 断言无磁盘 I/O
    Expected Result: console.warn 显示跳过原因
    Evidence: .sisyphus/evidence/task-4-silent-return.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-4-effects-save.txt` — 效果保存测试输出
  - [ ] `task-4-silent-return.txt` — 提前返回测试输出

  **Commit**: YES
  - Message: `fix(data-editor): fix save/delete persistence — logging, effects, isBase`
  - Files: `packages/web-ui/src/features/data-editor/DataEditorPage.vue`

- [x] 5. 保存/删除边缘情况的单元测试

  **What to do**:
  - 创建 `packages/web-ui/src/features/data-editor/__tests__/save-delete.test.ts`
  - 测试 1：无实体类型的保存 — 断言 `console.warn` 显示跳过原因
  - 测试 2：无记录的保存 — 断言跳过
  - 测试 3：空稿件的保存 — 断言跳过
  - 测试 4：基础包效果保存 — 模拟 `window.arcadiaDesktop`，断言 `writeBasePackFile` 被调用
  - 测试 5：工作区包保存 — 模拟 `writeWorkspacePackFile`，断言工作区路径被使用
  - 测试 6：保存失败处理 — 模拟抛出异常，断言 `console.error` + `ElMessage.error`
  - 使用 `vi.mock` 模拟 `@/services/packWorkspace` 和 `@/utils/env`
  - 使用 `vi.stubGlobal` 模拟 `window.arcadiaDesktop`

  **注意**：`doSave()`/`doDelete()` 在 `<script setup>` 中，不能直接导出。需要：
  - 创建 `composables/useSaveHandlers.ts` 将函数提取为可导出的组合式函数
  - DataEditorPage.vue 从该模块导入

  **Must NOT do**:
  - 不要修改生产代码来简化测试

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES（Wave 3，与 Tasks 6, 7 并行）
  - **Blocks**: None
  - **Blocked By**: Task 4

  **References**:
  - `packages/web-ui/src/features/data-editor/DataEditorPage.vue:69-291` — 要测试的函数
  - `packages/web-ui/src/composition/__tests__/animationController.test.ts` — 现有测试模式
  - `packages/web-ui/src/services/packWorkspace.ts:332-343` — `writeWorkspacePackFile` 签名
  - `packages/web-ui/src/utils/env.ts` — `isDesktop`, `getDesktopApi` 导出
  - `packages/web-ui/electron/preload.cjs:16-19` — 桌面 API 方法名

  **Acceptance Criteria**:
  - [ ] 测试文件存在：`packages/web-ui/src/features/data-editor/__tests__/save-delete.test.ts`
  - [ ] 全部 6 个测试 PASS
  - [ ] 至少 1 个测试覆盖 doDelete
  - [ ] 测试中无真实文件 I/O

  **QA Scenarios**:

  ```
  Scenario: 全部 6 个测试通过
    Tool: Bash (vitest)
    Steps:
      1. 运行 pnpm --filter @arcadia-eternity/web-ui run test:run -- save-delete
      2. 断言退出码 === 0
      3. 断言输出显示 "6 passed"
    Expected Result: 6 passed, 0 failed
    Evidence: .sisyphus/evidence/task-5-save-delete-tests.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-5-save-delete-tests.txt`

  **Commit**: YES
  - Message: `test(data-editor): add unit tests for save/delete edge cases`
  - Files: `packages/web-ui/src/features/data-editor/__tests__/save-delete.test.ts`, `packages/web-ui/src/features/data-editor/composables/useSaveHandlers.ts`

- [x] 6. PackManagerTab 单元测试

  **What to do**:
  - 创建 `packages/web-ui/src/features/data-editor/__tests__/pack-manager.test.ts`
  - 测试 1：refresh 后 enabledPacks 包含文件夹名
  - 测试 2：togglePack 后 enabledPacks 正确更新
  - 使用 `@vue/test-utils` 挂载组件，配合 `provideEditorState()`
  - 模拟 `@/services/packWorkspace` 的 `listWorkspacePacks` 和 `setWorkspacePackEnabled`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES（Wave 3，与 Tasks 5, 7 并行）
  - **Blocks**: None
  - **Blocked By**: Task 2

  **References**:
  - `packages/web-ui/src/features/data-editor/components/layout/PackManagerTab.vue` — 完整组件
  - `packages/web-ui/src/features/data-editor/composables/useEditorState.ts:29-45` — `provideEditorState()`

  **Acceptance Criteria**:
  - [ ] 测试文件存在
  - [ ] 测试 1 和 2 均 PASS
  - [ ] 断言 `enabledPacks` 包含 `'base'` 而非 `'arcadia-eternity.base'`

  **QA Scenarios**:

  ```
  Scenario: 模拟基础包的 refresh 设置 enabledPacks
    Tool: Bash (vitest)
    Steps:
      1. 模拟 listWorkspacePacks 返回基础包
      2. 调用 refresh() 并等待
      3. 断言 enabledPacks = ['base']
    Expected Result: enabledPacks 匹配文件夹名
    Evidence: .sisyphus/evidence/task-6-pack-manager-test.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-6-pack-manager-test.txt`

  **Commit**: YES（与 Task 5 一起）
  - Message: `test(data-editor): add PackManagerTab unit tests`
  - Files: `packages/web-ui/src/features/data-editor/__tests__/pack-manager.test.ts`

- [x] 7. 运行完整测试套件 + 构建检查

  **What to do**:
  - 运行 `pnpm --filter @arcadia-eternity/web-ui run test:run` — 验证全部通过
  - 运行 `pnpm --filter @arcadia-eternity/web-ui run lint` — 验证无 lint 错误
  - 运行 `pnpm run test:types`（来自根目录）— 验证 TypeScript 编译
  - 如有测试失败：读取输出，修复，重新运行

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: `[]`

  **Parallelization**:
  - **Can Run In Parallel**: YES（Wave 3，与 Tasks 5, 6 并行）
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 4, 5

  **Acceptance Criteria**:
  - [ ] `pnpm test:run` → 全部 PASS
  - [ ] `pnpm run lint` → 无错误
  - [ ] `pnpm run test:types` → 无 TypeScript 错误

  **QA Scenarios**:

  ```
  Scenario: 完整测试套件全部通过
    Tool: Bash
    Steps:
      1. 运行 pnpm --filter @arcadia-eternity/web-ui run test:run
      2. 断言退出码 === 0，"0 failing"
      3. 运行 pnpm run lint，断言无错误
    Evidence: .sisyphus/evidence/task-7-full-suite.txt
  ```

  **Evidence to Capture**:
  - [ ] `task-7-full-suite.txt`

  **Commit**: NO（验证步骤）

---

## Final Verification Wave

> 4 个审查 agent 并行运行。全部必须 APPROVE。向用户展示合并结果并获取明确的 "okay"。

- [x] F1. **计划合规审计** — `oracle`
      端到端阅读计划。检查每个 "Must Have"：验证实现存在。检查每个 "Must NOT Have"：搜索代码库中的禁止模式。检查证据文件存在于 `.sisyphus/evidence/`。将交付物与计划对照。
      输出：`Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **代码质量审查** — `unspecified-high`
      运行 `tsc --noEmit` + linter + `bun test`。检查所有已更改文件中的：`as any`/`@ts-ignore`、空 catch、prod 中的 console.log、注释掉的代码、未使用的导入。检查 AI slop：过多的注释、过度抽象、通用名称。
      输出：`Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | VERDICT`

- [x] F3. **实际手动 QA** — `unspecified-high`（+ `playwright` skill 如果有 UI）
      从干净状态开始。执行所有任务中的每个 QA 场景。测试跨任务集成。测试边缘情况：空状态、无效输入、快速操作。保存到 `.sisyphus/evidence/final-qa/`。
      输出：`Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **范围保真度检查** — `deep`
      对于每个任务：读取 "What to do"，读取实际 diff。验证 1:1 — spec 中的所有内容都已构建，spec 之外的内容都未构建。检查 "Must NOT do" 的合规性。检测跨任务污染。
      输出：`Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Task 1**: `test(data-editor): add effect YAML round-trip validation` — `__tests__/effect-yaml-roundtrip.test.ts`
- **Task 2**: `fix(data-editor): store folderName instead of pack ID in enabledPacks` — `PackManagerTab.vue`
- **Task 3**: `fix(data-editor): initialize enabledPacks on DataEditorPage mount` — `DataEditorPage.vue`
- **Task 4**: `fix(data-editor): fix save/delete persistence — logging, effects, isBase` — `DataEditorPage.vue`
- **Task 5**: `test(data-editor): add unit tests for save/delete edge cases` — `__tests__/save-delete.test.ts`, `composables/useSaveHandlers.ts`
- **Task 6**: `test(data-editor): add PackManagerTab unit tests` — `__tests__/pack-manager.test.ts`
- **Task 7**: 无提交（验证步骤）

---

## Success Criteria

### Verification Commands

```bash
# 运行所有测试
pnpm --filter @arcadia-eternity/web-ui run test:run

# 预期：全部通过，0 failures

# Lint 检查
pnpm --filter @arcadia-eternity/web-ui run lint

# TypeScript 检查
pnpm run test:types
```

### Final Checklist

- [ ] 全部 "Must Have" 已实现
- [ ] 全部 "Must NOT Have" 已规避
- [ ] 全部测试通过
- [ ] 效果实体保存到磁盘
- [ ] `console.log` 输出显示所有保存/删除的文件路径
- [ ] `console.warn` 输出显示所有跳过的保存/删除及其原因
