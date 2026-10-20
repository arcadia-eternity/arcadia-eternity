# Source-stack dynamic contributions

Ten independent `addDynamicAttributeModifier` definitions now have generated native candidates. The existing weakness-mark selector candidate is retained under `authoring-api-candidates.json`; it is not regenerated or counted as a new candidate. The ledger reports 10 generated, 0 rejected, 1 retained. Source hashes are unchanged and no correction decisions are applied.

## Semantics

All ten new definitions select the source mark once, follow its stack, and append independent attribute contributions on repeated execution. The shared stack-binding emitter is also used by the previously migrated live crit contribution; its generated output remains unchanged.

- Bare stack passes through unchanged, including fractional stack.
- Multiply floors each product, including negative factors.
- `clampMax` uses `Math.min` and preserves fractions below the cap.
- Literal operands are fixed. The configured accuracy multiplier is captured independently at each installation, so later config changes do not retroactively modify existing contributions.
- Installation selects the owner at execution time. A source owner changed in BeforeEffect redirects the new contribution; the attribute source remains the original mark.
- Suppression removes the contribution's effect temporarily; source removal cleans every appended contribution through the existing binding lifecycle.

The generator rejects unsupported roots, attributes, phases, projections and malformed chains. A two-step chain with a null projection is rejected rather than silently treated as a bare stack query.

## Verification

- 343 scoped public tests pass: 322 dynamic-contribution cases, seven live-crit binding cases and 14 authoring snapshot regressions.
- The new matrix compares all ten definitions against unchanged legacy parsing, with initial stacks 0, 1, 2.5, 99, 100 and 101; repeat/late-owner/late-stack/cancel variants; later stack/config updates; suppression/restoration; and source removal. Independent assertions lock clamp and captured-multiplier behavior.
- Every new candidate has a JSON checkpoint case with a fresh effect factory: install twice, restore, change configuration and stack, verify both contributions, remove the source, and return to baseline. This is per-effect checkpoint evidence, not a full-game acceptance claim.
- 153 generator tests, 75 design tests, scoped TypeScript/lint, declaration build and unchanged V1 provenance pass. Review outcomes are recorded in the migration progress entry.
- All candidates remain U pending complete-game and production admission. The full repository public suite was not rerun.

Logs: `/tmp/dynamic-contributions-tests-final.log`, `/tmp/dynamic-contributions-generators-final.log`, `/tmp/dynamic-contributions-types-final.log`, `/tmp/dynamic-contributions-lint-final.log`, `/tmp/dynamic-contributions-design-final.log`, `/tmp/dynamic-contributions-declarations.log`, `/tmp/dynamic-contributions-provenance-final.log`.
