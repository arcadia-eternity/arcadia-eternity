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
