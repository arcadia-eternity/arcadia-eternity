# Full candidate regression checkpoint

The diagnostic full V4 run started before the stack-damage and rage-cap changes, using the immutable bundle selected by `/tmp/mark-lifecycle-build.config.mjs`. It finished with 27,185 passing and 77 failing tests across 141 files (133 passing files, 8 failing). Log: `/tmp/all-native-candidates-regression.log`; elapsed 1210.47 seconds. This is not acceptance of the current head.

Failure groups:

| Suite                      | Failing cases | Current evidence                                                                                                                                                                                |
| -------------------------- | ------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| skill-power                |            44 | Anonymous oracle parameter identity repaired in `3bbfc66c`; all 2747 distinct cases have subsequent passing evidence, with four complete-suite timeouts separately rerun. See `skill-power.md`. |
| vital-sequences            |             4 | Timeouts; initial fixture owner assignments still need lifecycle investigation.                                                                                                                 |
| mark-removals              |             3 | Damage-phase cases; inspect current damage classification before changing expectations.                                                                                                         |
| corrected-damage-modifiers |            12 | Damage-phase cases; investigation pending.                                                                                                                                                      |
| damage-thresholds          |             8 | Damage-phase cases; investigation pending.                                                                                                                                                      |
| damage-mark-applications   |             4 | Non-pet damage-source cases; investigation pending.                                                                                                                                             |
| official-candidate-catalog |             1 | The fixed bundle had 1060 candidates while live ledgers gained new candidates during the long run. Current catalog passed in the subsequent stack/rage regression.                              |
| rng                        |             1 | Same-seed battle normalization comparison; investigation pending.                                                                                                                               |

The full run was never restarted because of quiet output or observation timeouts. Future full acceptance must use the final build and a stable source/ledger tree throughout. The newer rage-cap correction separately passed 206 related regression checks plus 87 design checks, types, declarations and lint. These focused checks do not substitute for the final full acceptance run.

## October 23 fixture corrections

The current immutable bundle reproduced 28 failures in the five damage/RNG suites (730 passing). These were fixture assumptions contradicted by the separately tested historical damage lifecycle, rather than differences between the native effects and their parsed references:

- Calculation and post-damage phase fixtures now use physical damage. Effect damage bypasses those hooks. Threshold and mark-application suites retain explicit effect-damage cases to verify that distinction, including the `OnDamage` rules that still execute.
- Skill-instance sources are valid for physical/special damage. Cases formerly labelled `nonpet` now verify this supported source and keep comparing native effects with the unchanged parsed reference.
- The complete-battle comparison normalizes generated skill IDs to owner, skill index and base ID. It preserves source identity distinctions, damage fields, event order, actions and RNG outcomes.

For vital sequences, a cleanup assertion first reproduced eight leaked attribute systems from one native/reference pair (`effect_skill_ignite_opponent_mark_jishengzhadan mark late-support`). Initial skill/mark ownership now uses `setOwner`, which registers the systems with their battle. Intentional late-owner changes remain unchanged. All 211 vital-sequence cases now assert that cleanup restores the pre-test global instance count.

Validation: 1027 tests across mark removals, corrected damage modifiers, damage thresholds, damage mark applications, RNG, vital sequences, historical damage lifecycle and the real-battle port suite passed in one run (20.24 seconds). V4 type checking and lint passed. This closes the reproduced fixture failures; a final full run and actual native-content admission remain required. Temporary diagnostic logs were written under `/tmp/effect-regression-oct23/` and are not durable acceptance artifacts.

## Complete fixed-bundle regression (October 23)

The immutable build at `30ef3a46` completed the entire V4 suite: **145 files, 27,364 tests passed, zero failures**, in 682.95 seconds. It includes all 1065 native candidates and the five approved semantic corrections. Test sources and candidate ledgers remained fixed during execution; the subsequent independent generator-check correction did not affect this run. The later official-content entry described in `official-native-content.md` was added after this build and has separate validation.

The full run used one worker and the isolated V4/legacy aliases in `/tmp/effect-regression-oct23/vitest.config.mjs`. Logs and JSON report: `/tmp/effect-regression-oct23/full.log` and `full-results.json` (temporary). The previously failing skill-power and vital-sequence suites passed together with every other suite in this single run. All 188 offline migration checks and 87 authoring design checks also passed; candidate coverage is 1065/1065 with no uncovered definitions. These results establish the fixed-build regression checkpoint, while deployed host cutover remains open.

## Native-entry full regression (October 23)

The subsequent immutable build at `384ac37b`, including the programmatic native-content entry, passed **146 files and 27,373 tests with zero failures** in 608.68 seconds. The same one-worker setup used `/tmp/effect-native-oct23/vitest.config.mjs`; temporary full log and JSON report are `full.log` and `full-results.json` in that directory. Native content construction, independent lookup, parameters and fresh-directory restoration now participate in the complete suite. The later transport/NativePackLoader work is verified separately in `native-pack-loader.md`; it changes the package integration layer outside the V4 core.

## Native host and clock full regression (October 23)

The fixed build at `060b618bd619951e06b3afc19f2bb26175dcc14f` passes the complete suite in one run: **148 files, 27,428 tests, zero failures or skipped tests**, in 627.86 seconds. This includes the native host adapter, enabled decision timers, active-animation/deferred-reset recovery, independent reconnect grace, and real normal/switch decision-phase timing. The subsequent public build-identity entry at `b8f9a04f` changes generated host metadata and has its separate 20 passing environment checks; it does not change engine rules or clock execution.

This run archives the tracked battle source/tests, candidate ledgers and pack data, then uses an immutable bundle with explicit legacy, host and core aliases and one worker. The canonical environment runtime and identity are generated from that archived source before testing. The working checkout and later documentation/build-entry changes cannot alter the test tree. Temporary artifacts under `/tmp/effect-native-oct23-host-full/` include `revision.txt`, `vitest.config.mjs`, `build.log`, `environment-build.log`, `full.log` and `results.json`. The JSON report confirms success, 27,428 passed tests and zero failures/pending tests.

The earlier attempt at `2fd14a9e` passed 147 files and 27,393 tests but failed to load the 19-case environment suite because its isolated tree lacked generated environment artifacts. Generating those artifacts made that suite pass separately. That attempt is not recorded as an all-green full run; the later complete run above supersedes it.

The real Node/Chrome native-package probe separately passes timed/animated and untimed seven-turn games, fresh-directory restoration, reconnect deadline preservation/cancellation and exact game-trace comparison, with zero effect-DSL requests. Focused evidence and remaining server/client cutover gates are in `native-timer-recovery.md`, `native-battle-system.md` and the migration ledger.

## Native initial state and input-readiness full regression (October 23)

The immutable build at `09f7757c6072850d9026332e61e643b1f3a88a41` passes the entire suite: **149 files, 27,442 tests, zero failed, pending or skipped tests**, in 611.05 seconds. This adds the initial-state checkpoint, atomic player-batch parsing, actual native input readiness, multi-turn host submission and single-player surrender to the previous full core/host/clock checkpoint. The later server-default commit `29cc540a` does not change these native core sources; its real factory/service and full server results are recorded in `native-server-default.md`.

The run uses an independent Git archive of battle source/tests, packs, scripts and provenance. It builds its own immutable bundle and canonical environments, with explicit public build, legacy, host and core aliases and one worker. No test/bundle files changed during execution. `/tmp/effect-native-oct23-readiness-full/` contains the archived checkout, `revision.txt`, `vitest.config.mjs`, `build.log`, `environment-build.log`, `full.log` and `results.json`. The final JSON confirms success, 149 file results and 27,442 passed tests with no failures/pending cases. Dependencies are linked to the workspace; the tested source, bundle, content data and generated environments are archived independently.

Initial/core/host/timer changes also pass 101 related checks, types, declarations, lint and source audits. The actual Node/Chrome HTTP probe completes the matching seven-turn games through fresh directories with original initial identities, timed/animated/reconnect recovery and zero effect-DSL requests. Browser application/P2P cutover remains open after the server default switch.

## Native browser preparation full regression (October 23)

The immutable build at `fb610cb59da305ca07880c201372759bead51b84` passes the complete suite in one run: **150 files, 27,463 tests, zero failed, pending or skipped tests**, in 607.66 seconds. This includes built-in AI, native team preparation, preparation decision clocks, public sequence/delta adaptation and the Battle-root parameter lookup fix. The later CLI entry change uses these existing public modules and has its own four passing checks; it changes no tested core/host source.

`/tmp/effect-native-oct23-browser-full/` contains an independent complete Git archive, `revision.txt`, its own immutable core/host/legacy bundles, canonical environments, explicit public-entry aliases, `vitest.config.mjs`, `build.log`, `environment-build.log`, `full.log` and `results.json`. The JSON report confirms success with 150 file results, 27,463 passing tests and zero failed/pending/todo cases. The suite used one worker and its source, data, bundles and environment artifacts stayed unchanged throughout. Dependencies are linked to the workspace.

Eight actual Chrome page cases, 20 browser factory/P2P checks, 11 metadata-loader checks, 59 server regressions, 188 offline migration checks, types, lint, declarations and the actual Node/Chrome HTTP probe pass separately. The full browser application's 13 type errors are independently reproduced against the complete pre-change archive. The full private-room lobby/reload run remains unaccepted because its guest database prerequisite is unavailable. See [browser integration evidence](native-browser-entry.md).
