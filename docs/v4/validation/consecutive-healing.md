# Consecutive-use conditional healing candidates

Three current production IDs now have handwritten native candidates in `packages/battle/src/v4/official/consecutive-healing.ts`:

| ID suffix                     | First use / count ≤ 1 | Consecutive use / count > 1 |
| ----------------------------- | --------------------- | --------------------------- |
| `120_hp_if_consecutive_half`  | 60                    | 120                         |
| `125_hp_if_consecutive_half`  | 63                    | 125                         |
| `quarter_if_consecutive_half` | floor(maxHp / 4)      | floor(maxHp / 8)            |

The full IDs and normalized current-YAML hashes are pinned in [the candidate ledger](consecutive-healing-candidates.json). The apparently counterintuitive fixed-value branches are preserved exactly from YAML; effect names are not a specification for reversing them. The two fixed-value effects each contain two anonymous `raw:number` declarations. The 2026-10-23 audit repaired their conversion to literals: both branches now use separate authored parameters, with source-node addresses/defaults recorded in the ledger and the complete [parameter mapping](official-parameter-mapping.json). The ratio effect's divisors remain source literals.

The native code preserves collect-time selfUseSkill admission, then resolves the current source owner at action execution. It reads that owner's lastSkillUsedTimes and (for the ratio candidate) current maxHp. The branch condition is strictly greater than one. The conditional divisor is chosen before division and flooring; the resulting number is passed into HealContext once. OnBeforeHeal can modify or cancel healing but cannot cause the source expression to be re-read. No selector interpreter, custom type metadata, RxJS or runtime YAML is imported by the candidate module.

Validation contains 88 tests:

- 84 differential cases against unchanged current YAML: all three IDs, skill and mark sources, and 14 variants covering first/second/third use, execution-time branch changes in both directions, changed source owner, changed maxHp, changes after HealContext creation, additive healing modifiers, effect/heal cancellation, wrong skill, full HP and fainted state. Concrete numeric assertions guard against both paths doing nothing; 407 maxHp distinguishes floor(/4)=101 and floor(/8)=50.
- Three actual SkillPhase sequences exercise first, second and third consecutive uses, another skill resetting the count, and returning to the original skill. Each sequence runs old and native implementations both continuously and after a JSON checkpoint following the first use. Restored lastSkill identity and count, healing values and next RNG draw must match. This is selection-boundary restoration with actual skill execution, not a complete battle-to-victory test for these three IDs.
- One exact-ID/source-hash check prevents stale production definitions from silently passing as the migration oracle.

All records remain U with candidate decision E. Production registration, official skill/species closure, full-game traces, immutable environment publication and independent Spec review remain pending. These tests establish the branch/action-time behavior needed for subsequent static conversion; they do not constitute full catalog acceptance.

The later parameter audit adds 20 red-to-green cases for edited branch values, Skill/Mark source scopes, lazy branch reads, edits after admission and fresh-host restoration. See [parameter surface evidence](official-parameter-surface.md). The combined default/parameter/weakness/native-content run passes 125 tests; types, lint and declaration generation pass. Earlier counts and acceptance boundaries below describe their original checkpoints.

Review: the original Standards review found no blocking issues. The later parameter repair has separate Standards and Spec review evidence in the parameter surface record.

Verification: code/declaration builds, V4 typecheck/lint, all 784 tests across 31 V4 files, source provenance and existing Node/Chrome host/checkpoint checks pass.
