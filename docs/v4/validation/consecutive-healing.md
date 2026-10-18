# Consecutive-use conditional healing candidates

Three current production IDs now have handwritten native candidates in `packages/battle/src/v4/official/consecutive-healing.ts`:

| ID suffix                     | First use / count ≤ 1 | Consecutive use / count > 1 |
| ----------------------------- | --------------------- | --------------------------- |
| `120_hp_if_consecutive_half`  | 60                    | 120                         |
| `125_hp_if_consecutive_half`  | 63                    | 125                         |
| `quarter_if_consecutive_half` | floor(maxHp / 4)      | floor(maxHp / 8)            |

The full IDs and normalized current-YAML hashes are pinned in [the candidate ledger](consecutive-healing-candidates.json). The apparently counterintuitive fixed-value branches are preserved exactly from YAML; effect names are not a specification for reversing them. No new public Config parameters are introduced for these unconfigured literals.

The native code preserves collect-time selfUseSkill admission, then resolves the current source owner at action execution. It reads that owner's lastSkillUsedTimes and (for the ratio candidate) current maxHp. The branch condition is strictly greater than one. The conditional divisor is chosen before division and flooring; the resulting number is passed into HealContext once. OnBeforeHeal can modify or cancel healing but cannot cause the source expression to be re-read. No selector interpreter, custom type metadata, RxJS or runtime YAML is imported by the candidate module.

Validation contains 88 tests:

- 84 differential cases against unchanged current YAML: all three IDs, skill and mark sources, and 14 variants covering first/second/third use, execution-time branch changes in both directions, changed source owner, changed maxHp, changes after HealContext creation, additive healing modifiers, effect/heal cancellation, wrong skill, full HP and fainted state. Concrete numeric assertions guard against both paths doing nothing; 407 maxHp distinguishes floor(/4)=101 and floor(/8)=50.
- Three actual SkillPhase sequences exercise first, second and third consecutive uses, another skill resetting the count, and returning to the original skill. Each sequence runs old and native implementations both continuously and after a JSON checkpoint following the first use. Restored lastSkill identity and count, healing values and next RNG draw must match. This is selection-boundary restoration with actual skill execution, not a complete battle-to-victory test for these three IDs.
- One exact-ID/source-hash check prevents stale production definitions from silently passing as the migration oracle.

All records remain U with candidate decision E. Production registration, official skill/species closure, full-game traces, immutable environment publication and independent Spec review remain pending. These tests establish the branch/action-time behavior needed for subsequent static conversion; they do not constitute full catalog acceptance.

Review: Standards review found no blocking issues. Independent Spec review remains pending its existing availability limit.

Verification: code/declaration builds, V4 typecheck/lint, all 784 tests across 31 V4 files, source provenance and existing Node/Chrome host/checkpoint checks pass.
