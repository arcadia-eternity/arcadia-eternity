# Restore historical mark-presence conditions for the oracle

The current production YAML uses `selfHasMark` and `opponentHasMark`. These were missing from the imported parser, but already existed in the later V1 implementation. This restores their historical bodies and the corresponding DSL, schema and parser branches; it does not reinterpret them as new native effects.

Historical implementation checked by the test: commit `e19261dba321d06a971b74455b08bac5f2dc1f70`, `packages/effectBuilder/src/condition.ts`. The test compares a locked SHA-256 digest of the method section after whitespace normalization and `let` to `const` normalization, without requiring the historical Git object in shallow CI clones.

Preserved semantics:

- The self condition requires a Pet owner and searches its marks.
- The opponent condition evaluates `BaseSelector.opponent` at condition execution. It does not use the skill's `actualTarget`.
- Both evaluate the value source and compare only its first result; an empty result fails.
- Both match base IDs in the list without adding an active/suppressed filter.
- Existing source scope and value timing remain owned by the legacy value evaluator.

`legacy-mark-conditions.test.ts` passes 43 checks: skill/mark source, absent/present/wrong base, inactive marks, empty/first values, owner changes, switching, actual-target distinction, non-pet ownership, parsed execution, scoped values and the historical source comparison.

The original V1 import baseline remains unchanged. Updating `v1-port-provenance.json` records the reviewed current digests of these four restored files; it does not claim they are byte-identical to the older import baseline. Parser acceptance is not behavioral migration acceptance, and no Effect ID is classified E/C by this restoration alone.
