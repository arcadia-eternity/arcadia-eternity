# Raw weight behavior before native migration

`legacy-weight-values.test.ts` executes the unchanged parsed definitions of:

- `effect_mark_reduce_damage_with_weight`
- `effect_skill_fixed_damage_by_weight`
- `effect_skill_damage_by_opponent_weight`

For each definition it sets computed weight to 99 and independently tests raw `Pet.weight` as missing, zero and 12.5. All nine checks pass: the legacy delta is NaN, 0 and 12.5 respectively. Computed weight remains 99. The defensive mark consumes one stack before applying its positive delta; the name “reduce” does not negate the value.

These are execution results, not an absence-of-implementation conclusion. The parser, dynamic extractor and addModified operator already exist. The native finite-number and optional-value contracts cannot silently be treated as equivalent to the missing-weight NaN path.

The user subsequently selected current computed `stat.weight`, including defaults and attribute changes, and confirmed that the defensive mark should reduce damage while the two skills add damage. `weight-damage.ts` implements these explicit corrections. The original nine characterization cases remain unchanged as evidence of the legacy behavior, rather than an equivalence oracle for the corrected semantics.

The new effects use immediate selector/value queries at action time: owner weight for the defensive mark and self-weight skill, current opposing position for opponent weight. No instance or scalar is captured, and no persistent follow binding is installed. A resolved damage delta stays unchanged when weight subsequently changes; the next execution queries again. Automatic stack consumption remains before action execution: destroying the final defensive stack detaches its owner, so the optional owner query skips the modifier.

Native tests cover defaults, zero, fractional values, attribute modifiers, BeforeEffect changes, repeated evaluation, opposing-position replacement before/during execution, actual physical damage settlement, wrong defensive target and final-stack cleanup. Candidate catalog assembly includes these three IDs. Coverage is 1060/1065 candidates; this is not production admission.

Evidence: legacy `/tmp/weight-characterization.log` and `/tmp/experience-test.log`; native and catalog `/tmp/weight-test.log`.

Validation checkpoint: 35 checks passed across native weight effects, unchanged legacy characterization and catalog assembly. Battle V4 TypeScript checks, declaration emission, lint, source-port provenance and historical parser audit passed. The three corrected candidates bring coverage to 1060/1065.
