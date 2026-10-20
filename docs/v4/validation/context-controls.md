# Context controls

Five independent effects have native candidates: damage cancellation before calculation, damage cancellation at OnDamage, confusion target redirection, and two positive-stage-ignore conditions. All source hashes are unchanged. Three skill-context selectors use the existing C07 `useSkillContext` → `usingSkillContext` spelling correction, independently checked against the original parser failure.

## API and timing

`ops.setActualTarget` accepts a typed Pet value query. It reads the query once when executed and applies the resolved identity to all selected skill contexts. A later execution queries the position again. Absent input leaves the current target unchanged. `ops.setIgnoreStageStrategy` accepts the four engine strategies or an immediate value query. These operations share context preflight, one input read and per-write battle validation. Redirection additionally rejects a Pet from another battle. They use the existing context and owner query APIs.

The HP condition preserves strict `>` and the old multiplier's floor operation. Damage cancellation includes exactly 60. Damage calculations verify Physical uses def and Special uses spd; spe is not used as special defense.

## Preserved legacy behavior

`effect_mark_prevent_damage` runs before damage calculation and prevents HP loss. `effect_block_damage_under_60` runs at OnDamage, which the engine dispatches **after HP has been deducted**. Its operation sets `available = false` but cannot roll back the loss. Both the native candidate and legacy oracle retain this result in skill-phase tests. Changing this trigger or adding rollback would be a separate gameplay correction; it is not silently included in migration.

`effect_skill_ignore_opponent_shield_if_has_shunliu` remains outside this group: its setIgnoreShield action has no implementation in the current legacy parser. It is not mapped to another action by inference.

## Verification

- 95 new public cases: 80 differential combinations of effect, source kind and scenario, each evaluated at damage 59/60/61; independent HP/damage boundary assertions; Physical/Special damage recalculation; query timing and cross-battle guards; and ten actual skill-phase comparisons.
- Together with damage-threshold and skill-disabling regressions, 482 public tests pass.
- 160 generator tests and 75 design runtime tests pass. Scoped battle types, lint, declaration build and unchanged V1 provenance pass.
- The generator reproduces 5 generated / 0 rejected entries. These remain U candidates pending full-game, checkpoint and production admission. The separate design-directory typecheck's existing nested-context failure was not changed.

Logs: `/tmp/context-controls-tests-final.log`, `/tmp/context-controls-generators.log`, `/tmp/context-controls-types-final.log`, `/tmp/context-controls-lint.log`, `/tmp/context-controls-declarations.log`, `/tmp/context-controls-design.log`, `/tmp/context-controls-provenance.log`.
