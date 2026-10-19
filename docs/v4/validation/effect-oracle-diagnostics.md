# Current production oracle mismatch diagnosis

Reproduce using `pnpm exec tsx scripts/effect-migration/diagnose.mts`; use `--check` to compare the saved report. The tool verifies production file hashes and the imported legacy tree against the inventory. Its [per-ID report](effect-oracle-diagnostics.json) separates structural validation from parser construction.

Of the current 1065 definitions, 782 pass the imported legacy schema and 748 pass the full legacy parser. Thus 283 fail schema validation and another 34 fail afterward. The latter include paths such as AddMarkContext.baseMarkId and AddMarkContext.statLevelMarkLevel that the historical custom type metadata does not recognize. These counts do not establish runtime behavior for the accepted definitions.

A diagnosis-only experiment renames the selector spelling useSkillContext to usingSkillContext in base/target fields of a copied definition. This raises schema acceptance to 1049, with 267 newly accepted definitions. It does not mutate production files, run a transformed oracle, approve a compatibility alias or prove equivalence. Other failures include unsupported actions and selector/value shapes; a name-only rewrite is insufficient.

The 2026-10-19 refresh includes the restored historical self/opponent mark-presence conditions; see [source and behavior evidence](legacy-mark-conditions.md). It adds 106 parser-accepted definitions, not 106 migrated effects.

The compact diagnostics discard union alternatives only when the current node's direct discriminator or container kind rules them out. Nested discriminator failures are retained. Two focused Node tests protect that reduction. Diagnostics still describe schema failures, not a complete runtime mechanism classification.

Next: explicitly map each incompatible selector/context/predicate/action to the old implementation and current semantics before building the current-rule oracle. Never replace rejected production definitions with historical fixtures or no-ops.
