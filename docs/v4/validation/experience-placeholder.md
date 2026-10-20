# Experience placeholder migration

`createExperiencePlaceholder` preserves `effect_ability_exp_boost_50_percent`, its OnBattleStart trigger, priority zero, checkSelf condition and empty TODO action. The native declaration uses the shared `conditions.sourceOwnsEvent` and an empty action sequence. It does not implement experience settlement or claim a 50% bonus.

The current YAML explicitly contains `apply: { type: TODO }`. A search of the pinned later historical battle/effectBuilder source found no experience-settlement implementation to port. The test pins the complete current definition, compares both skill and mark sources against the unchanged parsed definition, checks the direct battle-start condition is false, and separately invokes each empty body under the execution budget to verify unchanged HP, rage, levels and stacks.

Three placeholder checks, 73 automatic-consumption checks and nine weight-characterization checks pass (85 total) against the isolated public bundle. V4 typechecking, lint, declarations, provenance and historical audit checks pass. Candidate ownership becomes 1,057/1,065; this includes preservation of a source placeholder, not delivery of a new experience feature. Production admission remains open.

Evidence: `/tmp/experience-test.log`, `/tmp/experience-types.log`, `/tmp/experience-lint.log`, `/tmp/experience-declarations.log`, `/tmp/experience-coverage.log`.
