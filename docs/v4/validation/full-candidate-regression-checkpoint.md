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
