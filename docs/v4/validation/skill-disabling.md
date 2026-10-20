# Skill disabling

Four independent `stun` definitions now have generated native candidates: unconditional stun, 40% stun, taunt (Status), and Physical-only stun. All carry C07 selector spelling repairs and remain U pending complete-game/checkpoint and production admission. Source YAML is unchanged.

`ops.disableContext()` now also accepts `UseSkillContext`, reusing cancellation preflight and per-write battle checks. No separate stun runtime or status model was introduced. `checkSelf` remains a direct-event ownership predicate; a nested skill ancestor alone does not qualify. Category predicates read the current skill-use context, not the underlying skill definition. Conditions are evaluated for admission and are not rerun after `BeforeEffect` changes the source owner or context category.

Cancellation occurs at `BeforeUseSkillCheck`, before rage consumption, hit resolution and damage. The existing engine still records skill appearance and use count before this event. The 40% effect consumes one RNG draw only after ownership passes, and uses a strict less-than comparison at 0.4.

## Evidence

- 464 public tests pass: 226 skill-disabling cases plus the 238 event-cancellation regression cases. Coverage includes all three categories, skill/mark sources, nested/wrong-owner events, mutable context category versus base skill, cancellation of the cancelling effect, repeated dispatch, real SkillPhase execution, probability boundaries and cross-battle rejection.
- Real skill phases assert zero hits/damage/rage cost and no downstream events after cancellation, while skill appearance and use count remain recorded.
- Independent C07 oracles assert original parser failure, exact source hashes and exact repair locations before comparing execution. No C09 repairs or unsupported candidates are present in this batch.
- 145 generator tests, 75 design tests, scoped TypeScript/lint, declarations and unchanged V1 provenance pass. Standards and specification reviews pass without findings.
- The repository-wide public test suite was not rerun; complete-game/checkpoint and production gates remain open.

Logs: `/tmp/skill-disabling-tests.log`, `/tmp/skill-disabling-generators.log`, `/tmp/skill-disabling-design.log`, `/tmp/skill-disabling-types.log`, `/tmp/skill-disabling-lint.log`, `/tmp/skill-disabling-declarations.log`, `/tmp/skill-disabling-provenance.log`.
