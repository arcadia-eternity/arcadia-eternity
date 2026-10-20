# Conditional action trees

All 24 current top-level conditional effects have native candidates. They compose existing conditions, selectors and operations through `actions.choose(condition, trueAction, falseAction?)`. The optional false action is a no-op. C07 selector repairs are recorded per source node; no production YAML or parser alias is changed.

## Execution and dependencies

The branch condition executes once when the action runs. Only the selected arm executes, including any nested probability condition, value read, target query or mutation. A computation charge covers each branch decision. Both arms contribute their declared persistent binding plans to compilation, so either arm can install a binding when reached later. A runtime test switches arms across executions and verifies both installed contributions continue following the source stack.

The sequence generator now supports an explicit mark-dependency collection for this action-tree profile. Its factory validates every required BaseMark ID and captures the resolved objects. Missing or mismatched dependencies fail at construction, and clearing the caller's Map does not change the compiled actions. Dependency fixtures retain official mark configs/tags but omit downstream effects; these tests do not claim migration of downstream mark behavior.

The compiler covers nested conditional nodes, mark applications, stage changes/reversal/clearing, damage modifiers, stack consumption and multihit assignments. Existing sequence profiles keep their previous admission boundaries and generated artifacts. The new `reverseStatStages` operation reuses Pet's lifecycle-aware reversal method.

## Preserved semantics

- Probability comparisons remain strict and draw only when reached. The two nested 15%/50% effects draw once on the first successful arm and twice when reaching the fallback. The speed fallback changes spe; spd remains special defense.
- The legacy `[5, 8]` multihit value is parsed as a value list and the setter takes its first item. Its native equivalent assigns 5 without a random range draw.
- Height predicates read Pet.height, not effective attribute-system height. Equal-height and exact-100 cases retain their original strict comparisons.
- Automatic source consumption precedes branch execution. Last-stack cases retain the resulting source detachment and subsequent query behavior.
- Status application guards, strict HP thresholds, existing mark collections and false-arm damage reductions retain their ordering.

## Verification

- All 412 new public cases pass: 384 differential combinations across 24 effects, two source kinds and eight scenarios; four independent/API cases; and 24 fresh-factory JSON checkpoint continuations.
- Checkpoints rebuild mark dependencies and effect factories, then compare another execution with the live pre-restore battle. Trace-only RNG overrides are removed before serialization; controlled RNG is reinstalled only for continuation comparison. RNG draw counts are independently compared by the differential matrix.
- All 377 related stat-stage-clear and authoring-snapshot regressions passed in the initial combined run. That run's 24 snapshot failures were caused by the fixture's own Battle.random override; after removing the override, the entire 412-case new suite passed. There are 789 distinct passing scoped cases, not a repository-wide suite claim.
- All 166 generator tests and 75 design runtime tests pass. Battle typecheck, lint, declaration build and unchanged V1 provenance pass. The generator reproduces 24 generated / 0 rejected candidates.
- New trigger-frame and boolean-condition type assertions pass. The separate design-directory typecheck still reports its existing runtime.test.ts:1491 nested-context error.
- Complete-game, downstream dependency closure and production admission remain open. These are U candidates.

Logs: `/tmp/conditional-verified.log`, `/tmp/conditional-tests-final.log`, `/tmp/conditional-snapshots.log`, `/tmp/conditional-generators.log`, `/tmp/conditional-types-final.log`, `/tmp/conditional-design-types.log`, `/tmp/conditional-lint.log`, `/tmp/conditional-design.log`, `/tmp/conditional-declarations.log`, `/tmp/conditional-provenance.log`.
