# Static attribute contributions

Twenty independent `addAttributeModifier` definitions now have native candidates, with unchanged source hashes and no spelling/path repairs. One live-value definition remains rejected. These remain U candidates pending complete-game/checkpoint and production admission.

## Shared API and timing

`addAttributeModifier` targets pets; `addSkillAttributeModifier` exposes the bounded numeric skill surface. Both share a single implementation which reads amount then priority separately for every selected target, validates ownership before reading and again before installation, and appends a distinct contribution on each execution. Missing amounts skip, missing priority defaults to zero, and non-finite inputs reject. Phase-scoped contributions are not supported by this batch's generator.

The underlying attribute system retains percent/delta/override semantics. Mark-owned contributions bind to the mark's existing cleanup, activation and suppression mechanisms. Skill-owned contributions do not bind their lifetime to the skill: these source definitions use the legacy generic `addAttributeModifier`, whose source binding is conditional on a Mark, including when its selected target is a Skill. This must not be confused with the different legacy dedicated skill modifier operator.

`selfTeam` and `selfSkills` query the direct skill actor when the direct event is a skill-use context; otherwise they query the effect source's pet owner. Membership is copied on each query. Base-tag `whereAttr` filters inspect the complete tag array, unlike legacy scalar `selectPath` extraction.

`effect_ability_increase_accuracy_5_percent_if_height_above_100` retains its source behavior: `checkSelf` does not match a Battle event, so its OnBattleStart condition is false. This migration does not silently activate it.

## Outstanding live contribution

`effect_mark_increase_crit_rate_20_percent_per_stack` remains rejected because `selectAttribute$('stack')` produces a live attribute source. Passing a sampled number into the static operation would freeze its stack value. It requires an explicit capture/follow binding, including the historical constant/config sampling point, source lifetime and checkpoint semantics.

## Verification

- 401 public tests pass: 394 contribution tests and seven existing authoring boundary tests. The matrix covers Pet/Skill sources, direct team/skill roots, late ownership changes, cancellation, repeated application, full-array tag filters, empty skill selections, configurable values and real source removal.
- Additional API cases verify amount→priority ordering on each target, distinct repeated contributions, source suppression/activation recovery, removal cleanup, cross-battle targets, ownership changes during value reads, missing inputs and non-finite values.
- 149 generator tests, 75 design tests, scoped types/lint, declaration build and unchanged V1 provenance pass. Standards and specification reviews pass after rejecting malformed skill selector chains.
- Test helper typing was narrowed to numeric accuracy explicitly; the final focused lifetime tests were rerun. Full-game/checkpoint and production gates remain open; the repository-wide public suite was not rerun.

Logs: `/tmp/contributions-tests-final.log`, `/tmp/contributions-lifetime-verified.log`, `/tmp/contributions-generators-final.log`, `/tmp/contributions-design-final.log`, `/tmp/contributions-types-verified2.log`, `/tmp/contributions-lint-final.log`, `/tmp/contributions-declarations-final.log`, `/tmp/contributions-provenance-final.log`.
