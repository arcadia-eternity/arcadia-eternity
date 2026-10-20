# Skill power correction candidates

The current production source contains 104 single-action `amplifyPower`/`addPower` definitions. This batch statically emits 104 candidates (83 literal, 18 dynamic-valued and three conditional-valued) and records no rejected definitions in this single-action scope with precise source hashes and reasons. The generated module contains ordinary TypeScript; neither legacy parser nor migration expressions run in the candidate implementation.

## C07: skill selector spelling

Every one of these 104 definitions is rejected by the current legacy parser because it uses `useSkillContext`; the implemented selector is named `usingSkillContext`. The selected correction is to resolve the nearest UseSkillContext through the typed `contexts.skillUse` query. This restores the intended selector operation without changing trigger stage, target ancestry, condition order, coefficients or automatic consumption. No production YAML or legacy parser is changed.

Each candidate records its definition hash, exact changed source paths and C07 decision. Tests first require the unchanged production definition to fail parsing. A separate test-only copy changes only base/target selector spellings, and its resulting legacy execution is the corrected-rule reference. This reference is explicitly not evidence of equivalence with the unchanged failing definition. These 104 records are classified C: the scoped C07 correction is selected and verified. Production admission remains pending and is tracked separately from the behavior decision. Three additionally require C09 path corrections, documented separately below.

Spelling repair alone permits 101/104 parser constructions. The remaining three require the separately recorded C09 corrections; neither correction is evidence of original-behavior equivalence. No original no-op or silently skipped effect is emitted as a completed migration.

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

## Field and player conditions

Fourteen additional candidates cover raw Pet weight/height/level, gender, opposing element, player rage/maxRage and currentTurn. `targets.selfPlayer` reads the direct skill actor's owner; in other contexts it reads the effect owner's player. It re-resolves ownership on each query. `contexts.battle` provides the current battle without repeated context traversal in effects.

Optional weight/height retain missing-value behavior and never fall back to stat attributes. Tests deliberately make raw dimensions disagree with those attributes. Field cases cover wrong values, absent dimensions and changes after admission; a collected condition is not rechecked during execution. The first-round full-game checkpoint is before the first turn executes, so restored execution must actually activate the effect.

The generator rejects nonexistent base extractors for weight, height, level, maxRage, currentTurn and lastSkillUsedTimes; these fields require their valid dynamic forms. Optional dimension equality and arithmetic remain rejected rather than collapsing legacy undefined entries into empty-list semantics.

## Conditional value lists

Three domain-field candidates use nested `values.choose` lists. The current YAML contributes 150 for the higher domain and 50 for the lower domain, despite the IDs mentioning 100/200. Each action reads only its selected branch afresh. A literal false branch of zero becomes an empty list, preserving the parser's missing-branch behavior; a true branch of zero remains `[0]` and performs a zero write. No new runtime expression mechanism or correction decision is added.

Per-ID tests cover both domains, lower domain only, no domain, and changes from higher to lower/absent between admission and execution. A source-runtime trace proves branch laziness, repeated action reads and the difference between no write and a zero write. The three full-game cases assert activation after fresh-catalog restoration. All 120 focused checks pass. One initial full-game case exceeded the default five-second limit while other validation ran concurrently; an independent rerun passed all cases without increasing the timeout.

## Parameterized admission and values

Two candidates reuse ParameterCatalog declarations: the probability parameter retains `skill_effect_probability`, and the duration multiplier retains its numeric default of 20. Generated parameter names derive from source paths and preserve explicit aliases when supplied; these two source declarations are anonymous. `conditions.chance` now accepts a required numeric Value, reads it at each condition call, validates it, then takes exactly one draw even for 0 or 100. Already collected effects do not recheck probability after a parameter change.

The duration candidate reads mark durations and its multiplier at action time. Configured list arithmetic pairs the first input with the configured scalar, subsequent inputs with zero, and preserves per-member flooring. Configurable divisors and nested parameter branches remain rejected. Existing damage generation is unchanged.

Eighty-two focused checks cover default/zero/custom parameters, foreign-source isolation, removed overrides, late parameter/duration changes, multiple matching marks, and complete games restored through fresh catalogs with nondefault values (probability 100, multiplier 7.5). A source runtime test separately checks repeated probability reads, draw count, and nonfinite-value rejection. Both independent reviews pass. The full 9,780-test V4 regression passes.

## C09 and remaining production gates

The final three single-action power candidates repair four invalid nodes: two skill-instance paths and two battle-attribute paths. Exact scope, original failures and behavior evidence are recorded in [C09 skill-path corrections](skill-path-correction.md). These corrections preserve the original condition order, coefficients and stack consumption and do not modify the production source or parser.

All 104 definitions in this mechanism now have candidates. Production catalog admission, dependency closure and loader cutover remain separate gates; other effect mechanisms are still incomplete.

## Evidence and remaining work

2,747 public-runtime checks cover: each of the 104 original parser failures and hashes, 2,538 corrected-reference cases (skill/mark sources, seven real global-mark sources, ten baseline variants, five dynamic variants, three field variants and four conditional-branch variants and seven parameter variants and two C09 path variants), exact ID coverage and 104 complete-game/JSON continuation cases. Cases include positive activation with expected power, missing marks, wrong owner, another skill on the same owner, execution-time ownership/value changes, cancellation, alternate element/category, repeated dispatch, real SkillPhase execution, consumption, HP, rage, message order and subsequent RNG. Tests assert actual positive application for every candidate in the normal scenario.

Two additional source tests cover ordered list consumption with per-target re-reads and fractional arithmetic, plus nested context lookup versus direct ownership admission. The complete authoring/binding suite passes 55 tests. Type checks pass. Sixteen generator tests cover C07 path recording, nonmutation, ownership mapping, strict rejection and deterministic output. Review identified and closed two recognition defects: conditional comparison values now preserve the skill domain through nested branches and import `values` when needed; the nonexistent category base extractor is rejected while category `selectPath` remains supported.

Both independent implementation reviews pass after the recognition fixes. All 104 full-game cases pass after the core repair, comparing the corrected legacy reference with native uninterrupted and fresh-catalog JSON-restored games. A selection-boundary checkpoint is followed by a real switch and completion to a winner; every run asserts actual candidate application both in the complete game and after the checkpoint boundary. Seven global definitions use Battle-owned sources. The common game harness compares messages, per-turn HP/rage, final state and subsequent RNG. Both independent harness follow-up reviews pass. The strengthened post-boundary application assertion passes all 104 cases. All 9,780 V4 tests across 43 files pass. V4 and source authoring typechecks, declaration build, scoped lint, provenance and Node/real-Chrome checkpoint checks pass. This is not production catalog admission or loader cutover.

Reproduce:

```sh
node scripts/effect-migration/skill-power.mjs --check
node --test scripts/effect-migration/skill-power.test.mjs scripts/effect-migration/damage-modifiers.test.mjs
pnpm --filter @arcadia-eternity/battle build:code
pnpm --filter @arcadia-eternity/battle exec vitest run --config vitest.v4.config.mjs test/v4/skill-power.test.ts
pnpm test:effect-authoring-design
```

Field-batch review closed two additional findings: invalid base extractor forms are rejected, and field variants are included in the executable matrix. Both independent review axes pass; 19 combined skill/damage generator tests and all 85 focused field/first-round checks pass.

Conditional-batch Standards review closed an accidentally copied fixture block in the full-game helper. Both independent review axes pass. Source tests (54), typechecks, and generator tests (20 combined) pass.

## Anonymous parameter identity and fixture cleanup recheck

A current full V4 regression exposed 44 failures in the two parameterized power families. Re-parsing source definitions registered new anonymous keys, and the reference harness incorrectly searched all keys sharing the effect ID. It now records the keys created with each original parsed oracle and verifies that each selected key is registered in the battle. Parameterized cases explicitly re-parse the same definition to guard against regression. The original expected power, configuration, game and checkpoint assertions remain unchanged.

A separate cleanup assertion reproduced four leaked attribute-system instances after the duplicate-mark case. The fixture now attaches duplicate marks through `setOwner(owner, emitter)`, and every case asserts that battle cleanup restores the original instance count. Intentional late-owner changes are preserved.

Evidence: `/tmp/power-failures.log` reproduced all 44 parameter failures; `/tmp/power-repair.log` passes all 82 cases in the two affected families. `/tmp/power-lifecycle-before.log` demonstrates the four-instance leak. The final complete suite run `/tmp/power-final.log` passes 2743 cases with no assertion failures and reports four 5-second timeouts during concurrent full-regression execution. All four exact cases pass individually in `/tmp/power-timeout-recheck.log` (1.27 seconds total test time). This supplies passing evidence for all 2747 distinct cases, but does not claim a single uninterrupted green full-suite run. No timeout was increased. Typecheck and lint pass.
