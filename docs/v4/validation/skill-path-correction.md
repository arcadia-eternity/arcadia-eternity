# C09: explicit skill and attribute path corrections

The initial C09 scope covers three current single-action power definitions, in addition to their C07 selector-spelling repair. The mark-application extension below lists two additional exact nodes. Source YAML and the production parser remain unchanged. Each candidate records its source hash and exact before/after node values. The correction helper refuses changed node values or non-selectPath nodes and does not alias unknown paths in other effects.

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

## Mark-application extension

Two additional definitions require the same entity-selection repair at `/condition/conditions/1/target/chain/0/arg`: `skillId` → `skill`.

| Effect                                                           | Following query                                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `effect_ability_add_mark_opponent_xifamihuo_if_using_xifa_skill` | Read skill tags, flatten, require `xifa`; add one `mark_xifamihuo` to the current opposing active pet. |
| `effect_emblem_add_mark_fenshenhying_when_use_fenshenshu`        | Read skill base ID, require `skill_fenshenshu`; add `mark_fenshenhying` to the current source owner.   |

The shared offline helper refuses a changed value or a non-selectPath node at either exact path. Unknown IDs receive no C09 repair. Neither definition becomes a runtime alias. The mark ledger records both C07 and C09, and public tests prove that C07 alone still fails on skillId. Corrected-reference scenarios include positive and negative admission, changes after admission, skill/mark source identity, cancellation, merging and real SkillPhase execution. Application-level checks do not accept the downstream marks' effects; see [mark evidence](mark-applications.md).

## Stat-stage extension

`effect_emblem_raise_spd_1_stage_when_baonuan_20_percent` and `effect_emblem_raise_spd_1_stage_when_rouruan_20_percent` each repair `/condition/conditions/1/target/chain/0/arg` from `skillId` to `skill`, after C07. The following query reads the selected skill's base ID, then the ordered condition draws the 20% probability. The action raises special defense (`spd`) by one stage. Exact-node refusal, original parse failure, positive/negative RNG and real skill execution are covered by the stat-stage timing suite. No global path alias is added.

## Mark-event amount extension

For `effect_ability_enhance_atk_when_spa_enhanced`, the sole repair is `/apply/value/selector/chain/0/arg`: `statLevelMarkLevel` → `stack`. The former property does not exist in AddMarkContext; `Pet.addStatStage` passes the signed requested amount into its stack. This reads the pending event amount, not an already merged or clamped target stage. Admission still checks the base mark's initial direction; late stack changes affect the action amount. The original parser failure, exact metadata, independently corrected reference and 32 behavior checks are recorded in [stat-stage evidence](stat-stages.md). This is a named correction candidate, not equivalence with the failing original or a new global field alias.

## Damage-source entity comparison

Two ordered-list candidates, `effect_mark_self_damage_50_percent_once` and `effect_mark_self_damage_50_percent_once_when_special`, repair `/condition/conditions/2/target/chain/0/arg` from `sourceId` to `source`, following their C07 selector-spelling repair. DamageContext has a source entity and no sourceId field. The unchanged evaluator compares against the current source mark instance; selecting the entity preserves identity comparison and prevents the generated self-damage from recursively retriggering its source. Another mark with the same base ID remains a different source.

The repair is pinned to these two IDs and exact selectPath nodes, with before/after metadata. Unknown IDs and changed nodes are not repaired. Tests require the original to fail parsing, then C07 alone to fail at sourceId; a separately corrected legacy reference supplies the comparison baseline. The current skill-use context category still controls admission, and the remaining action order and half-damage floor remain unchanged. These are correction candidates, not unchanged-source equivalence claims; production YAML/parser and admission remain unchanged.

## Ordered Baiya/Heiya damage lists

`effect_mark_baiyapo_add_damage_based_on_stack` and `effect_mark_heiyapao_add_damage_based_on_stack` repair `/condition/conditions/1/target/chain/0/arg` from `skillId` to `skill`, after C07. Each selects the skill instance's base ID and then adds current source stacks as fixed damage before destroying the source. The source skill ID literal `skill_heiyapo` is preserved. Original parser failures, C07-only skillId failures, exact repair metadata, independent reference behavior and real damage phases are covered by [damage sequence evidence](damage-sequences.md). No production alias or admission is added.
