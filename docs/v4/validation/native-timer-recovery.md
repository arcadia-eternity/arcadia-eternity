# Native timer recovery at selection checkpoints

Enabled timers now participate in the existing settled normal-selection checkpoint. The saved runtime includes each player's configuration, running/paused state, remaining turn/total time, update timestamps and selection status. Unlimited limits use explicit JSON `null` and restore to infinity. The versioned data boundary validates the two player identities, selection references and counters before constructing runtime resources.

Hydration creates no intervals and dispatches no timeout actions. The restored selection phase activates clocks after the host attaches its observers. Running clocks include elapsed recovery downtime; submitted players remain paused. Every clock advances to the recovery point before any timeout callback can stop its peer. Expired turn deadlines resolve once through the existing automatic-selection path; expired total deadlines use the existing loss path. Earlier start/turn effects and accepted selections are preserved.

This slice also repairs reproduced timer lifecycle defects:

- Submitted players pause even when animation pausing is disabled; disabled animation pausing also permits running counters to advance.
- Initializing player clocks retains the animation tracker event handlers.
- Normal animation completion, an invalid reported duration and safety timeout all finish a deferred turn reset. A player who already submitted stays paused after that reset.
- Stopping clocks cancels pending resets, so a later animation timeout cannot restart them.

Validation on October 23:

- The first three lifecycle cases failed against the prior implementation; both deferred-reset cases also failed before the shared completion handler was introduced.
- Sixteen timer cases cover those paths, partial-selection JSON recovery, elapsed downtime, unlimited counters, expired turn/total deadlines and five malformed-state cases. Cleanup checks assert no leaked attribute registrations or scheduled timers. The related final run passes four files and 44 tests.
- V4 source/test types, package declarations, lint and formatting pass. Timer sources and restored selection activation are included in the lint gate. Historical source provenance was reviewed and refreshed; the historical effect audit remains unchanged.
- The native HTTP host probe runs both timed and untimed games through `LocalBattleSystemV4` in Node and actual Chrome. Both complete the seven-turn plan and fresh-directory continuation with identical game traces. All 1065 native effects load; zero effect-DSL requests occur.

Temporary run artifacts: `/tmp/effect-native-oct23/timer-baseline-red.log`, `timer-animation-reset-red.log`, `timer-scoped-final.log`, `timer-types.log`, `timer-test-types.log`, `timer-lint-final.log`, `timer-declarations.log` and `timed-native-browser-final.log`.

## Active animations and deferred resets

Selection checkpoints now also preserve active animation IDs, owners, sources, start times and original safety deadlines, plus a deferred turn reset. Restoring creates no animation timeouts. Resume expires overdue animations once and schedules the remaining portion of future deadlines. The host can complete an animation using its original ID; a late duplicate completion is harmless.

Quiet timer reads project elapsed time against the last overlapping animation deadline. A deferred reset takes effect at that deadline, retaining submitted players' pause and charging only later running time. An explicit saved marker prevents a projected reset from running twice if the host saves again before resuming. Older enabled-timer snapshots without animation fields still load. Animation identity, ownership, timestamps and pending-reset references are validated before resource creation.

Fourteen additional cases bring the timer suite to 30 checks and the related run to **58 passing tests**. The initial five active-animation cases failed against the prior rejection boundary. Subsequent red cases exposed the final paused-interval charge and double charging through a second-generation save; both now pass. The suite also covers overlapping deadlines, early/late acknowledgements, disabled animation pausing, a completion observer removing another animation, the earlier enabled snapshot shape and four malformed animation states. Cleanup checks remain in every timer case.

The real Node/Chrome timed probe now starts an animation before the actual selection-phase timer reset, saves with that reset deferred, reloads a fresh native content directory and completes the original animation exactly once through `IBattleSystem`. Both player clocks resume and the entire game trace matches the uninterrupted game. The bundle has 514 modules and makes zero legacy effect-DSL requests. V4 source/test types, package declarations, pack fixture types, lint and formatting pass.

Additional temporary artifacts: `active-animation-red.log`, `active-animation-projection-red.log`, `active-animation-final.log`, `active-animation-browser.log`, `animation-types-final.log`, `animation-lint-final.log` and `animation-declarations-final.log` under the same temporary directory.

Forced-switch/in-flight checkpoints, phase/reconnection host controls and default application/server routing remain open migration work. This extends timer recovery at the existing selection boundary.

## Decision phase timing

The switch phase now starts decision time for its actual participants before publishing the prompt. Normal and switch decisions share the same timer initialization/deferred-reset path. Completing input pauses clocks and ends decision bookkeeping before action resolution; clearing old selections during resolution cannot resume them or revive a deferred reset. Normal turn timers also initialize before the action prompt, so synchronous listeners' accepted selections retain their paused status.

Three regression cases failed against the fixed previous bundle and now pass: timing only the required forced-switch player with automatic replacement, applying that participant's total-time loss without charging the waiting opponent, and retaining a synchronous prompt selection. The timer suite has **33 cases**. The related five-suite run passes **77 tests**; the separate three-case phase lifecycle suite also passes. Types, declarations, lint, pack fixture types and reviewed provenance pass. The actual Node/Chrome probe starts its animation at the preceding turn end and asserts that both players' next-turn timer reset is deferred in the saved state, then completes the original animation and game after restore.

Temporary evidence: `switch-timer-confirmed-red.log`, `switch-timer-final.log`, `switch-phase-lifecycle.log`, `switch-types.log`, `switch-lint.log`, `switch-declarations.log`, `switch-pack-types.log` and `switch-browser.log`. Live forced-switch timing is covered; snapshots during the forced-switch wait remain outside the current boundary.
