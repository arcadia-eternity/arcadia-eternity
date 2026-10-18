# Damage-result benefit candidates

Three current-YAML effects have native candidates in `packages/battle/src/v4/official/damage-benefits.ts`:

| Effect                                        | Trigger          | Admission                           | Action                          |
| --------------------------------------------- | ---------------- | ----------------------------------- | ------------------------------- |
| `effect_skill_heal_25_percent_damage_dealt`   | OnDamage         | selfUseSkill                        | heal floor(damageResult × 0.25) |
| `effect_skill_add_rage_25_if_damage_over_100` | OnDamage         | selfUseSkill and damageResult > 100 | add 25 rage                     |
| `effect_skill_crit_gain_rage_20`              | OnCritPostDamage | selfUseSkill                        | add 20 rage                     |

The nearest ancestral UseSkillContext controls admission, including damage nested under an EffectContext. A skill source requires the same skill instance and owner; a mark source requires the same owner only. Missing ancestry rejects the effect. The implementation uses core context classes and TypeScript, with no legacy parser/selector or runtime DSL dependency.

DamageResult is the shield-adjusted damage number, not capped HP loss. A 101-damage overkill against 10 HP still supplies 101 to the healing expression, yielding 25. Full shield absorption supplies zero to healing and excludes the >100 rage benefit, but the existing critical post-damage dispatch still grants 20 rage. Ignoring shields preserves the original 101. Partial absorption of six supplies 95 and heals 23.

Admission and action reads remain separate: damage above 100 admits the rage effect before BeforeEffect can change the damage result. Conversely, raising a previously excluded result does not retroactively admit it. The healing action reads current damageResult and current source owner after BeforeEffect, then floors before HealContext and healing modifiers. Existing DamagePhase event ordering and cancellation are preserved; no damage-runtime fixes are included in this candidate slice.

[Candidate records](damage-benefits-candidates.json) pin exact IDs, current definition hashes and source paths. All remain U with candidate decision E; no production registration or final acceptance is claimed.

The 112 tests comprise:

- 108 native/current-YAML comparisons: three effects × skill/mark sources × 18 scenarios. Cases include exact threshold and below-threshold damage, overkill, full/partial/ignored shields, noncritical damage, late damage changes, late owner changes, different skill identity, nested/missing skill ancestry, cancellation at damage/effect/benefit stages and benefit modifiers. State, hook values, damage/heal/rage messages and the next RNG draw are compared, with concrete assertions for normal, shield, cancellation and timing behavior.
- Three selection-checkpoint comparisons. Each applies a real DamagePhase, saves/restores JSON, then applies another DamagePhase. Native and current YAML implementations run both uninterrupted and restored, comparing HP/rage/damage outcomes and RNG. These are damage-phase sequences, not whole-game or full SkillPhase critical-hit generation coverage.
- Exact candidate coverage and source-hash verification.

Standards review found a test assertion that incorrectly applied skill identity requirements to mark sources; it was corrected with a positive mark-source assertion, without changing the runtime. The reviewer confirmed the blocker is resolved. Independent Spec review remains pending reviewer availability. Official content closure, full-game traces for these IDs, environment publication and production switching remain pending.

Verification: code/declaration builds, V4 typecheck/lint, all 896 tests across 32 V4 files, source provenance and existing Node/Chrome host/checkpoint checks pass.
