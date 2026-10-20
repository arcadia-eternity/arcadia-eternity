# Skill contributions

Thirteen independent `addSkillAttributeModifier` definitions now have native candidates with unchanged source hashes and no correction decisions. The live stack-to-skill-power definition also has a native candidate; the ledger now contains fourteen generated entries and no rejections. These remain U candidates pending complete-game and production admission.

## Selection and lifecycle

The shared skill operation now accepts an options object containing priority and lifetime. Its default `sourceMark` preserves the behavior of previously migrated generic contributions targeting skills. Explicit `sourceMarkOrTargetSkill` matches the legacy dedicated skill operator: a Mark source owns the contribution and its cleanup; otherwise the modified target Skill is the modifier source. This target may differ from the triggering source Skill. Priority and lifetime options are read when the operation is declared, while amount and dynamic priority remain per-target reads.

`targets.sourceSkill` returns only the effect source when it is a Skill; it does not choose a nearby skill-use event. Reusable skill selection supports the exact base identity, full tag array, category, element and current-power predicates found in these sources. Climax is explicitly excluded where the source says so. Selection is repeated on each execution: the power-minimum effect stops selecting skills once their current power reaches 100.

## Live skill binding

`effect_mark_amplify_power_20x_stack` uses `ops.bindSkillAttribute`. Applying the effect queries the owner's current skills and excludes Status skills. Each selected skill receives an independent appended contribution: the source mark identity is captured, its stack is followed, and the result is `Math.floor(stack * 20)`. Later skill additions receive no contribution until the effect executes again. Suppressing the source hides contributions; removing it disposes them.

Pet and Skill binding operations share declaration registration, source validation and installation. Skill recipes use `{ skill, attribute }`; existing `{ pet, attribute }` recipes retain their format. Read guards use the target's owning battle and attribute system. Restore checks that the contribution belongs to the declared target attribute and source, and that a skill target belongs to its owning pet's skill list.

Five additional public tests cover legacy differential traces, late skill membership, JSON checkpoint restoration with a fresh factory, cycle/cross-battle rejection, and source hash provenance. Skill-target type tests accept skill attributes and reject Pet targets/attributes. The implementation adds no RxJS dependency.

## Verification

- 605 scoped public tests pass: 211 skill-contribution cases and 394 generic attribute-contribution regressions.
- Differential cases cover Mark/Skill sources; all four skill categories; full tags including a match in the second position; element, identity and power filters; repeated execution; late owner/power changes; cancellation; empty membership; suppression; removal; and skill-use context initialization from modified attributes.
- Independent assertions verify Climax exclusion, full-array tag matching, threshold reselection and each modifier's source identity.
- Every candidate is checkpointed with both source kinds. JSON restoration with a fresh native effect factory preserves values and Mark-versus-target-Skill source identity; source-Mark removal cleans only the Mark-bound contributions.
- 156 generator tests, 75 design tests, scoped TypeScript/lint, declarations and unchanged V1 provenance pass. Standards and specification reviews pass.
- Complete-game and production admission remain open; the repository-wide public suite was not rerun.

Logs: `/tmp/skill-contributions-tests-final.log`, `/tmp/skill-contributions-generators.log`, `/tmp/skill-contributions-types-final.log`, `/tmp/skill-contributions-lint-final.log`, `/tmp/skill-contributions-design-final.log`, `/tmp/skill-contributions-declarations.log`, `/tmp/skill-contributions-provenance-final.log`.

## Live-binding verification (2026-10-20)

- 266 distinct scoped public tests pass: 256 across live skill, static skill, value binding, authoring snapshot and live crit suites, plus 10 general snapshot regressions. The focused snapshot run also repeats the five live-skill cases.
- All 157 generator tests and 75 design runtime tests pass; scoped battle typecheck, lint, declaration build and unchanged V1 provenance pass. Generator reproduction reports 14 generated / 0 rejected.
- The separate design-directory typecheck still reports the pre-existing `runtime.test.ts:1491` error: a nested EffectContext is supplied where a DamageContext is required. The added type assertions produce no errors. This is not a clean design-directory typecheck claim.
- Complete-game and production admission remain open.

Logs: `/tmp/live-skill-tests-final.log`, `/tmp/live-skill-snapshot-final.log`, `/tmp/live-skill-generators.log`, `/tmp/live-skill-types-final.log`, `/tmp/live-skill-lint.log`, `/tmp/live-skill-design.log`, `/tmp/live-skill-design-types.log`, `/tmp/live-skill-declarations.log`, `/tmp/live-skill-provenance.log`.
