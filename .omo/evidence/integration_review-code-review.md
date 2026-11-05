# Final production-diff review

Reviewed the current worktree against `f8099609` on 2026-11-05. Read-only review; no tests or installer runs were started.

## Skill-perspective check

The `remove-ai-slops` and `programming` skills were not available in the supplied skills catalog or at their expected local roots, so their stated criteria were applied directly. The focused pool, packaged-root, and pnpm-hook changes do not introduce tautological/deletion-only tests, untyped escape hatches, or needless production normalization. The installer checks exercise real packages and do not merely mirror implementation constants.

## Findings

### CRITICAL

None.

### HIGH

1. `publish-desktop` checks out the workflow trigger revision rather than the already validated release commit. `.github/workflows/release.yaml:203-205` has `actions/checkout@v4` with no `ref`, while `build-desktop` correctly uses `ref: ${{ needs.prepare.outputs.commit }}` at lines 106-109. The publish job then installs the trigger revision's lockfile/pnpm hook (line 214) and runs that revision's merge helper (line 245) over binaries built from the tag commit. A tag followed by a default-branch change can therefore make the release non-reproducible, fail its install, or validate/upload with changed policy. Set the publish checkout `ref` to `needs.prepare.outputs.commit` too.

### MEDIUM

None.

### LOW

`scripts/verify-desktop-installation.mjs:230-231` contains a duplicate `return result`; it is unreachable but harmless. It can be removed opportunistically.

## Positive checks / limits

- `packages/database/src/storage.ts:235-251` adds client and pool error listeners only for self-owned pools; the PostgreSQL fault test at `packages/server/test/standaloneManagementPostgresFaults.test.ts:251-298` covers a real terminated idle backend and asserts external-pool listener ownership is unchanged.
- `packages/web-ui/electron/main.mjs:247-262` points packaged loading at `resources/arcadia-server/packs/base`, matching staging in `scripts/stage-desktop-runtime.mjs:270-283`; the installed-artifact acceptance calls the actual packaged IPC loader.
- `.pnpmfile.cjs:3-19` is deliberately version-pinned and fail-closed. Its dedicated test verifies removal only of Better Auth's reviewed optional Vitest peer and audits the physical production graph.
- The installer and HTTPS harnesses have real cleanup accounting and fail their evidence on leaked labelled Docker resources. Final native installer/HTTPS execution remained in progress during this review, so that run evidence is not treated as independently verified here.

## Result

`codeQualityStatus: BLOCK`  
`recommendation: REQUEST_CHANGES`  
`blockers: Fix the publish checkout revision mismatch in .github/workflows/release.yaml:203-205 before approval.`

## Primary implementer follow-up

The original read-only review above is preserved. The reported publisher checkout mismatch is now fixed: `publish-desktop` pins `ref: ${{ needs.prepare.outputs.commit }}`, matching the build job. The duplicate return was removed. The primary implementer inspected both final paths; this resolves the recorded required source change but is not a new independent review of subsequent GUI fixes. Release-manifest, installer/process and content-library regressions passed 74 tests with one platform-specific skip. Final native CI and deployment results are recorded separately in the follow-up validation report. No release was published.
