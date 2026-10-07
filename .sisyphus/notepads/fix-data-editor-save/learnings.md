# Learnings - Fix Data Editor Save

## Codebase Patterns

- `DataEditorPage.vue` uses `<script setup>` — functions not directly exportable
- `yamlAnchoredRecords.ts` handles YAML anchor/alias preservation
- Pack loading uses `PackLoader` from `@arcadia-eternity/pack-loader`
- Desktop API via `window.arcadiaDesktop` (Electron preload)
- Web mode falls back to HTTP fetch for reads, throws for writes

## Key Gotchas

- `isBase` check compares with `'base'` literal — PackManagerTab was storing pack ID `'arcadia-eternity.base'`
- Effects disk save was hard-coded to skip (line 96 of DataEditorPage.vue)
- `enabledPacks` initialized as `[]`, only populated when PackManagerTab mounts (hidden behind collapsible panel)

## Effect YAML Round-trip Test Findings

- `process.cwd()` in vitest resolves to the package dir (`packages/web-ui`), not repo root — use `__dirname` with relative paths instead
- Records that DEFINE anchors (e.g., record 0 with `&apply_opponent_statstage_-1_template`) break alias references when upserted because `patchMapNode` replaces the anchored node with `doc.createNode()` which loses the anchor syntax
- Records that only USE anchors/merge keys (e.g., records 1-5 with `<<: *`) are safe to upsert — merge keys inside nested maps are preserved correctly
- `hasMerge` on `YamlAnchoredRow` only checks for top-level `<<` keys; merge keys inside nested maps (like `apply: { <<: *... }`) are NOT reflected in `hasMerge`
- The 12,002-line effect_skill.yaml takes ~3-4s to parse per call; tests with multiple parses need explicit `{ timeout: 30000 }`
- Anchor definitions (`&name`) and their references (`*name`, `<<: *name`) survive stringify → re-parse round-trips even without upserting

## useSaveHandlers Extraction

- `useSaveHandlers()` composable accepts `{ draftRef, editorState, gameDataStore }` options object
- Returns `{ doSave, doCreate, doDelete, doBatchDelete, registerDraft }` — all five needed for provide/inject
- `reloadDataFromDisk()` extracted as private helper inside the composable (used by doSave/doDelete/doBatchDelete)
- DataEditorPage.vue imports `useSaveHandlers` and destructures all functions, then provide()s them to children
- Removed unused imports from DataEditorPage.vue: ElMessage, ElMessageBox, readWorkspacePackFile, writeWorkspacePackFile, readWorkspacePackManifest, resolveManifestDataPath, yamlAnchoredRecords functions

## Test Patterns for useSaveHandlers

- Test data must be schema-compliant: effects need `{ id, trigger: [], priority: 0, apply: { type: 'TODO' }, tags: [] }`, species need full `createDraft()` shape
- `vi.mock('@/services/packWorkspace', ...)` with `await import('@/services/packWorkspace')` in `beforeEach` to get mocked function references (same pattern as pack-manager.test.ts)
- `readBasePackFile` mock needs `mockImplementation` to return different values for `pack.json` vs data files
- `ElMessageBox.confirm` must be mocked to resolve (not reject) for delete tests — otherwise the catch block returns early
- LSP can't resolve `@/` path aliases in test files, but vitest resolves them at runtime — this is a known project-wide issue (same error in pack-manager.test.ts)

## F3 Manual QA Findings (2026-05-21)

### Verification Results

- ✅ Refactoring: DataEditorPage.vue imports from useSaveHandlers, all 5 functions destructured and provided
- ✅ Early Return Logging: All 3 console.warn calls present (no entity, empty draft, no entity config)
- ✅ Success Logging: All 3 console.log calls present (Saved, Deleted, Batch deleted)
- ✅ isBase in delete: Both doDelete (L184) and doBatchDelete (L257) have `isBase = packFolder === 'base' && window.arcadiaDesktop?.readBasePackFile`
- ✅ Effects Save: No `kind === 'effects'` skip condition found — effects save is ENABLED
- ✅ PackManagerTab: Both L39 and L60 use `p.folderName`
- ✅ Tests: 13 files, 128 tests — ALL PASSED (29.28s)

## Multi-File Save Implementation (2026-05-21)

### Problem

- `doSave()` used `cfg.dataFile` (hardcoded to `'effect_skill.yaml'` in base.ts) to read/write exactly one file
- Effects are spread across 5 YAML files: `effect_ability.yaml`, `effect_emblem.yaml`, `effect_global.yaml`, `effect_mark.yaml`, `effect_skill.yaml`
- Records in non-`effect_skill` files were never found on save, causing duplicate entries

### Solution

- Read `manifest.data[kind]` (array of file refs) from pack.json instead of `cfg.dataFile`
- Iterate through all files, search each for the record by ID
- Found → upsert in-place in that file
- Not found → fall back to first file in the list (append new record there)
- `cfg.dataFile` retained as fallback when manifest has no entries for the kind
- Non-effect types (species, skills) unaffected — their manifest entries have single files

### Key Details

- `YamlAnchoredDataset` type exported from `yamlAnchoredRecords.ts` — needed for `targetDataset` variable
- `resolveManifestDataPath(manifest, fileRef)` prepends `paths.dataDir` from manifest to each file name
- For effects: new records append to `effect_ability.yaml` (first in the manifest array, not `effect_skill.yaml`)
- `doDelete` and `doBatchDelete` left unchanged — they use `cfg.dataFile` single-file approach (task scope limitation)

## F2 — Code Quality Review (2026-05-22)

### Results

- Build: PASS (tsgo --noEmit, zero errors)
- Lint: PASS (eslint --fix, zero violations)
- Tests: 13 files, 130/130 passed (0 failures)
- LSP Diagnostics: zero errors on all changed files

### Anti-patterns

- `as any`: 0 in changed files (4 pre-existing in unrelated files)
- `@ts-ignore`/`@ts-expect-error`: 0
- Empty catch: 5 found, all intentional (user cancel dialogs, file-not-exists guards) with inline comments
- Unused imports: 0
- Console in production: all intentional per plan diagnostics requirements
- Commented-out code: 0
- AI slop: 0

### Verdict: APPROVE
