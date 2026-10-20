# Pending event cancellation

Ten independent `disableContext` definitions have native candidates: eight mark-application guards and two `BeforeEffect` guards. They remain U candidates, pending complete-game, checkpoint and production admission. Source YAML is unchanged.

## Semantics

- `contexts.effect` queries the nearest outer `EffectContext` on every use, beginning at the executing effect's parent. It never returns the executing effect itself.
- `ops.disableContext()` cancels selected pending mark applications or outer effects by setting `available = false`. It performs an initial ownership check over all targets and checks again before every write. Prior writes are not rolled back.
- `damageTargetBelongsToOtherPlayer` uses the nearest damage ancestor and compares player ownership. An opposing bench pet qualifies; a same-player bench pet does not.
- Add-mark ownership predicates remain direct-event checks. The zhixi emblem deliberately tests applicant ownership (`selfAddMark`), while the other application guards test recipient ownership.
- Eight exact C09 repairs resolve `baseMarkId` to `baseMark`/`baseMark.id` and `effectId` to `effect.id`. The differential oracle independently enumerates these nodes, verifies original parser rejection and unchanged source hashes, and compares the ledger against that independent mapping.
- Legacy `selectPath` without `[]` extracts only the first tag. The emitted predicates preserve this behavior, including empty tags and a matching tag in the second position. Expanding this to any tag would require a separate behavior correction.
- HP and rage guards retain strict greater-than boundaries and floor division. Conditions are admission-time checks; changing the pending base mark in `BeforeEffect` does not re-evaluate admission.

## Explicitly unresolved

`effect_ability_gugao_prevent_rage_when_opponent_use_skill` uses `BeforeRageGain`, for which the current V1 port has no dispatch site. `effect_mark_zhenshihuanxiang_prevent_consume` uses `OnBeforeConsumeStack` and a consume-stack context absent from the port. Both are recorded as rejected, not exported as working candidates. Completing these requires lifecycle work and a recorded compatibility decision; mapping either to another existing event would change timing.

## Verification

- 238 public tests pass: skill/mark sources, direct/nested event checks, recipient/applicant distinctions, wrong identifiers/tags, first/second/empty tags, strict HP/rage boundaries, repeated cancellation, real mark creation and real effect execution, outer-context identity, and cross-battle preflight/per-write rejection.
- 142 generator tests and 75 design tests pass.
- Scoped TypeScript, lint, declaration build and unchanged V1 provenance pass.
- Standards and specification re-reviews pass after the reported generator, ownership and oracle-independence issues were fixed.
- Initial differential tests caught an accidental any-tag expansion; it was corrected to the legacy first-tag behavior before the final run. Initial test-harness invocation errors were also corrected. The expanded repository-wide public suite was not rerun for this batch.

Logs: `/tmp/event-cancel-tests2.log`, `/tmp/event-cancel-generators-final.log`, `/tmp/event-cancel-design.log`, `/tmp/event-cancel-types-final.log`, `/tmp/event-cancel-lint-final.log`, `/tmp/event-cancel-declarations.log`, `/tmp/event-cancel-provenance.log`.
