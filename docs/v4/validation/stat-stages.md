# Native stat-stage candidates

This document records historical conversion evidence. The offline generators have been removed; maintained behavior lives in `packs/base/src/effects/`. Retained candidate records and YAML fixtures support behavior regression tests.

The offline generator recognizes all 102 current single-action statStageBuff definitions and records no rejected definitions. It emits ordinary TypeScript calls to Pet.addStatStage, preserving the existing mark creation, level merging, limits and attribute modifiers. No parser, selector builder or runtime DSL is imported by generated code. Production registration is unchanged and every record remains U.

Admission supports selfUseSkill and ordered nested every conditions containing self probability evaluators. Generated boolean expressions preserve short-circuit order, including repeated self tests. The probability value is read before drawing one battle RNG sample, even for 0 or 100 percent. Raw numeric probability values become 42 public parameters with stable effect/node/field addresses, original tags and explicit Config aliases where present. Effective values remain finite numbers without introducing a 0–100 clamp. Tagged modifiers continue to use the source scope; unnamed legacy random keys are not copied into stable addresses.

Probability is read during collection; changing it in BeforeEffect does not reconsider an admitted effect. At application time, current source ownership and opponent active position determine the target. Numeric stage values remain literals. Definitions outside the recognized conditions and stages, nonliteral stat/value, extra fields or ambiguous shared aliases are rejected rather than partially converted.

The per-ID source hashes and node paths are in stat-stages-candidates.json. The initial 58-candidate suite compares unchanged YAML with skill and mark sources, each declared trigger, late ownership/position changes, wrong skills, effect/add-mark cancellation, existing level merging, probability 0/100, late probability changes and unrelated parameter scopes. They compare stage marks, effective attributes, action inputs and the next RNG sample. Guaranteed-success cases assert a concrete stage mark and changed attribute, preventing matching no-ops from passing.

These tests establish the action and admission boundary only. Full-game sequences, fresh-catalog checkpoint continuation, production registration, and E/C acceptance remain pending. The new conditional batch also exercises real SkillPhase execution.

Reproduce:

```sh
pnpm test:battle-v4 test/v4/stat-stages.test.ts test/v4/conditional-stat-stages.test.ts --maxWorkers=2
```

Historical validation of the initial 58 candidates: all 1,277 targeted runtime cases and three generator tests passed; the complete V4 suite passed 4,962 tests across 35 files with normal two-worker settings. Code/declaration builds, V4 typecheck and lint passed. Standards review found no blockers; independent Spec review was pending for that historical snapshot.

## Conditional extension

The additional 33 definitions use the existing authored condition API and `ops.changeStatStage`. Supported conditions include owner/opponent marks, HP ratios, rage thresholds, gender, periodic consecutive use and the actual target of a missed skill. `spd` remains special defense and `spe` remains speed. The initial 58 definitions retain their existing generation path and all 42 stable parameter addresses; new parameter shapes and turn-order corrections are not silently admitted through this extension.

All 727 conditional cases compare with unchanged YAML. Each ID runs with skill and mark sources: positive/negative admission, wrong ownership and another selected skill, condition changes after collection, late owner/active-position changes, effect/add-mark cancellation, existing-level merging and actual SkillPhase execution. Late target cases independently assert the destination index; the defensive dodge case moves to a genuinely different owner. The 132 late-owner/late-opponent cases were rerun after that review fix and pass. Both review axes pass the extension.

The original 1,277-case suite remains dedicated to its probability/parameter recipes; the full catalog ID/hash audit includes all 91 records. Five generator tests cover both recipe paths and reproducibility. Formal public-artifact verification passes: both stat-stage suites and both damage suites total 3,759 passing cases. All 60 generator checks, typechecks, lint, declarations and source provenance pass; the migration progress ledger separately records the non-green preceding complete regression and its isolated timeout reruns.

## Trigger and corrected-context extension

Eight further candidates cover BeforeMultiHit, OnCritPreDamage, OnDefeat, two skill-specific 20% special-defense bonuses, and the last-skill special-attack reduction. The two emblem definitions require C07 plus the exact C09 skill entity path repair; the three-hit condition requires C07. The last-skill candidate records C08. All prior 91 records and 42 parameter addresses remain unchanged.

The 188 new public-artifact cases compare independent references with skill and mark sources, positive/negative admission, wrong ownership/skill, nested and missing skill contexts, late condition/owner/active-position changes, cancellation and real SkillPhase dispatch. Assertions inspect stage marks, destination indices and subsequent RNG; the defeat case observes a dead victim and BeforeMultiHit observes three remaining hits with ordinal zero. C07-only parsing of the two emblem definitions must still fail on skillId before the separately specified C09 repair.

All three stat-stage suites pass 2,192 cases. All 63 generator checks, V4 typechecking, lint, declarations and source provenance pass. Generation is reproducible at 99 candidates, 42 parameters and three rejects. Both review axes identified the C08 recognition boundary: it now recursively rejects additional or nested first/last nodes, accepting only the single reviewed last node at /condition/conditions/2. These checks do not establish per-ID complete-game or checkpoint acceptance for the eight additions. The last-skill fixture seeds the turn schedule; existing C08 kernel evidence is documented separately.

## Damage-stage parameter extension

`effect_skill_reduce_stat_5_percent` retains OnDamage timing, nearest-skill self-use admission, one scoped 5% RNG draw and a one-stage reduction of the opposing active pet's defense. It uses the shared authored condition API and one tagged `numberParam`, installed with `effectAuthoring.effectParameters(effect).install(battle.configSystem)`. The original aggregate `generatedStatStageCandidates.parameters` still contains its 42 unchanged declarations; this new declaration belongs to the compiled effect's catalog. No runtime selector/parser is introduced.

The 29 public-artifact checks compare unchanged YAML, including skill/mark sources, nested or missing skill contexts, real SkillPhase damage, subsequent RNG, 0/100 overrides, an unrelated source's 100% override, late probability/owner/active-position changes and cancellation. Positive cases assert stage marks and effective attributes; late destinations have independent assertions. The generator selects the damage condition domain for this named OnDamage mapping and refuses mixed damage/skill triggers. Generator regressions pin checkSelf's damage-target meaning as well as parameter metadata. Production registration and per-ID full-game/checkpoint acceptance remain pending.

Final checks for the damage-stage extension: all 65 offline generator tests, V4 typechecking, lint, declaration generation and source provenance pass. Both review axes pass after the domain and scope-isolation fixes. All prior 99 ledger records are unchanged.

## Dynamic mark-application extension

`effect_ability_enhance_atk_when_spa_enhanced` requires C09: `/apply/value/selector/chain/0/arg` changes from nonexistent `statLevelMarkLevel` to `stack`. `AddMarkContext.stack` is the pending signed stage amount passed by `Pet.addStatStage`; the source and production parser remain unchanged. The generator accepts only the reviewed complete definition shape after this exact-node repair.

The authored code reuses `contexts.addMark`, `conditions.ownerAddsMark` and `conditions.statStageChange('spa', 'up')`. The selector searches for the nearest ancestor afresh. The conditions preserve direct-event semantics: ownership belongs to the initiating source, not the destination; direction comes from `BaseStatLevelMark.initialLevel`, not the mutable stack. Once admitted, the action reads the current stack and current source owner. Cancellation and late changes retain the existing dispatch behavior.

All 32 dedicated checks pass against an independently repaired legacy reference. Original parsing must fail on the absent property. Cases cover skill/mark sources, another recipient or applicant, negative/zero/different-stat bases, a positive base with negative stack, ordinary marks, late stack/owner/base changes, cancellation, nested/missing contexts and actual add-mark execution. Repeated selector reads observe an intervening stack change; nested lookup does not broaden direct admission. Five public suites passed 142 checks before four additional sign cases were added, and the final 32-case suite was rerun. All 66 generator checks and 69 authoring design tests pass, along with V4 typechecking, lint, declarations and provenance. The previous 100 ledger records remain unchanged. Full-game/checkpoint acceptance of this new candidate remains pending.

## Dynamic additive stage copy

`effect_skill_set_self_spa_to_atk` is a name/behavior mismatch in the existing content. Its `strategy: set` field is absent from the legacy operator schema and ignored by the parser/operator. Before conversion, a direct unchanged-YAML test proved attack +2 with special attack +3 becomes special attack +5. The candidate deliberately preserves this additive behavior; changing the game rule to assignment is a separate decision. `legacyIgnoredFields` records the exact source field and observed behavior, and the generator only accepts the reviewed complete shape.

Admission checks self-use and the attack-up mark once. The action then queries the current source owner's marks again, selects the first attack-up stack, defaults an absent result to zero, and adds that value to special attack. The explicit zero preserves the legacy add-mark dispatch when a mark disappears after admission; skipping the operation would lose that event. It reads stack rather than inferring a stage from a similarly named attribute.

All 28 dedicated public-artifact cases pass against unchanged YAML, including attack zero/negative, source kind, wrong selected skill, nested/missing contexts, late mark removal/change, late owner, cancellation, real SkillPhase and repeated application at the stage cap. Tests independently assert destination levels and write amounts, including the zero write. Existing 101 ledger records are unchanged. This completes candidate generation for the 102 single-action definitions only; action-list occurrences, full-game/checkpoint acceptance and production admission remain outside this claim.

Final integration: all six public-artifact stat-stage suites pass 2,281 tests in 89.77 seconds. All 67 offline generator checks, V4 typechecking, lint, declaration build, reproducible generation and source provenance pass. Both review axes approve the final additive mapping. These are scoped checks; the earlier non-green complete V4 regression remains documented separately.
