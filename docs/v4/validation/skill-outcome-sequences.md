# Ordered outcome action-list candidates

All eight current top-level action lists containing a hit/critical outcome action now have native candidates. These are eight additional definitions, separate from the 65 single-action outcome definitions. Every list is emitted as one effect with `actions.sequence`, preserving one collect-time condition, source metadata, automatic consumption and every ordered action. They remain U candidates with no production registration.

The offline generator reuses the existing outcome/power action classifiers, condition emitter and mark selection emitter. Unsupported actions reject the complete list; no action is dropped and no partial effect is admitted. Conditional action values and unassigned turn-order corrections are explicitly rejected. This scope does not accept the other action-list mechanisms, arbitrary parameters or nested conditional actions implicitly.

## Corrections and retained behavior

Every definition records C07 selector spelling corrections at exact source nodes. `effect_mark_next_non_status_skill_sure_crit` additionally records C09 at `/condition/conditions/2/target/chain/0/arg`: `skillId` becomes `skill`. Its condition reads the selected skill's category, not the mutable use-context category. Separate tests deliberately disagree those fields to verify that boundary. The original YAML remains unchanged.

`effect_skill_consume_dongqifuti_sure_crit` requires the owner's mark but removes the opposing target's marks. That mismatch is retained and independently asserted; this migration does not reinterpret the effect name. The other sequences retain their source order:

- Power amplification precedes sure-hit, after any automatic source-layer consumption.
- Accuracy reads current source layers before removing the source mark.
- Sand-egg sure-hit precedes layer consumption.
- Dark-matter and illusion layer consumption precedes the outcome override.
- Dongqifuti's critical override precedes opposing-mark destruction.

Each action queries its selectors and values when it executes. Late source-owner, actual-target and layer changes remain observable; removing condition marks after collection does not revoke admission. Mark destruction callbacks are recorded to assert the intermediate outcome state, not only the final result. Automatic consumption can destroy the source before the sequence, while its context-based actions still execute.

## Evidence

The public suite contains eight source/hash/ordered-node audits, 256 behavior checks across skill and mark sources, and one exact-ID coverage audit. Cases cover empty/late support, ownership/target/layer changes, cancellation, single-layer exhaustion, nested events, repeated use, multi-member selection, category disagreement, destruction callbacks, actual SkillPhase execution and actual single turns. Real phase/turn cases require an independent probe to reach the target trigger.

Review found and repaired two verification boundaries: reusing the power classifier could otherwise accept unreviewed conditional-value ownership/order semantics; real-turn destruction callbacks initially observed an unexecuted fixture context. The generator now rejects those conditional values, and the fixture captures the actual turn context before actions with independent destruction-time assertions.

Reproduce generation with `node scripts/effect-migration/skill-outcome-sequences.mjs --check`. After building the battle package, run `test/v4/skill-outcome-sequences.test.ts` with the V4 Vitest configuration. Complete-game/fresh-catalog checkpoint acceptance and production cutover remain pending.

Final verification passes all 265 public checks, all 82 offline generator checks, all 69 authoring design checks, V4 typechecking and lint, declaration generation and source provenance. Both review axes closed their findings. Strengthened turn assertions initially exposed two trace-count failures from unrelated turn cleanup; restricting traces to removal contexts parented by the candidate effect keeps the independent ordering assertions while excluding that cleanup.
