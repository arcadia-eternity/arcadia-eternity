# Damage-rage modifier candidates

> Historical baseline review (2026-10-20): later V1 provides behavior missing from the imported oracle. Claims below about C07/C08/C14/C15 require revalidation; see [the audit](historical-v1-audit.md). Earlier passing tests establish agreement with the imported/corrected reference, not with final V1.

Three candidates cover the emblem +20%, mark +10% and mark +20% damage-rage definitions. `contexts.rage` queries the nearest RageContext on every operation. `ops.modifyRage` shares the existing context-modifier implementation: validate selected contexts, read percent then delta once each, skip missing inputs, reject nonfinite inputs, and revalidate before writing. The actual RagePhase performs the later floor and player-rage update.

## C15: reachable event and explicit ownership

In the currently imported kernel, `BeforeRageGain` exists but is not dispatched or mapped as a native trigger. Later V1 does dispatch it before settlement and dispatches `OnRageGain` afterward, so the following C15 rationale is superseded. Actual gains dispatch `OnRageGain` before `updateRageChangeResult`; this is the available modification point. Additionally, `selfBeDamaged` requires a direct DamageContext, while damage-derived rage is constructed with a UseSkillContext parent in the skill phase. Merely renaming the trigger would leave the condition false.

C15 changes both named source nodes for exactly these three definitions. The new condition `ownerReceivesDamageRage` requires a direct RageContext with reason damage and operation add, a direct UseSkillContext parent, that context's current actualTarget equal to the source Pet owner, and the rage target equal to that Pet's player. Global sources, unrelated players/pets, other reasons and rage losses are excluded. Conditions are evaluated at admission; a subsequent source-owner or rage-target change does not recheck them.

The generator rejects unknown IDs or changes to any source field, percentage, priority or condition. The original YAML and legacy parser remain unchanged. These remain unaccepted candidate changes pending reconciliation with the later historical kernel; they are no longer justified as fixes to missing V1 behavior. Public probes retain the original definitions and confirm that normal RagePhase dispatch leaves their modifier at zero.

## Validation

All 75 public cases pass against an independent corrected reference and explicit admission/modifier/result expectations. Both source kinds cover reason/type/recipient mismatch, late owner/target changes, cancellation, repeat dispatch, real RagePhase settlement and actual damaging SkillPhase execution. The first skill-phase fixture mistakenly used the scenario's status skill; after replacing it with a real physical skill, the complete suite was rerun and passed.

All 85 authoring runtime tests pass. New checks establish nearest-context reuse, ordered percent/delta reads even when percent is absent, and cross-battle rejection before evaluating either input. Type assertions reject a heal context as a rage target. The pre-existing nested event ownership test now uses the real BeforeEffect event for its nested branch rather than constructing an impossible PostDamage parent; its unchanged value assertions pass, and both battle and design-directory typechecks now pass.

All 179 generator/inventory tests, lint, declaration build and unchanged provenance pass. Logs: `/tmp/rage-modifiers-tests-final.log`, `/tmp/rage-modifiers-design.log`, `/tmp/rage-modifiers-design-types.log`, `/tmp/rage-modifiers-generators.log`, and `/tmp/rage-modifiers-{types-final,lint-final,declarations,provenance}.log`.

Full-game/checkpoint acceptance and production admission for this group remain open. The ledger marks all three as correction candidates.
