# Damage-rage modifier candidates

Three candidates cover the emblem +20%, mark +10% and mark +20% damage-rage definitions. They now retain the original `BeforeRageGain` trigger and compare directly against unchanged YAML through the legacy parser. The earlier C15 trigger/condition rewrite has been withdrawn from the generator and candidate ledger.

## Historical lifecycle restored

The rage operation now matches the whitespace-normalized body at `61c349fa7ca35c392b0e751c9238759b02aefcb3`: gain/loss modification hooks run before settlement, gain/loss observation hooks afterward, and a cancelled pre-hook returns without emitting a RageChange message. Setting uses its own branch without gain/loss hooks. The native trigger surface and context typing include both BeforeRage events.

The historical `selfBeDamaged` rage branch was already present in the imported condition code. The previous document's claim that it only accepted DamageContext was incorrect. Its actual rule is a direct RageContext with reason damage, a direct UseSkillContext parent, and source owner equal to the rage recipient's active pet. It does not check modifiedType or the skill's actualTarget. `ownerReceivesDamageRage` now follows that rule exactly. Conditions are evaluated at admission; later source-owner or target changes do not recheck admission.

`contexts.rage` queries the nearest RageContext on every operation. `ops.modifyRage` validates selected contexts, reads percent then delta once each, skips missing inputs, rejects nonfinite inputs, and revalidates before writing. Rage settlement performs flooring and updates the player.

## Evidence and remaining acceptance

75 source-import comparisons pass against the unchanged legacy definitions, with independent admission/modifier/result assertions. Both source kinds cover reason/recipient mismatches, a skill target different from the rage recipient's active pet, direct synthetic loss contexts, late owner/target changes, cancellation, repeated dispatch, RagePhase settlement and actual damaging SkillPhase execution.

Eight new lifecycle tests cover event order, pre-cancellation, post-hook modifications not recalculating an already settled amount, re-enabling a context, setting without gain/loss hooks, and the exact historical operation digest. A real loss with the native minimum-rage effect now settles 40 to 10, then assigns 25; the nested assignment message precedes the outer loss message. The 45 rage-assignment tests also pass with this lifecycle (128 tests across these three files).

The 128 checks also pass against independently bundled public entrypoints. Six affected-family source suites pass after separately rerunning three default-timeout cases; see the [restoration checkpoint](historical-restoration-checkpoint.md). Complete-suite validation, fresh-catalog full-game/checkpoint acceptance for this group and production admission remain open. The earlier long-running regression uses the previous built runtime and cannot certify these changes.
