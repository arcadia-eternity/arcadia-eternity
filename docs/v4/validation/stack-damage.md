# Stack-based damage corrections

The user explicitly approved both corrections after reviewing the unchanged legacy execution and the repository's localized descriptions.

- `effect_mark_special_damage_reduction_with_stack` reads the current numeric source-mark stack at action time and subtracts it from Special damage to its owner. Physical and Effect damage are excluded. No stack is consumed.
- `effect_skill_add_damage_30_per_niliu` now runs at OnBeforeCalculateDamage, when a DamageContext exists. It re-queries the owner's first inverse-current mark and adds floor(current stack × damagePerStack). The authored coefficient defaults to 30 and can be configured through its named parameter. Admission still requires the skill owner and an inverse-current mark; removal before action execution yields no modifier.

Both use immediate queries, not persistent bindings or captured instances. Later changes cannot mutate an already resolved damage delta. No changes were made to the source YAML; its hash and explicit correction decision are recorded in `stack-damage.json`.

Validation: 28 checks across native stack damage, the five unchanged legacy characterizations and official candidate assembly. Native coverage includes category/owner admission, late stack changes, repeated execution, cancellation, absent marks, configured fractional coefficients, actual damage settlement and complete SkillPhase execution. Candidate coverage is 1062/1065; production loading remains a separate uncompleted gate.
