# Raw weight behavior before native migration

`legacy-weight-values.test.ts` executes the unchanged parsed definitions of:

- `effect_mark_reduce_damage_with_weight`
- `effect_skill_fixed_damage_by_weight`
- `effect_skill_damage_by_opponent_weight`

For each definition it sets computed weight to 99 and independently tests raw `Pet.weight` as missing, zero and 12.5. All nine checks pass: the legacy delta is NaN, 0 and 12.5 respectively. Computed weight remains 99. The defensive mark consumes one stack before applying its positive delta; the name “reduce” does not negate the value.

These are execution results, not an absence-of-implementation conclusion. The parser, dynamic extractor and addModified operator already exist. The native finite-number and optional-value contracts cannot silently be treated as equivalent to the missing-weight NaN path.

Two decisions were requested from the user before native implementation: whether to use current computed weight (including defaults/attribute changes) or retain raw weight and skip missing values; and whether to correct the defensive effect to a negative delta or preserve its current positive delta. Neither decision has been assumed in this checkpoint. The characterization tests preserve evidence and do not count these three effects as migrated candidates.

Evidence: `/tmp/weight-characterization.log` and the combined `/tmp/experience-test.log`.
