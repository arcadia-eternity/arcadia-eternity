# Compiled rule rolls and single admission

This slice implements the probability and duplicate-candidate portion of #205 F. Execution records, shared budgets and apply-time captures remain outstanding.

A compiled rule may declare `roll: { nodeId, percent }`. Percent is a finite number from 0 through 100, or a shared scalar parameter reference. Referenced thresholds use the same source-scoped Config path and intersected constraints as action/predicate arguments; delta and override are permitted. Normalized content preserves the reference and stable node identity.

Collection checks the trigger and condition first, reads and validates the effective threshold, then uses `battle.random() * 100 < percent`. An explicit roll consumes exactly one draw even at 0 or 100. No roll or a failed condition consumes no draw. Collection order determines RNG order; priority sorting happens afterward. BeforeEffect cancellation does not refund a draw or repeat the condition.

Compiler-created definitions opt into per-collection admission metadata. The collector evaluates each source-object/effect-ID pair once, including unsuccessful candidates. Distinct sources and subsequent dispatches evaluate independently. Legacy effects retain their historical condition-before-dedup path. The metadata registry holds only definitions, not battle state.

Validation: `content-roll.test.ts` covers boundaries, strict comparison, condition short circuit, duplicate failed rolls, new dispatch, distinct sources sharing a definition, collection/priority order, cancellation, legacy RNG behavior and shared Config thresholds with JSON recompilation. The full V4 suite passes 116 tests in 17 files; typecheck, lint, source provenance and Node/Chrome host/checkpoint checks pass.

Standards review found no blocking defects and requested the distinct-source regression, now added. Independent Spec review remains pending the reviewer's previously reported usage limit; the implementation was checked directly against #205 F, but no independent Spec pass is claimed.
