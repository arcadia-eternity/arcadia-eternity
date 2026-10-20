# Long-running regression checkpoint — 2026-10-20

The original public-package run started at 19:06:19 and completed after 7,478.40 seconds: 24,972 passed and 555 failed across 105 files (98 passed, 7 failed). This is not a current-commit acceptance result: its runtime bundle predates the historical selector alias, rage lifecycle, turn-order and hit-cursor restorations, while some test source files were updated during execution.

Failure files and counts: skill-outcome-sequences (1/409), skill-outcomes (291/1,834), mark-applications (207/5,211), rage-damage-sequence (42/43), vital-operators (12/14), historical-fixes (1/7), native-effect (1/2). The sequence failure was a default five-second timeout. Examples in the later files reject BeforeRageGain in the old bundle after tests had been updated to the restored trigger.

The run was allowed to finish; its completion is authoritative, and no worker remains to wait for. Current isolated public bundles and targeted reruns must establish the disposition of each failure. Neither presumed version mismatch nor earlier focused success closes these failures automatically. A stable final source/bundle pair remains necessary for full-suite acceptance.

Current-bundle rerun: rage-damage-sequence, vital-operators, historical-fixes and native-effect passed all 66 tests. This resolves those four files against the current isolated bundle; the three larger files remain separately tracked.

The specific skill-outcome-sequences timeout case also passed on the current bundle in a targeted rerun (1 passed, 408 skipped; test time 333 ms, 30-second configured limit). The skipped cases are not a current-file rerun. skill-outcomes and mark-applications still require current-bundle reconciliation.

## Subsequent skill-outcomes diagnosis — 2026-10-21

The later isolated-bundle run recorded in `/tmp/current-skill-outcomes.log` completed with 1,794 passed and 40 failed out of 1,834 cases, in 1,287.84 seconds. Its bundle predates the random-skill, emblem-cost and weakness-transfer commits. Twenty-four failures were default-timeout failures. Sixteen were parameter cases for the two shahezhili duration effects: twelve threw an ambiguous-anonymous-key error and four late-configuration cases retained the unmodified value.

The parameter failure has a minimized ordering-dependent reproduction: parameter tests alone pass, but including the preceding original-definition parse checks makes 16 fail (two parse checks pass). The legacy parser generates a fresh anonymous key on every parse. The fixture incorrectly found the oracle's parameter by scanning every key with the effect ID prefix. This also made late-configuration observers throw before installing their modifier.

The fixture now retains the keys registered when each reference effect is constructed and verifies that the battle has the selected key. Each parameter case explicitly parses the definition again before execution, so an isolated parameter run also exercises the regression. No effect implementation, expected numeric result or production configuration behavior changed.

Against the isolated bundle containing commit `322ac457`, all 74 shahezhili cases pass, and the 49-case selection covering maimaijinzhen and first-skill turn scenarios passes at the default timeout. V4 typechecking passes. Logs: `/tmp/outcome-parameter-red-confirm.log`, `/tmp/outcome-parameter-green.log`, `/tmp/outcome-timeout-recheck.log`, `/tmp/outcome-parameter-types.log`. This resolves the reproduced parameter fixture bug; it does not establish that long-suite accumulation/performance is fixed or replace a complete stable-source rerun.
