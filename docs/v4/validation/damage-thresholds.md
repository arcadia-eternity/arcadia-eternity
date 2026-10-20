# Damage threshold candidates

All five independent addThreshold definitions now have generated candidates, with zero rejections and no source corrections. They include the half-max-HP damage cap, minimum damage 95/100, the conditional minimum of 100 with aideminyi, and the OnDamage save-hp-to-one definition.

The typed ops.setDamageThreshold API reads min and then max once, replaces only present bounds and leaves damageResult unchanged until the existing damage calculation runs. Missing values preserve existing bounds. A later bound replaces the same earlier bound rather than tightening it. DamageContext still applies the lower bound first and upper bound second, followed by floor and the zero lower limit for final damage.

The migration emitter preserves the legacy parser's omission of literal zero. In particular, min: 0 in the half-HP cap leaves an existing minimum intact. A raw:number zero remains an explicit configurable bound. The author-facing API accepts explicit zero normally. Negative finite bounds remain valid; nonfinite authored inputs are rejected before writes, following the existing authoring numeric contract.

Timing is preserved even where the effect name suggests another intent. effect_skill_save_hp_to_1 runs at OnDamage, after HP deduction, and reads the opposing active pet's current HP minus one. It does not undo damage. A real 2000-damage phase against 1500 HP leaves HP at zero and sets maxThreshold to -1 afterward. This is source behavior, not a new guarantee of survival. Non-pet damage sources bypass OnBeforeCalculateDamage and therefore do not invoke the four pre-calculation candidates.

Public differential tests cover both skill and mark sources, admission cancellation, wrong owners, support removal after admission, execution-time HP/max-HP/owner/slot changes, nested and repeated dispatch, real damage phases and later bound overwrites. Independent assertions verify actual HP and damageResult in addition to threshold fields. Operator tests cover missing one/both bounds, explicit zero, negative bounds, min-then-max order, once-only reads across contexts, declaration snapshotting, nonfinite input and foreign ownership before/during evaluation.

All 1,773 public regression checks across damage thresholds, damage modifiers and ownership boundaries pass. The final 161-case threshold suite also passes after type-level fixes. All 130 generator tests, 75 design tests, V4 types/lint, declarations and provenance pass. Both Standards and Spec reviews pass. Existing generated catalogs reproduce unchanged. Logs: /tmp/damage-thresholds-{tests,targeted,generators,types,lint,declarations,design,provenance}.log.

These remain U candidates pending complete-game/checkpoint acceptance and production admission. No original YAML or production loader changes are included.
