# Independent mark removal candidates

The catalog emits all 13 independent destroyMark definitions with zero rejected entries. It reuses the shared single-action classifier, existing owner/source selectors and ops.removeMark; no runtime, original YAML or production-loader change is included. Source hashes, exact triggers, priorities and /apply paths are pinned. No correction decision is needed.

The effects cover turn-end charm removal, ordinary/critical post-damage recovery, recovery at damageResult >= 100, source removal after skill use, opposing hit/miss removal, and owner-mark selection by status tag or named base ID. Multi-trigger definitions retain one effect identity. Post-damage admission uses the damage target, while skill admission keeps actor and actual target semantics.

The public comparison suite runs the original parser and generated candidates against the same seeded scenarios. Source-removal candidates use mark instances; collection-removal candidates exercise both skill and mark sources. Independent assertions cover normal and real phase dispatch, cancellation, wrong ownership, indestructible targets, the 99/100/101 threshold, late damage changes after admission, and noncritical damage not firing critical post-damage effects. Real TurnEnd, SkillPhase and DamagePhase execution is included.

Selector timing is tested by adding/removing marks during BeforeEffect and changing the source owner before execution. The selected collection is then fixed for that removal operation: a callback-added mark remains, while a callback removing a later selected mark does not destroy it twice. Repeated and nested dispatch are compared as well. Persistent fixture marks isolate explicit destruction from natural turn expiration.

All 405 public tests across the candidate and existing removal-operator suites pass. All 121 generator tests, 75 design tests, V4 typechecking/lint, declarations and provenance pass. Both Standards and Spec reviews pass, including the added exact threshold boundary. Logs: /tmp/mark-removals-{tests,generators,design,types,lint,declarations,provenance}.log.

These remain U candidates. Whole-game/checkpoint acceptance and production admission are not established by this scoped verification.
