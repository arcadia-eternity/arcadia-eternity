# C09: three skill-power path corrections

C09 is scoped to three current single-action power definitions, in addition to their C07 selector-spelling repair. Source YAML and the production parser remain unchanged. Each candidate records its source hash and exact before/after node values. The correction helper refuses changed node values or non-selectPath nodes and does not alias unknown paths in other effects.

| Effect                                             | Corrected node(s)                                                                                                                                    | Meaning                                                                                                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `effect_ability_amplify_power_consume_ruodian`     | `/condition/conditions/2/target/chain/0/arg`: `skillId` → `skill`                                                                                    | Query the current SkillInstance, then its tags, flatten and test `consume_ruodian`. Preserve direct owner check and HP below one quarter; multiplier stays 1.25.  |
| `effect_mark_amplify_non_yanggong`                 | `/condition/conditions/2/target/chain/0/arg`: `skillId` → `skill`                                                                                    | Query the current SkillInstance, then its base ID. Preserve non-Status category and exclusion of `skill_yanggong`, +50 power and one-stack automatic consumption. |
| `effect_skill_add_power_35_if_opponent_spa_gt_atk` | `/condition/conditions/1/target/chain/0/arg`: `spa` → `stat.spa`; `/condition/conditions/1/evaluator/value/selector/chain/0/arg`: `atk` → `stat.atk` | Compare the opposing active pet's current battle special attack with attack, preserving strict greater-than and +35 power.                                        |

The skill-path correction selects an entity, not an ID string: subsequent selectors require tags or baseId from that entity. Pet battle attributes live under stat; neither spa nor atk is a direct Pet field. These are special attack and physical attack, unrelated to spd (special defense) and spe (speed).

## Before and after evidence

With C07 alone, the two skill definitions fail with `skillId` absent from UseSkillContext. The attribute definition fails with `spa` absent from Pet. Public tests assert these specific failures. The independent reference applies only the four listed path changes after C07 and then uses the existing legacy parser/operators.

Tests pin each record's C09 metadata and original source hash. Positive, wrong tag/base ID/attribute comparison, and changes after admission compare reference and native behavior; admission remains collected once. Existing variants cover cancellation, skill/mark sources, another skill, category changes, repeated dispatch, stack consumption, actual SkillPhase execution and subsequent RNG. Three full-game cases include actual post-checkpoint activation and fresh-catalog JSON restoration.

These checks validate the selected correction, not equivalence with the original failing definitions. No core engine behavior changes, global path aliases or production catalog admission are part of C09. Other effects sharing these malformed patterns require their own correction records.

Both independent review axes pass. Standards review found and closed inherited-property lookup for IDs such as `constructor`; the correction table now checks own membership, with explicit regression cases for `toString`, `constructor` and `__proto__`. All 24 combined skill/damage generator tests pass and the generated artifacts remain deterministic.

Final validation: 9,780 V4 tests across 43 files pass, including all 104 power full-game/checkpoint cases. V4 typecheck, declaration build, lint and source provenance checks pass. No production cutover is implied.
