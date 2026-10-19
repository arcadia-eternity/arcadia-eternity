# Skill power correction candidates

The current production source contains 104 single-action `amplifyPower`/`addPower` definitions. This batch statically emits 82 candidates (65 literal and 17 dynamic-valued) and records 22 rejected definitions with precise source hashes and reasons. The generated module contains ordinary TypeScript; neither legacy parser nor migration expressions run in the candidate implementation.

## C07: skill selector spelling

Every one of these 104 definitions is rejected by the current legacy parser because it uses `useSkillContext`; the implemented selector is named `usingSkillContext`. The selected correction is to resolve the nearest UseSkillContext through the typed `contexts.skillUse` query. This restores the intended selector operation without changing trigger stage, target ancestry, condition order, coefficients or automatic consumption. No production YAML or legacy parser is changed.

Each candidate records its definition hash, exact changed source paths and C07 decision. Tests first require the unchanged production definition to fail parsing. A separate test-only copy changes only base/target selector spellings, and its resulting legacy execution is the corrected-rule reference. This reference is explicitly not evidence of equivalence with the unchanged failing definition. These 82 records are classified C: the scoped C07 correction is selected and verified. Production admission remains pending and is tracked separately from the behavior decision. The 22 rejected definitions remain unsupported.

Other nonexistent paths (`skillId`, `Pet.spa`), unsupported predicates, unmapped dynamic/configured amounts and other structures remain rejected. Spelling repair alone permits 101/104 parser constructions, but that does not establish runtime correctness of those 101. No original no-op or silently skipped effect is emitted as a completed migration.

## Shared authoring behavior

`contexts.skillUse` reuses ancestor traversal and resolves independently on every action. `conditions.ownerUsesSkill` checks direct UseSkillContext ownership, preserving skill-stage `checkSelf`. It differs from `selfUsesSkill`, which also checks skill identity for SkillInstance sources and searches ancestry.

`Selector.all()` returns a fresh ordered membership snapshot. `ops.addPower` and `ops.amplifyPower` accept either one immediate number or an immediate numeric list. They read separately for each selected context and apply every value in sequence, without flooring. This preserves the legacy power operators' per-target, all-values behavior, rather than reusing damage modifiers' first-value contract. Missing values and empty lists perform no writes. Foreign contexts and nonfinite inputs are rejected before the relevant write.

The offline numeric/condition emission helpers are shared with the damage generator. Regenerating damage candidates is byte-identical; its eight regression tests continue to pass. Skill-stage ownership mapping is explicit and does not change damage-stage `checkSelf`.

## Ordered and mark-based admission

Eleven further candidates add first/last admission, periodic consecutive use, opponent mark tag/ID membership, reading current skill power and an omitted (always-true) condition. Mark extractor shorthand and any-of IDs are scoped to the skill emitter. Tests cover wrong order/count and changes after admission, without rechecking collected conditions. Periodic zero-count behavior is preserved.

Real games exposed an additional kernel defect: turn context views were never populated. The four first/last power candidates therefore additionally depend on [C08 turn-order repair](turn-order.md). C08 is separate from C07 and has a complete 27-definition potential-impact inventory. Legacy/native comparisons for those four use the explicitly corrected kernel; they are not original-behavior equivalence claims.

## Dynamic collections

Fifteen candidates additionally cover source-stack, owner/opponent mark stacks, maximum HP and consecutive-use counts. The generated code reads the complete ordered list at action time. `targets.opponentMarks` preserves the old distinction: in a direct skill context it queries `actualTarget.marks`; otherwise it queries the opposing active pet. It resolves on each use, including after target changes.

Numeric collection steps preserve the legacy **indexed operand pairing**: a literal produces a one-element right-hand list, and missing later operands are zero. Thus `[3, 2] × 15` becomes `[45, 0]`, not `[45, 30]`. Each subsequent operation repeats that pairing and its own floor. Initial broadcasting caused 22 multi-mark differential failures; all 30 focused multi-mark cases pass after preserving the indexed behavior, and both review axes closed the finding. Multiple-member division remains rejected because later zero divisors require a separate nonfinite-value decision. C07 still changes selector spelling only.

Dynamic cases also cover missing collections, another actual target, self-targeting, stack/count/max-HP changes between admission and execution, multiple matching marks, and independent `spd` / `spe` mark identities. The source runtime test separately verifies direct actual-target reselection and nested-context fallback.

## Remaining 22 definitions

The remaining boundary is explicit: 18 need condition mapping and four need value mapping. Next condition cases include player rage, species fields and parameterized probability. The three invalid paths described above still require separate correction decisions.

Read-only characterization for the next batch:

- First skill tests the first UseSkillContext in `TurnContext.appledContexts`; last skill tests the first planned UseSkillContext in `TurnContext.contexts`, reflecting the queue's pop order. Both require direct UseSkillContext → TurnContext ancestry.
- Periodic consecutive use checks direct ownership and `(skill.owner?.lastSkillUsedTimes ?? 0) % times === 0`; it is not a generic count threshold.
- Dynamic `weight` and `height` read optional Pet fields, while stat attributes provide species-range fallbacks. Replacing these fields with `stat.weight`/`stat.height` would be an additional semantic change.
- The three domain-field conditional values contain literal false branches of zero; the old parser treats them as absent. Their value-list behavior must be preserved or assigned a separate correction, not silently converted to a required zero.

## Evidence and remaining work

2,075 public-runtime checks cover: each of the 82 original parser failures and hashes, 1,910 corrected-reference cases (skill/mark sources, seven real global-mark sources, and ten baseline variants plus five dynamic variants), exact ID coverage and 82 complete-game/JSON continuation cases. Cases include positive activation with expected power, missing marks, wrong owner, another skill on the same owner, execution-time ownership/value changes, cancellation, alternate element/category, repeated dispatch, real SkillPhase execution, consumption, HP, rage, message order and subsequent RNG. Tests assert actual positive application for every candidate in the normal scenario.

Two additional source tests cover ordered list consumption with per-target re-reads and fractional arithmetic, plus nested context lookup versus direct ownership admission. The complete authoring/binding suite passes 52 tests. Type checks pass. Nine generator tests cover C07 path recording, nonmutation, ownership mapping, strict rejection and deterministic output. Review identified and closed two recognition defects: conditional comparison values now preserve the skill domain through nested branches and import `values` when needed; the nonexistent category base extractor is rejected while category `selectPath` remains supported.

Both independent implementation reviews pass after the recognition fixes. All 82 full-game cases pass after the core repair, comparing the corrected legacy reference with native uninterrupted and fresh-catalog JSON-restored games. A selection-boundary checkpoint is followed by a real switch and completion to a winner; every run asserts actual candidate application both in the complete game and after the checkpoint boundary. Seven global definitions use Battle-owned sources. The common game harness compares messages, per-turn HP/rage, final state and subsequent RNG. Both independent harness follow-up reviews pass. The strengthened post-boundary application assertion passes all 82 cases. All 9,108 V4 tests across 43 files pass. V4 and source authoring typechecks, declaration build, scoped lint, provenance and Node/real-Chrome checkpoint checks pass. This is not production catalog admission or loader cutover.

Reproduce:

```sh
node scripts/effect-migration/skill-power.mjs --check
node --test scripts/effect-migration/skill-power.test.mjs scripts/effect-migration/damage-modifiers.test.mjs
pnpm --filter @arcadia-eternity/battle build:code
pnpm --filter @arcadia-eternity/battle exec vitest run --config vitest.v4.config.mjs test/v4/skill-power.test.ts
pnpm test:effect-authoring-design
```
