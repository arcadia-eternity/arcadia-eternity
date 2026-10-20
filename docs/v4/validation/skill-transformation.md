# Skill transformation candidates

The two authored candidates use shared selectors, conditions and operations. `transformSkill` reads one optional BaseSkill prototype at execution, then delegates to the existing transformation system with temporary duration, priority zero, source binding and the default preserve-effects strategy. `removeSkillTransformation` delegates to that system's removal method. Both validate the entire selected target collection before writing and revalidate targets before each write; transformation also revalidates after reading its prototype.

The copy condition preserves checkSelf's direct-event ownership semantics, including an enclosing EffectContext, and compares the used skill with the source skill instance. A mark source can pass that comparison but selects no skill target, matching the legacy no-op. The removal condition is selfUsesSkill and runs at the restored SkillUseEnd event, priority five. Skill and context lookups stay in the shared authoring API.

## Explicit source corrections

`effect_skill_change_to_used_skill` requires C09 and C19. Both skillId paths become skill. The action's select baseId produces a string, while transformation strategies consume a prototype object; the repaired reference uses selectPath base. An explicit test observes the C09-only reference passing the identifier to a mocked transformation call, so C19 is not inferred from successful native behavior. Original parsing must reject the invalid path, while the repaired reference parses. The production YAML remains unchanged.

The removal definition compares with unchanged YAML and has no source correction.

## Timing and lifecycle

The existing transformation system replaces earlier temporary records from the same source. Records from different sources can coexist; removal pops the latest installed record and reapplies the remaining priority stack. It does not clear every transformation. Tests cover both replacement and stacking, repeated removal, permanent transformations, absent records and a transformation installed during BeforeEffect. Copying reads a skill substitution made during BeforeEffect. Cancellation before effect execution and BeforeTransform cancellation leave the original base intact.

Tests compare prototype IDs, effective power/category, retained effect identities, event/message order and subsequent RNG. They cover skill/mark sources, wrong owners and skill identities, nested events, actual hit/miss/disabled skill phases and a copy-then-clear composition. Foreign-target removal is rejected before mutating a valid earlier target. The tests also establish that the SkillUseEnd message observes the restored base.

These are native candidates, not production registration. Full content dependency closure and fresh-catalog snapshot continuation with these particular candidates remain outstanding; existing kernel snapshot tests alone do not establish their acceptance. The pre-existing transformation implementation and its effect-merge behavior were reused unchanged.

Validation: 53 focused public-bundle checks pass (33 removal/operator cases and 20 copy/correction cases). Snapshot, automatic-consumption and authoring-boundary regressions pass 90 more checks. The copy tests assert one retained record after repeated same-source copies and zero after copy-then-clear. Operator tests verify one prototype read across two targets, absent values, initial foreign ownership and ownership changes during the read. V4/design typechecking, V4 lint, declarations, provenance and reproducible historical audit checks pass. Coverage validates both source hashes and reports 1031/1065 candidates.
