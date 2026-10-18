# Shared execution budget foundation

Implements part of #218: Battle-owned synchronous root scopes, nested trigger depth and registered action counts. Policy currently fixes depth at 64, actions per root at 4096 and actions per turn at 50000; these are host constants, not editable rule parameters.

Synchronous phase operations, turn resolution and message delivery establish scopes. Nested dispatches and registered action implementations reuse the active scope regardless of newly allocated contexts. Each explicit applyEffects call enters trigger depth. Root counts reset only outside an existing scope; turn counts survive successive roots. Native callbacks remain trusted and cannot be preempted inside an arbitrary infinite loop.

On exhaustion, ExecutionBudgetExceeded is latched on the Battle. Timers are stopped and selection waiters released. Effect condition/application catches and PhaseManager skipOnError cannot swallow the fault. Callback return checks prevent a listener from hiding the error and allowing the interrupted effect to apply. Further phase execution, player input and surrender fail before mutations; no winner or rollback is synthesized. Hosts can inspect executionBudget.fault and receive the same error from the running promise.

Selection snapshots preserve the accumulated turn count and restore a fresh runtime controller before publication. Missing budget state and mismatched turns are rejected. Pre-budget snapshots require an explicit future migration adapter; silently granting a fresh allowance is not supported. Faulted or actively executing budgets cannot be snapshotted.

Evidence: execution-budget.test.ts covers recursive triggers, exact action limits, separate root/turn accounting, permanent fault, room isolation, unchanged inputs/logs after fault, swallowed listener errors and release of an actual startBattle selection wait. The existing full JSON checkpoint/continuation test now checks a nonzero budget and rejects missing/mismatched saved state. The wait fixture has timers disabled; timer shutdown currently has implementation evidence only, not an enabled-timer acceptance test.

Remaining before #218 is complete: dependency evaluation/retry budgets, selection/binding counts, expanded structural limits, immutable environment policy/digest, domain-specific recursive mark/damage scenarios, exact Node/Browser fault-position comparison and full execution records. Legacy callback bodies are not counted as registered actions. Existing host continuation checks are compatibility evidence, not proof of these remaining limits.

Review: Standards identified faulted input acceptance and missing snapshot budget validation; both were repaired with regressions. Independent Spec review remains pending the reviewer's usage limit.
