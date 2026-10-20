# Skill numeric references

Eight addValue definitions now use typed skill-context references: evasion, rage cost and priority. Each uses the C07 selector spelling correction. The attack-threshold priority effect additionally uses a named C09 correction from `atk` to `stat.atk`; the original and C07-only definitions both fail parsing. Production YAML and the legacy parser remain unchanged.

## API and semantics

`contexts.skillUse.property('priority').apply(ops.add(1))` is the authored form. The same property API retains Pet.currentHp support and now permits only rage/evasion/priority on a UseSkillContext. Mixed Pet/UseSkillContext selectors cannot claim either group's writable keys. Numeric references stay opaque and execution-local.

`ops.add` checks selected references, reads its numeric delta once, then reads each referenced value immediately before adding. Duplicate references therefore accumulate sequentially while sharing one delta read. An absent input skips; non-finite inputs are rejected. The eight migrated definitions use finite literals, so no missing-value semantics are inferred from their sources. There is no rage/evasion/priority clamping in these additions. Reference setters and getters are shared with assignment; battle validation recognizes the referenced context.

Category and element predicates read the current UseSkillContext. Global field, source mark and current attack queries execute again on each invocation. The attack threshold is strictly greater than 500. The existing battle field predicate retains its full selected mark collection.

## Engine timing retained

The skill phase checks eligibility using `UseSkillContext.rage`, but consumes `context.skill.rage`. A candidate that changes the former does not silently change the latter. The phase test starts with 20 rage and a 5-rage skill, observes a zero context cost and 15 player rage immediately after consumption, then 30 after the non-status hit reward. The independently repaired legacy oracle produces the same trace.

## Verification

- 149 new public cases: 144 effect/source/scenario comparisons; independent numeric and strict-boundary assertions; duplicate-reference read timing; skill-phase rage behavior; cross-battle preflight; and missing-input handling.
- With context-control regressions, all 244 public tests pass.
- All 163 generator tests and 75 design runtime tests pass. Scoped battle TypeScript, lint, declaration build and unchanged V1 provenance pass. The generator reproduces 8 generated / 0 rejected entries.
- Added compile-time assertions reject unsupported skill keys, Pet misuse and mixed-target references. The separate design-directory typecheck still reports the pre-existing nested-context error at runtime.test.ts:1491; it reports no new assertion failures.
- Candidates remain U pending full-game/checkpoint and production admission. Candidate coverage alone is not completion of the migration.

Logs: `/tmp/skill-numeric-tests-final.log`, `/tmp/skill-numeric-generators.log`, `/tmp/skill-numeric-types-final.log`, `/tmp/skill-numeric-design-types.log`, `/tmp/skill-numeric-lint.log`, `/tmp/skill-numeric-declarations.log`, `/tmp/skill-numeric-design.log`, `/tmp/skill-numeric-provenance.log`.
