# Static skill contributions

Thirteen independent `addSkillAttributeModifier` definitions now have native candidates with unchanged source hashes and no correction decisions. The one live stack-to-skill-power definition remains rejected. These remain U candidates pending complete-game and production admission.

## Selection and lifecycle

The shared skill operation now accepts an options object containing priority and lifetime. Its default `sourceMark` preserves the behavior of previously migrated generic contributions targeting skills. Explicit `sourceMarkOrTargetSkill` matches the legacy dedicated skill operator: a Mark source owns the contribution and its cleanup; otherwise the modified target Skill is the modifier source. This target may differ from the triggering source Skill. Priority and lifetime options are read when the operation is declared, while amount and dynamic priority remain per-target reads.

`targets.sourceSkill` returns only the effect source when it is a Skill; it does not choose a nearby skill-use event. Reusable skill selection supports the exact base identity, full tag array, category, element and current-power predicates found in these sources. Climax is explicitly excluded where the source says so. Selection is repeated on each execution: the power-minimum effect stops selecting skills once their current power reaches 100.

## Remaining binding

`effect_mark_amplify_power_20x_stack` is not flattened to a number. It requires a live contribution whose target is a Skill, while the current persistent binding target contract is Pet-specific. Extending that target contract requires dependency/cycle and snapshot support. It remains explicitly rejected in the ledger.

## Verification

- 605 scoped public tests pass: 211 skill-contribution cases and 394 generic attribute-contribution regressions.
- Differential cases cover Mark/Skill sources; all four skill categories; full tags including a match in the second position; element, identity and power filters; repeated execution; late owner/power changes; cancellation; empty membership; suppression; removal; and skill-use context initialization from modified attributes.
- Independent assertions verify Climax exclusion, full-array tag matching, threshold reselection and each modifier's source identity.
- Every candidate is checkpointed with both source kinds. JSON restoration with a fresh native effect factory preserves values and Mark-versus-target-Skill source identity; source-Mark removal cleans only the Mark-bound contributions.
- 156 generator tests, 75 design tests, scoped TypeScript/lint, declarations and unchanged V1 provenance pass. Standards and specification reviews pass.
- Complete-game and production admission remain open; the repository-wide public suite was not rerun.

Logs: `/tmp/skill-contributions-tests-final.log`, `/tmp/skill-contributions-generators.log`, `/tmp/skill-contributions-types-final.log`, `/tmp/skill-contributions-lint-final.log`, `/tmp/skill-contributions-design-final.log`, `/tmp/skill-contributions-declarations.log`, `/tmp/skill-contributions-provenance-final.log`.
