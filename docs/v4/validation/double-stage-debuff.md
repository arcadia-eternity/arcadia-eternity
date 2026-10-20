# Double negative stat-stage changes

`createDoubleStageDebuff` implements `effect_mark_double_stage_debuff` using shared mark-application context lookup, source/applicant ownership admission and the existing stat-stage operation semantics. `conditions.statStageChange(undefined, 'down')` checks all five supported stats, preserving the direct-event requirement and initial negative sign check. `spd` remains special defense and `spe` remains speed.

## Explicit reader correction

The source reads `AddMarkContext.statLevelMarkLevel`, which exists as an unsigned magnitude in historical V2's synthetic event but does not exist on V1 AddMarkContext. V1 already implements `setStatLevelMarkLevel`: it constructs a new BaseStatLevelMark using a signed level, preserves stat type and base ID, and sets the pending stack to the level's absolute value. Copying V2's positive magnitude into this operator would reverse a debuff.

The candidate reads the current `BaseStatLevelMark.initialLevel` with a TypeScript class guard, multiplies by two and floors the result. It records C09 as a typed-reader correction. Even a literal path rewrite to `baseMark.initialLevel` fails V1 parser metadata validation because the base-mark type is not narrowed. Tests assert both parser failures. Their reference therefore explicitly supplies this corrected reader to the existing legacy condition and operator implementations. This does not claim unchanged-YAML or historical-V2 runtime equivalence. Production YAML and parser metadata remain unchanged.

The action uses the shared `ops.setStatLevelMarkLevel`, following the original operator's prototype replacement and absolute stack update. The original prototype is not mutated. Subsequent mark creation, same-sign merging, and the existing stage cap run through the established mark phases.

## Timing and evidence

Admission checks the source and applicant owners, not the receiving pet. Both self and opponent recipients are tested. The condition runs once; changing the pending level from -1 to -3 after admission produces -6, and changing it to +2 produces +4. Changing only the pending stack does not change the signed prototype input. Replacing the prototype with a non-stage mark leaves no level to read. Nested add-mark ancestry does not bypass the direct-event admission requirement.

The 121-case suite includes the parser boundary plus five stats × two recipient sides × twelve cases: normal, positive, zero, wrong applicant, nested event, cancellation, late negative level, late positive level, late stack, late prototype kind, an existing -3 stage and repeated application. Explicit assertions require -1 to become -2, existing -3 plus the changed event to become -5, and two applications to become -4.

The candidate suite and existing stat-stage suite pass 1,398 cases against the isolated public bundle. Additional mark-setting/event regression results are logged separately. Authoring-design tests pass 87 cases; V4/design typechecking, lint and declarations pass. Candidate ownership is 1,056/1,065, with nine definitions remaining; production admission remains open.

Evidence: `/tmp/double-stage-test.log`, `/tmp/double-stage-regression.log`, `/tmp/double-stage-settings-regression.log`, `/tmp/double-stage-types.log`, `/tmp/double-stage-design-types.log`, `/tmp/double-stage-design-test.log`, `/tmp/double-stage-lint.log`, `/tmp/double-stage-declarations.log`, `/tmp/double-stage-coverage.log`.
