# Random weather and historical hit cursor

`createRandomWeatherApplication` implements `effect_skill_set_field_qingtian_or_yemu` with shared authoring APIs: skill ownership and a nearest-skill-context first-hit predicate, followed by battle-target addMark using a shuffled ordered pair. Dependencies are qingtian then yemu. The factory validates exact BaseMark IDs and captures resolved objects, so rebinding or clearing its input map cannot replace them. Downstream weather effects and production admission remain pending.

## Historical baseline restored

The unchanged original YAML now parses directly. The selectorValue and useSkillContext names were historical syntax, and later V1 metadata includes currentHitCount. The handwritten corrected oracle has been removed; tests use EffectParser.parse(original). C07/C10/C13 corrections are withdrawn from this candidate's ledger and replaced with the pinned historical revision. This does not imply catalog-wide reclassification is finished.

UseSkillContext.currentHitCount begins at one and is the loop cursor. The loop runs while currentHitCount <= multihitResult, incrementing the cursor after each successful iteration. multihitResult remains the resolved total rather than decreasing as remaining work. Normal completion leaves the cursor past the total. A miss breaks without incrementing. Zero or negative totals perform no attempts and leave the initial cursor at one; a fractional total of 2.5 performs two attempts. These are later V1 semantics, not a newly introduced ordinal policy.

Pre-use and pre-multihit stages see the existing cursor. Reusing the same context does not reset it; after completing two hits, a second execution of that context starts at three and performs no further hits unless the cursor/total is changed. Normal gameplay constructs a fresh context for a new use. Changing the resolved total or cursor during execution affects the next loop condition. The former private attemptedHits counter and reset-to-zero behavior have been removed.

The weather condition is checked at effect admission and therefore applies on the first successful hit. A late ordinal change does not retroactively cancel an admitted effect. A miss has a cursor but no OnHit, so it creates no weather. The cursor is transient execution state; this change adds neither mid-skill checkpoints nor persistent bindings to use contexts.

## Evidence

The 90 weather tests compare unchanged YAML and native execution for both source kinds and weather outcomes, direct/nested/missing contexts, source mismatch, late mutations, cancellation, replacement, one/two/three/zero hits, misses, extension/shortening and same-context reuse. They assert a constant resolved total during an ordinary two-hit use and cursor values at each stage. Direct cases independently verify shuffle draws; all comparisons include subsequent RNG state.

Eleven additional historical cursor cases assert literal traces and terminal state for zero, negative, scalar and fractional totals, extension, shortening on the second hit, cursor mutation, initial and later misses, and disabled skills. The combined 101 source tests pass.

An affected-family run contains 1,039 cases across weather, multi-hit, corrected damage and stat-stage timing. It initially passed 1,037; two assertions still expected nested last-skill effects not to run, contrary to the preceding historical ancestor restoration. Those assertions were corrected and both passed a targeted rerun. No source YAML is rewritten. An independent public-entrypoint build passed all 1,050 affected-family and historical-cursor cases. Four selected skill-disabling cases passed (222 were skipped), as did 10 snapshot tests and 87 authoring-design runtime tests. Both TypeScript checks and V4 lint passed. These results do not establish complete-suite or production acceptance.
