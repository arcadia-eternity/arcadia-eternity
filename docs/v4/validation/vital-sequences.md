# Ordered healing, damage and rage candidates

Nineteen complete lists emit ordinary authored TypeScript: six OnHit skill lists, three TurnEnd healing lists, one TurnEnd HP-absorption list, three OnDamage reflection lists, one OnDamage absorption list one PostDamage self-damage list, two OnDamage one-shot self-damage lists and one OnBeforeCalculateDamage rage-conversion list and one OnStack explosion list. All remain U pending complete-game/checkpoint acceptance and production admission. The generator covers all nineteen current top-level vital action lists; it still rejects any unsupported definition as a whole. Production YAML and the parser remain unchanged.

- `effect_skill_ignite_opponent_mark_jishengzhadan` and `effect_skill_ignite_opponent_mark_shaoshang` remove selected opponent marks, then requery the opposing active pet and deal 300/150 damage.
- `effect_skill_consume_opponent_yinbo_damage_2x` and `effect_skill_consume_opponent_yinbo_heal_self_2x` read the first selected mark's stack at execution, multiply by the editable default factor 2 with the existing floor, apply damage/healing, then requery marks for removal.
- `effect_skill_add_rage_with_consume_yinbo_stack` reads the first selected stack, adds rage to the owner's player through the Pet method, then removes marks.
- `effect_skill_consume_dongqifuti_heal_self_quarter_max_hp` checks a self mark during admission, heals floor(current owner maxHp / 4), then removes opponent marks. The self/opponent asymmetry is preserved from the source.

`ops.dealDamage` and `ops.addRage` read their numeric input once per invocation, including empty target lists. Missing input skips writes. Damage enters the existing DamageContext/Pet.damage path. Rage accepts Pet or Player and enters RageContext/addRage with reason `effect` and operation `add`. Existing phase cancellation, clamping and attribution apply. Numeric operations prevalidate all selected targets and revalidate each target before its write; Player targets now use their own Battle association.

The shared sequence generator emits stable authored parameter declarations under `action0_value_step2` for the two raw multipliers. It retains config aliases/tags when present and rejects unsupported or ambiguous mappings. A definition is emitted only when every action and condition is understood. Prior outcome/power and stat-stage generated outputs reproduce unchanged.

Public tests compare unchanged YAML with each candidate using skill and mark sources. Cases include absent/late marks, late owner/actualTarget/stack changes, cancellation, nested contexts, duplicate marks, repeated dispatch, actual SkillPhase and turn execution, destruction callbacks switching active slots, and value-operation callbacks redirecting actualTarget before removal. Independent state and event-trace assertions distinguish removal-before-damage from value-before-removal. Parameter checks cover noninteger multiplication/flooring, zero, and changes between collection and execution. Operator tests compare the legacy operations for multiple/mixed Pet and Player targets, duplicates, empty/missing values, cancellation and negative inputs; foreign-target tests assert rejection before any write.

Final validation passes 245 public checks (211 sequence/source/parameter, 14 new operators and 20 mark-removal regressions), 92 generator tests and 69 authoring design tests, plus types, lint, declarations and provenance. The older repository-wide non-green regression result remains separate; these mechanism checks do not establish catalog-wide completion.

## Mark-trigger extension

The three periodic healing definitions use current owner maxHp divided by 8, 16 or 6, floored at execution. Admission checks whether the owner is active; changing owner/maxHp after admission affects execution without recollecting the predicate. Real TurnEnd dispatch is tested with an explicit stage probe.

Reflection reads the nearest DamageContext.damageResult: multiply by 1.5, divide by 4, or multiply by 0.5 after the collect-time Special damage condition. Each operation retains flooring. Mihuo self-damage uses the same nearest result during PostDamage and the existing selfUsesSkill predicate. Its emitted damage has a mark source and does not recursively dispatch PostDamage, which only pet-sourced damage dispatches.

The 1.5 reflection and mihuo definitions consume one source stack before the action. With one remaining stack, destruction detaches the source owner, so the subsequent owner/opponent selection is empty and no secondary damage occurs. With additional stacks, the action executes with the reduced stack count. Late zero stacks and effect cancellation are tested separately.

The new fixture compares unchanged YAML over direct, nested and actual-phase execution, shield reduction, overkill, zero damage, last-stack consumption, inactive owners, wrong targets/types, post-collection value/type/owner/slot changes and repeated dispatch. Shields reduce 101 to 81 before the candidate reads damageResult; overkill against 7 HP retains result 101. Independent effect traces and HP assertions verify those values and recipients. Runtime error logs must be empty, so swallowed callback exceptions fail the fixture.

Both review axes pass the extension. The original six records remain unchanged. The final 127 new checks pass; combined regressions and checks are recorded in the execution ledger. These are phase-level scenarios, not per-ID complete-game/checkpoint admission.

## HP absorption and dynamic clamps

`effect_mark_absorb_hp_to_opponent` uses two separate execution-time calculations. Both compute `min(floor(owner.currentHp / 8), floor(owner.maxHp / 8))`; the first damages the current owner, while the second heals the current opposing active pet. At 800/801 HP the first damage is 100, leaving 700 HP, so the second value is 87. The second action does not capture or reuse the first amount.

The numeric emitter supports dynamic clampMin/clampMax only with an explicit dynamicClamp option. It reads the upstream numeric selection first, then the limit selection, pairs limits by index, and defaults a missing limit to zero exactly as legacy mapNumber does. Scalar consumption takes the first pair; collection consumption keeps all pairs. Other numeric-generator callers retain their former recognition boundary. No runtime API changes were needed.

Thirty-eight public comparisons cover skill/mark sources, real TurnEnd dispatch, inactive owners, cancellation, changes before execution, changes to HP/maxHp/source ownership after the damage, owner detachment, an opposing active-slot switch, repeated dispatch, nested contexts, integer boundaries and the maximum-HP cap. Independent expected amounts and post-action states establish the second query's timing; all runs assert no swallowed runtime errors. A separate emitter test checks both clamp directions, scalar/collection results, absent limits and explicit opt-in.

Both review axes pass. All prior thirteen records remain unchanged. Complete games/checkpoints and production admission remain pending.

## Rage conversion before damage calculation

`effect_skill_clear_rage_add_fixed_damage` first adds `floor(current owner player rage * multiply_value)` to the damage delta, then independently requeries the owner player and adds `floor(current rage * -1)`. The second action uses the original negative `add` operation and therefore dispatches OnRageGain. Cancelling or modifying that phase affects rage removal after the damage modifier has already been written. Owner or rage changes between the actions affect only the second query; detachment leaves its target empty.

The editable factor has canonical parameter identity `action0_value_delta_step1` and legacy alias `effect_skill_clear_rage_add_fixed_damage.multiply_value`. Native configuration writes use `parameterAddress`; aliases resolve through ParameterCatalog, not direct ConfigSystem writes. The shared action emitter accepts only an unchained damageContext target for addModified. No runtime changes were needed.

Forty-three public checks compare the original YAML against skill and mark sources, including real DamagePhase and SkillPhase probes, repeated and nested dispatch, late parameters, owner/rage changes between actions, cancellation, negative-zero and existing damage modifiers. Independent amounts and ordered event traces supplement differential assertions; runtime error logs must remain empty. Prior fourteen candidate records remain unchanged. Full-game/checkpoint acceptance and production admission remain pending.

## Damage absorption after HP deduction

`effect_mark_absorb_damage_to_heal` retains the original OnDamage ordering: set the damage context unavailable, then heal the current owner by floor(damageResult / divisor). The divisor is 2 when the opposing active pet has `mark_kuihuazhongzi`, otherwise 4. DamagePhase has already deducted HP before this trigger; marking unavailable does not restore it. With starting HP 1000 and damage 101, final HP is 924 or 949.

The shared `ops.preventDamage` validates all selected contexts before mutation and revalidates each before writing. Empty selections and duplicates retain ordinary operator behavior. Conditional division opts in explicitly and currently accepts only scalar consumption, finite nonzero literal branches and opponent-mark existence. Other conditional inputs remain rejected. The operand is read before the divisor; the existing values.combine supplies that evaluation order.

Forty-one absorption checks cover both source types, real DamagePhase, late membership/value/source changes, inter-action mutations through a test-only available setter, repeated dispatch, cancellation, last-layer detachment and zero damage. Nested EffectContext dispatch fails the original direct selfBeDamaged condition and is explicitly asserted as unadmitted. Four operator checks compare legacy normal/empty/duplicate behavior and prove cross-battle selections cause no partial write. All fifteen previous candidate records remain unchanged. This candidate is U pending full-game/checkpoint acceptance and production admission.

## Stack-triggered explosion

`effect_mark_explode_on_stack_over_100` admits when checkSelf owns the event and the nearest StackContext.stacksAfter is at least 100. It then damages the current owner and independently consumes the source mark, reading separate editable parameters `yinbo_damage_value` and `yinbo_consume_stacks_value` at their respective action times. The predicate uses event data; changing event stacksAfter after admission does not revoke the collected effect, while changing actual mark stacks affects consumption. A same-owner different existing mark still satisfies the original checkSelf condition.

The reusable contexts.stack selector resolves its nearest ancestor on each read. consumeStacks now accepts raw configurable numbers in ordered lists. A differential case revealed that legacy consumption still applies to the source mark after owner detachment. The runtime validator permits this only for the current effect's source mark with a null owner; unrelated unowned marks and foreign-owned marks remain rejected before writes, including ownership changes during numeric evaluation. Other numeric operators keep their existing validators.

Forty-three public comparisons cover both mark and skill sources, real mark addition/stacking, threshold boundaries, nested contexts, same-owner different marks, late event/stack/owner changes, repeated execution, cancellation, zero and independent parameters, and mutations during damage callbacks. Five operator checks verify detached source consumption and foreign/unowned target rejection without partial writes. All sixteen previous records remain unchanged. The candidate remains U pending complete-game/checkpoint acceptance and production admission.

## One-shot self-damage and source identity

The two remaining lists require C07 plus the exact C09 damage-source entity repair documented in [path corrections](skill-path-correction.md). Both query the current damage result, deal floor(result \* 0.5) to the current owner and then destroy the source mark. Their category conditions respectively exclude Status and require Special. The source guard compares instance identity: the current source mark fails, a different instance with the same base ID passes. Recursively emitted damage therefore does not retrigger its source before removal.

Thirty-eight source/correction/behavior tests cover positive and rejected categories, ownership, identical/different damage sources, changes after collection, nested and repeated dispatch, real DamagePhase, zero/odd/overkill damage, and owner change or detachment during self-damage. Independent assertions require a single damage event and removal afterwards; all runs reject swallowed runtime error logs. Source-null lifecycle validation is now shared by removeMark and consumeStacks so the original source remains removable after detachment. Three additional removal-boundary tests preserve rejection of unrelated unowned and cross-battle targets before any write.

All seventeen earlier records remain unchanged. All nineteen current lists have complete candidates, but per-ID full-game/checkpoint acceptance, dependency closure and production cutover remain pending. The two corrected definitions retain U classification until acceptance.
