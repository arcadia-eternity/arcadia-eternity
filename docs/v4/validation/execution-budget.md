# Shared execution budget foundation

Implements part of #218: Battle-owned synchronous root scopes, nested trigger depth and registered action counts. Policy currently fixes depth at 64, actions per root at 4096 and actions per turn at 50000; these are host constants, not editable rule parameters.

Synchronous phase operations, turn resolution and message delivery establish scopes. Nested dispatches and registered action implementations reuse the active scope regardless of newly allocated contexts. Each explicit applyEffects call enters trigger depth. Root counts reset only outside an existing scope; turn counts survive successive roots. Native callbacks remain trusted and cannot be preempted inside an arbitrary infinite loop.

On exhaustion, ExecutionBudgetExceeded is latched on the Battle. Timers are stopped and selection waiters released. Effect condition/application catches and PhaseManager skipOnError cannot swallow the fault. Callback return checks prevent a listener from hiding the error and allowing the interrupted effect to apply. Further phase execution, player input and surrender fail before mutations; no winner or rollback is synthesized. Hosts can inspect executionBudget.fault and receive the same error from the running promise.

Selection snapshots preserve the accumulated turn count and restore a fresh runtime controller before publication. Missing budget state and mismatched turns are rejected. Pre-budget snapshots require an explicit future migration adapter; silently granting a fresh allowance is not supported. Faulted or actively executing budgets cannot be snapshotted.

Evidence: execution-budget.test.ts covers recursive triggers, exact action limits, separate root/turn accounting, permanent fault, room isolation, unchanged inputs/logs after fault, swallowed listener errors and release of an actual startBattle selection wait. The existing full JSON checkpoint/continuation test now checks a nonzero budget and rejects missing/mismatched saved state. The wait fixture has timers disabled; timer shutdown currently has implementation evidence only, not an enabled-timer acceptance test.

Remaining before #218 is complete: legacy/Config dependency evaluation accounting, selection/binding counts, expanded structural limits, immutable environment policy/digest, domain-specific recursive mark/damage scenarios, exact Node/Browser fault-position comparison and full execution records. Legacy callback bodies are not counted as registered actions. Existing host continuation checks are compatibility evidence, not proof of these remaining limits.

Review: Standards identified faulted input acceptance and missing snapshot budget validation; both were repaired with regressions. Independent Spec review remains pending the reviewer's usage limit.

## Typed value computation accounting

The new ValuePlan evaluation path now charges each uncached node attempt before running it, including failed attempts. A shared successful node is memoized within one Evaluation and charged once; failed retries remain chargeable. Limits are 50000 computations per root and 500000 per turn. Continuous binding recalculations enter the owning Battle scope, so recalculations during an effect share its allowance. Budget errors bypass capture-failure storage, eager-sibling recovery, binding fault withdrawal and attribute fallback handling.

Snapshots persist turnComputations as a required validated count. Hydration rebuilds subscriptions under a separate finite controller, then publishes the untouched saved gameplay allowance. A real capture/follow binding checkpoint at the exact per-turn computation limit restores and saves again without spending gameplay credit; subsequent same-turn switching faults on live computation. Starting a new turn grants the next turn's allowance.

Tests also exercise a graph above the root limit, repeated missing-target recalculations, shared-node memoization, aggregate counts across roots, malformed saved counts and post-exhaustion propagation. All 126 V4 tests, typecheck/lint, provenance and Node/Chrome continuation checks pass. Standards review identified the initial hydration double-charge and it was repaired with the checkpoint regression.

This counts new typed ValuePlan nodes. Legacy ReactiveValue internals and future Config/preset graph nodes still require explicit accounting integration; the entire #218 gate remains open. Signal updates performed directly by trusted code outside a phase each establish their binding evaluation scope and remain subject to cumulative per-turn limits.
