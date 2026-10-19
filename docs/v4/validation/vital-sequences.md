# Ordered healing, damage and rage candidates

Thirteen complete lists emit ordinary authored TypeScript: six OnHit skill lists, three TurnEnd healing lists, three OnDamage reflection lists and one PostDamage self-damage list. All remain U pending complete-game/checkpoint acceptance and production admission. The generator inventories six other vital action lists as unsupported; it never emits a supported fragment of an unsupported list. Production YAML and the parser remain unchanged.

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
