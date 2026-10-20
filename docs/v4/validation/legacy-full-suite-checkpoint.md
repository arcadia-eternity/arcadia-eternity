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

## Skill-outcomes full-file acceptance and lifecycle fix

The next diagnosis added a per-test assertion that `AttributeSystem.getGlobalMemoryStats().totalInstances` returns to its pre-test value after battle cleanup. All 16 parameter cases failed this assertion before the fixture change; the final case left 208 instances against a pre-test count of 194. The fixture assigned `owner` directly to newly created skills and marks, bypassing the existing `setOwner` methods that register their attribute systems with the battle. Battle cleanup therefore could not release them, and the global calculation-stack scan grew across cases.

Fixture setup now calls `SkillInstance.setOwner(pet)` and `MarkInstance.setOwner(owner, battle.emitter)`. The deliberately ownerless replacement skill in the mismatch case retains its ownerless semantics but registers its attribute system with the battle explicitly. Intentional late/wrong-owner mutations remain unchanged. The cleanup assertion stays in the suite; it checks every case without clearing global registries or masking leaks.

With this fix and the parameter-identity fix, the entire file passes **1,834/1,834** against the same `322ac457` public bundle, at the default timeout, in **9.24 seconds** (8.28 seconds test time). Formatting reported no source changes during verification. No production attribute algorithm or timeout was changed. The prior 1,287.84-second run used an earlier bundle as noted above; the isolated cleanup regression supplies the direct before/after evidence for the fixture leak rather than attributing every timing difference solely to it.

V4 typechecking and scoped lint pass. Logs: `/tmp/outcome-lifecycle-red.log`, `/tmp/outcome-lifecycle-green.log`, `/tmp/outcome-full-lifecycle.log`, `/tmp/outcome-lifecycle-types.log`, `/tmp/outcome-lifecycle-lint.log`. This closes the current skill-outcomes file failures; mark-applications, remaining candidate implementation and overall production admission remain open.

## Mark-applications full-file acceptance and incoming-mark lifetime

An isolated copy of the mark-applications suite first reproduced two uncollected attribute systems per normal night-field case. Its support marks assigned `owner` directly. The permanent fixture now uses the existing `setOwner` method for field/support/value marks and checks attribute-instance counts before and after every test. The temporary copy was removed.

This assertion then exposed a production omission in the existing-mark cases: `executeAddMarkOperation` constructs an incoming mark for `MarkStackPhase`, but that operand never receives an owner and consequently was never registered for battle cleanup. The new `registerBattle` method registers attribute lifetime independently of ownership; `setOwner` reuses it. The stat-level subclass registers both its ordinary and level attribute systems. AddMarkPhase registers the operand immediately after creation, including the none/remove branches. The operand remains ownerless, its attributes remain readable throughout phase execution, and the existing battle cleanup releases them. No stack math, event ordering, source YAML or attribute-cycle algorithm changes.

Four direct cases for stack/none/remove/stat-level all failed the lifecycle assertion before the runtime fix. They pass afterward. The ordinary stack case also asserts the incoming owner is null and its stack remains readable from OnStackBefore; the existing stat-level path does not dispatch that hook. Initial test construction errors were corrected to use a complete mark config and a TurnStart effect context; the final four-case rerun passes.

The current isolated public bundle passes the entire **5,211-case mark-applications suite**, plus the four direct tests (**5,215 total**, 88.09 seconds). A separate run passes **1,300 cases** across incoming-mark lifecycle, stat stages, phase lifecycle and snapshots. Earlier diagnostic full-file attempts were deliberately terminated after the leaks were isolated; they are not acceptance results. V4 typechecking, lint and declaration generation pass; reviewed provenance and historical audit hashes were refreshed.

Evidence: `/tmp/mark-lifecycle-red.log`, `/tmp/mark-lifecycle-focused.log`, `/tmp/incoming-mark-red.log`, `/tmp/mark-lifecycle-built-full.log`, `/tmp/incoming-mark-regression.log`, `/tmp/incoming-mark-final.log`, `/tmp/incoming-mark-types.log`, `/tmp/incoming-mark-lint.log`, `/tmp/incoming-mark-declarations.log`. Build configuration: `/tmp/mark-lifecycle-build.config.mjs`. This resolves the previously open mark-applications file on the new bundle; it does not constitute a whole-repository rerun or production effect admission.
