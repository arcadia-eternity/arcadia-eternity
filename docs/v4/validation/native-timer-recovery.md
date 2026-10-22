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

Snapshots still reject active animations and deferred timer resets. Forced-switch/in-flight checkpoints, phase/reconnection host controls and default application/server routing remain open migration work. Enabled timer support at the existing boundary does not close those gates.
