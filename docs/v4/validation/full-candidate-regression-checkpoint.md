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
