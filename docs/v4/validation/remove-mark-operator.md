# Shared mark removal operator

`ops.removeMark()` removes selected marks through the existing `RemoveMarkContext` / battle removal phase. This is the shared runtime prerequisite for action lists that consume or remove marks before/after changing skill outcomes; it does not itself add migrated official IDs.

The operator visits the selected list in order. Inactive marks are no-ops, including duplicates made inactive by an earlier visit or removal callback. The existing phase retains destroyability checks, OnMarkDestroy/OnRemoveMark dispatch, modifier cleanup, owner detachment and destruction messages. Active targets are all checked for battle ownership before the first removal, then each active target is checked again after preceding callbacks. A callback moving a later mark into a different battle therefore stops the subsequent write; earlier completed removals are not rolled back.

Each action in `actions.sequence` still executes its own query. A test destroys a three-layer mark whose callback creates a seven-layer mark; subsequent reads observe 7, then 5 after consumption, then an empty list after removal. This covers both pet and global mark collections, with no shared implicit capture. Indestructible targets remain and do not prevent later targets from being processed.

The 20 public-package checks cover independent legacy operator comparisons for pet/global owners, normal/reversed order, duplicate/empty selections, indestructible/inactive marks, callbacks removing a subsequent target or creating a new mark, the two sequence scenarios, and both ownership guards. The initial direct-call fixtures omitted an execution-budget scope and failed before reaching the operator; the corrected fixtures enter the normal budget scope without bypassing its checks. All 20 then pass. Existing authored binding/capture/follow tests remain a separate verification suite.

Reproduce after building the battle package:

```sh
pnpm --filter @arcadia-eternity/battle exec vitest run --config vitest.v4.config.mjs test/v4/remove-mark-operator.test.ts --maxWorkers=1
```

Integration checks pass: V4 typechecking and lint, declaration generation, source provenance, and all 69 authoring design/binding tests. Both review axes pass.
