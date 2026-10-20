# Historical restoration checkpoint — 2026-10-20

This checkpoint restores the historical skill-context selector name and ignore-shield operator, adds native shield-bypass and rage-assignment candidates, and reconciles the rage event lifecycle with revision `61c349fa7ca35c392b0e751c9238759b02aefcb3`. It withdraws the three C15 source rewrites. Candidate coverage is 1,017 of 1,065 definitions; this is ownership coverage, not final acceptance.

## Verification

- 425 checks pass against independently bundled v4/v4-legacy entrypoints: 284 selector-name checks, six legacy shield checks, seven native shield checks, 45 rage-assignment checks, 75 rage-modifier checks and eight historical rage-lifecycle checks.
- Six affected-family source suites contain 572 cases. 569 passed initially; three full-game checkpoint cases timed out at the default five seconds. Rerunning exactly those three with a 30-second limit passed in 1.80 seconds of test time. No assertions or fixtures were weakened for that rerun.
- A focused selector compatibility run collected 17 files and passed 188 source/parse/mapping cases, with 9,408 other cases skipped. This does not certify all behavior variants in those files.
- Both V4 and authoring typechecks, lint, and 87 authoring/value-binding tests pass.
- All 188 generator tests passed after adding the new candidate groups. Following the C15 generator change, the six rage-modifier/assignment generator checks were rerun and passed.
- Provenance and reproducible historical-audit checks pass. The restored rage operation is pinned by its whitespace-normalized historical digest.

The isolated build uses the repository's unchanged `rolldown.config.js` with only its output directory overridden. Tests alias the two public entrypoints to that output and retain normal external dependencies. This verifies bundled execution without replacing the artifact used by the older full-suite process. It does not constitute production environment-bundle or browser validation.

Evidence logs: `/tmp/historical-built-core.log`, `/tmp/historical-rage-regression.log`, `/tmp/historical-rage-timeout-rerun.log`, `/tmp/historical-selector-assertions.log`, `/tmp/historical-rage-types.log`, `/tmp/historical-rage-lint.log`, `/tmp/historical-rage-design.log`, and `/tmp/historical-rage-generators.log`.

## Still open

The older full-suite process is still running against the earlier bundle. Some affected test sources have since been updated, so that run cannot certify this checkpoint; results must be interpreted against its old runtime and rerun where affected. No complete-suite success is claimed.

C08 turn ordering and C13 hit ordinals still require reconciliation. Later V1's skill and switch phase wrappers append their contexts before executing, while its turn phase populates planned contexts through pushContext. Its first/last predicates search ancestors recursively. The current scheduler's existing bookkeeping does not by itself establish equivalence for direct phases or nested damage/effect contexts.

`executeActions` and the complete temporary-effect lifecycle remain unported. Catalog-wide C07/C10 classification cleanup, remaining native definitions, fresh-catalog full-game acceptance and production cutover remain open.
