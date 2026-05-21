# Data Editor File Management

## TL;DR

> **Quick Summary**: 统一多文件数据管理——追踪每条记录的来源文件，支持创建记录时选择目标文件，启用文件管理 UI（新建/删除/重命名）。
>
> **Deliverables**:
>
> - 修复 `findFileKind` 缺少 effects 的 bug
> - gameDataStore 添加 sourceFile 元数据
> - doCreate 接受 targetFile 参数
> - DataTableToolbar 文件管理下拉框从 disabled placeholder 变为实际功能
> - PropertyPanel 显示来源文件标签
> - 提取共享的 file resolver 消除线性扫描
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: sourceFile metadata → doCreate targetFile → UI widgets

---

## Context

### Original Request

重新来，统一数据编辑器的多文件管理逻辑。每个记录应注明来自哪个文件，创建时可选择目标文件，文件管理 UI 应能新建/删除文件。

### Research Findings

- `findFileKind` 有 bug：硬编码的实体类型列表缺少 `'effects'`，导致 effects 的文件 CRUD 操作全部失败
- `useDataFileManager` 已有完整的 createDataFile/deleteDataFile/renameDataFile/moveRecords，但完全未接入任何 UI 组件
- `gameDataStore.loadWorkspaceLayer` 通过 PackLoader 加载后，所有文件的记录被 `Object.assign` 合并，丢失来源文件信息
- `deleteDataFile` 不检查文件是否有记录——可以删除包含数据的文件
- `EntityConfig.dataFile` 是单个默认文件名，`manifest.data[kind]` 才是权威的文件数组
- effects 分布在 5 个文件中，marks 分布在 4 个文件中

### Metis Review

**Identified Gaps** (addressed):

- Bug: `findFileKind` hardcoded entity types missing 'effects' → Task 1 修复
- 风险: `deleteDataFile` 无数据检查 → Task 8 添加安全守卫
- 风险: 哈希 ID 冲突 → 加载时检测并警告
- 范围: 所有实体类型适用（当前 effects+marks，but 基础设施支持所有类型）

---

## Work Objectives

### Core Objective

统一数据编辑器的文件管理，使每个记录可溯源到其来源 YAML 文件，支持创建和删除数据文件，并让用户选择新建记录的保存位置。

### Concrete Deliverables

- `useDataFileManager.ts` — 修复 findFileKind，添加安全守卫
- `gameData.ts` — 添加 sourceFile 元数据记录
- `useSaveHandlers.ts` — doCreate 接受 targetFile，消除线性扫描
- `useEditorState.ts` — 添加 selectedDataFile, availableDataFiles
- `DataTableToolbar.vue` — 启用文件管理下拉框
- `PropertyPanel.vue` — 显示来源文件标签

### Must Have

- 每条记录可追溯到来源文件
- 创建记录时可选择保存到哪个文件
- 文件管理下拉框中的"新建文件"、"删除文件"操作可用
- `findFileKind` 修复（包含 effects）
- `deleteDataFile` 检查文件是否为空

### Must NOT Have (Guardrails)

- 不改动 PackLoader（@arcadia-eternity/pack-loader）
- 不改动 Electron main.mjs
- 不实现导入/导出文件功能（下拉框中的 disabled 项保留）
- 不实现拖放移动记录
- 不添加文件 diff/merge 视图
- species/skills 单文件类型行为不变

---

## Verification Strategy

### Test Decision

- **Infrastructure exists**: YES（Vitest v4 + jsdom + Vue Test Utils）
- **Automated tests**: Tests-after（先修复，后测试）
- **Framework**: Vitest

### QA Policy

每个任务包含 Agent 可执行的 QA 场景。使用 Vitest 做单元测试，Playwright 做 UI 验证。

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1（立即开始 — 基础修复）：
├── Task 1: 修复 findFileKind + 去重 reloadDataFromDisk [quick]
├── Task 2: 添加 sourceFile 元数据到 gameData store [deep]
├── Task 3: 提取共享 file resolver 工具 [quick]
└── Task 4: 添加文件状态到 EditorState [quick]

Wave 2（Wave 1 之后 — 核心逻辑）：
├── Task 5: save/delete 使用 sourceFile 元数据（消除线性扫描）[deep]
├── Task 6: doCreate 支持 targetFile 参数 [deep]
├── Task 7: 接入 useDataFileManager 到 DataEditorPage [quick]
└── Task 8: 文件操作安全守卫 [quick]

Wave 3（Wave 2 之后 — UI）：
├── Task 9: DataTableToolbar 文件管理下拉框 [visual-engineering]
├── Task 10: PropertyPanel 显示来源文件 [visual-engineering]
└── Task 11: EditorWorkspace 文件过滤 [quick]

Wave 4（Tests）：
└── Task 12: 单元测试 + per-file 往返测试 + Playwright QA

关键路径：Task 2 → Task 5 → Task 6 → Task 9
```

---

## TODOs

- [x] 1. 修复 findFileKind + 去重 reloadDataFromDisk

  **What to do**:
  - **修复 `useDataFileManager.ts` 第 244 行**：`findFileKind` 的实体类型列表缺少 `'effects'`。将 `['species', 'skills', 'marks']` 改为从 manifest 中动态推导，或至少加上 `'effects'`
  - **修复 `inferKindFromPath`（第 266-272 行）**：`if (lower.includes('mark'))` 会错误匹配文件名中包含 "mark" 的非 mark 文件。应该使用更精确的匹配（如 `lower === 'mark.yaml'` 或 `lower.startsWith('mark')`）
  - **去重 `reloadDataFromDisk`**：该函数在 `DataEditorPage.vue` 和 `useSaveHandlers.ts` 中重复。保留在 `useSaveHandlers.ts`，`DataEditorPage.vue` 从那里导入

  **Acceptance Criteria**:
  - [ ] `createDataFile('effects', 'test.yaml')` 成功执行（不抛异常）
  - [ ] `renameDataFile('effect_skill.yaml', 'new_name.yaml')` 正确更新 manifest
  - [ ] `reloadDataFromDisk` 只在 `useSaveHandlers.ts` 中定义

  **QA Scenarios**:

  ```
  Scenario: 对 effects 类型新建文件成功
    Tool: Bash (vitest)
    Steps:
      1. 模拟 manifest 包含 effects 文件列表
      2. 调用 createDataFile('effects', 'new_effect.yaml')
      3. 断言不抛异常，manifest 更新
    Evidence: .sisyphus/evidence/task-1-findfilekind.txt
  ```

  **Recommended Agent Profile**: `quick` | **Parallel**: Wave 1 (with Tasks 2-4)

- [x] 2. 添加 sourceFile 元数据到 gameData store

  **What to do**:
  - 修改 `gameData.ts` 中的 `WorkspaceGameDataLayer` 接口，添加 `sourceFiles: Record<string, Record<string, string>>`（kind → recordId → sourceFile）
  - 修改 `loadWorkspaceLayer`：PackLoader 加载后，逐文件读取 YAML，为每个记录建立 `recordId → sourceFile` 映射
  - 方法：不修改 PackLoader，而是在 `loadWorkspaceLayer` 中额外加载原始文件来构建映射
  - 或者：利用 manifest 的 data 字段，为每个文件逐个读取并解析建立映射
  - 添加 getter：`getRecordSourceFile(kind: string, recordId: string): string | null`
  - 确保 sourceFile 包含完整的相对路径（如 `data/effect_skill.yaml`）

  **Acceptance Criteria**:
  - [ ] 加载后，`getRecordSourceFile('effects', 'effect_skill_reduce_stat_5_percent')` 返回 `'data/effect_skill.yaml'`
  - [ ] 加载后，`getRecordSourceFile('effects', 'effect_ability_xxx')` 返回 `'data/effect_ability.yaml'`
  - [ ] 对于 skills（单文件），返回 `'data/skill.yaml'`

  **QA Scenarios**:

  ```
  Scenario: sourceFile 映射在加载后正确
    Tool: Bash (vitest)
    Steps:
      1. 模拟 packWorkspace 返回多文件 effects 数据
      2. 调用 gameDataStore.initialize()
      3. 断言 getRecordSourceFile('effects', skill_id) 返回 skill 文件
      4. 断言 getRecordSourceFile('effects', ability_id) 返回 ability 文件
    Evidence: .sisyphus/evidence/task-2-sourcefile.txt
  ```

  **Recommended Agent Profile**: `deep` | **Parallel**: Wave 1 (with Tasks 1,3,4)

- [x] 3. 提取共享 file resolver 工具

  **What to do**:
  - 创建 `packages/web-ui/src/features/data-editor/utils/fileResolver.ts`
  - 提取函数 `resolveTargetFile(args)`:
    ```
    resolveTargetFile({ manifest, kind, recordId, packFolder, isBase }) → { filePath, dataset, index } | null
    ```
  - 遍历 `manifest.data[kind]`，读取每个文件，搜索 recordId
  - 找到返回 `{ filePath, dataset, index }`，未找到返回 `null`
  - `doSave`、`doDelete`、`doBatchDelete` 使用此工具替代各自的线性扫描
  - 如果 sourceFile 元数据已可用（Task 2），优先使用 sourceFile 直接定位文件（跳过扫描）

  **Acceptance Criteria**:
  - [ ] `doSave`、`doDelete`、`doBatchDelete` 都使用 fileResolver
  - [ ] 不再有重复的 for-of dataFiles 循环

  **QA Scenarios**: 同 Task 5

  **Recommended Agent Profile**: `quick` | **Parallel**: Wave 1 (with Tasks 1,2,4)

- [x] 4. 添加文件状态到 EditorState

  **What to do**:
  - 修改 `useEditorState.ts` 的 `EditorState` 接口，添加：
    - `availableDataFiles: string[]` — 当前实体类型的可用文件列表
    - `selectedDataFile: string | null` — 当前选中的文件过滤器（null = 显示全部）
    - `recordSourceFiles: Record<string, string>` — recordId → sourceFile 映射
  - 修改 `provideEditorState()` 初始化这些字段
  - 在 DataEditorPage 的 onMounted 中加载 manifest 后，填充 `availableDataFiles`

  **Acceptance Criteria**:
  - [ ] 选择 effects 实体类型后，`availableDataFiles = ['effect_ability.yaml', 'effect_emblem.yaml', ...]`
  - [ ] 选择 species 类型后，`availableDataFiles = ['species.yaml']`

  **QA Scenarios**:

  ```
  Scenario: 切换实体类型时 availableDataFiles 更新
    Tool: Bash (vitest)
    Steps:
      1. 模拟选择 effects → 断言 5 个文件
      2. 模拟选择 marks → 断言 4 个文件
      3. 模拟选择 species → 断言 1 个文件
    Evidence: .sisyphus/evidence/task-4-available-files.txt
  ```

- [x] 5. save/delete 使用 sourceFile 元数据消除线性扫描

  **What to do**:
  - 修改 `useSaveHandlers.ts` 的 `doSave`、`doDelete`、`doBatchDelete`
  - 如果有 sourceFile（从 `EditorState.recordSourceFiles[id]`），直接用该文件
  - 只在 sourceFile 不可用时（新记录），才扫描所有文件
  - 更新 console.log 显示使用的 sourceFile

  **Acceptance Criteria**:
  - [ ] 编辑已存在记录（有 sourceFile）时只读取 1 个文件
  - [ ] 新记录（无 sourceFile）时仍遍历所有文件

  **QA Scenarios**: 验证 readWorkspacePackFile 只调用 1 次
  **Recommended Agent Profile**: `deep` | **Parallel**: Wave 2

- [x] 6. doCreate 支持 targetFile 参数

  **What to do**:
  - `doCreate` 接受可选 `targetFile?: string`，默认 `availableDataFiles[0]`
  - `doSave` 在 targetFile 中追加（当记录不存在时）
  - 创建后更新 sourceFile 映射

  **QA Scenarios**:

  ```
  Scenario: doCreate 到 effect_skill.yaml → writeWorkspacePackFile relativePath 包含该文件名
  ```

  **Recommended Agent Profile**: `deep` | **Parallel**: Wave 2

- [x] 7. 接入 useDataFileManager 到 DataEditorPage

  **What to do**:
  - 在 DataEditorPage 中实例化 `useDataFileManager(packFolder)`
  - 通过 provide/inject 暴露 create/delete/rename 函数

  **Recommended Agent Profile**: `quick` | **Parallel**: Wave 2

- [x] 8. 文件操作安全守卫

  **What to do**:
  - `deleteDataFile`：删除前检查文件是否有记录
  - `renameDataFile`：检查目标名冲突
  - 阻止删除最后一个数据文件

  **Recommended Agent Profile**: `quick` | **Parallel**: Wave 2

- [x] 9. DataTableToolbar 文件管理下拉框

  **What to do**:
  - 替换 disabled placeholder 为实际功能：
    - "新建文件" → 弹窗输入文件名 → `createDataFile(kind, name)`
    - "删除文件" → 确认 → `deleteDataFile(path)`
    - 显示文件列表（从 `availableDataFiles`）
    - "选择目标文件" → 设置 `selectedDataFile`

  **Recommended Agent Profile**: `visual-engineering` | **Parallel**: Wave 3

- [x] 10. PropertyPanel 显示来源文件标签

  **What to do**:
  - 在 panel-header 或记录名称旁边添加来源文件标签
  - 使用 `recordSourceFiles[selectedRecordId]` 查找
  - 标签样式：小号、灰色、可点击（方便定位到文件）

  **Recommended Agent Profile**: `visual-engineering` | **Parallel**: Wave 3

- [x] 11. EditorWorkspace 文件过滤

  **What to do**:
  - 当 `selectedDataFile` 不为 null 时，DataTable 只显示来自该文件的记录
  - 在 DataTableToolbar 或 EditorWorkspace 添加文件过滤下拉框

  **Recommended Agent Profile**: `quick` | **Parallel**: Wave 3

- [x] 12. 测试：sourceFile 追踪 + 文件 CRUD + per-file 往返

  **What to do**:
  - 创建 sourceFile 追踪单元测试
  - 修复 findFileKind 的测试
  - 验证所有 9 个文件（5 effects + 4 marks）的 YAML 往返
  - 运行完整测试套件

  **Recommended Agent Profile**: `quick` | **Parallel**: 独立（最后）

---

## Final Verification Wave

- [x] F1. **计划合规审计** — `oracle` — `oracle`: 检查所有 Must Have / Must NOT Have
- [x] F2. **代码质量审查** — `unspecified-high` — `unspecified-high`: tsc, lint, test, AI slop 检查
- [x] F3. **手动 QA** — `unspecified-high` — `unspecified-high` + Playwright: 执行所有 QA 场景
- [x] F4. **范围保真度** — `deep` — `deep`: 验证任务范围、检查污染

---

## Commit Strategy

- Task 1: `fix: findFileKind missing effects, deduplicate reloadDataFromDisk`
- Task 2: `feat: add sourceFile metadata to gameData store`
- Task 3: `refactor: extract shared file resolver utility`
- Task 4: `feat: add file state fields to EditorState`
- Task 5-8: `feat: use sourceFile for save/delete, targetFile for create, safety guards`
- Task 9-11: `feat: file management UI — dropdown, source badge, file filter`
- Task 12: `test: sourceFile tracking, file CRUD, per-file roundtrip`

---

## Success Criteria

```bash
pnpm --filter @arcadia-eternity/web-ui run test:run  # 全部通过
pnpm --filter @arcadia-eternity/web-ui run lint       # 无错误
```

### 手动验证

- [ ] 编辑一个 effect_ability 记录 → 保存 → 在同一位置修改（不追加）
- [ ] 文件管理 → 新建文件 → 文件出现在列表中 → 可选中
- [ ] PropertyPanel 显示当前记录的来源文件
- [ ] 删除包含记录的文件被阻止
