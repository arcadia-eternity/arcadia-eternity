# Direct mark stack gains

Both independent addStacks effects now have candidates, with no rejected definitions or source corrections. The turn-end effect adds one to its source mark when the owner is active. The damage effect requires a direct DamageContext targeting the source owner and positive damageResult, then adds floor(damageResult \* 0.5).

The reusable ops.addStacks operator reads its numeric input once, validates ownership before reading and again before each write, then calls the existing mark.addStack. That method uses current stack and current maxStacks, and the attribute system enforces a zero lower bound. Fractional values remain fractional. Direct addition does not create or merge marks and does not emit creation, stacking or destruction events; reducing to zero through a negative addition leaves the mark active. The existing null-owner source-mark lifecycle exception applies.

The candidate suite independently verifies zero/one/odd damage, cap saturation and already-above-cap state, late damage/stack/cap changes, late owner detachment, wrong targets, inactive owners, cancellation, repeated dispatch and nested event rejection. Real turns and DamagePhase execution cover pet and non-pet damage sources, plus overkill: damageResult remains the calculation result even when only seven HP remain. Direct operator checks cover negative/fractional/large values, once-only reads across multiple marks, missing and nonfinite input, initially unowned targets and ownership changes during reads.

All 294 public tests across stack gains, stack consumption and ownership boundaries pass. All 127 generator tests, 75 design tests, V4 types/lint, declarations and provenance pass; both review axes pass. Existing generated catalogs reproduce unchanged. Logs: /tmp/mark-stack-gains-{tests,generators,types,lint,declarations,design,provenance}.log.

These remain U candidates pending complete-game/checkpoint acceptance and production admission. No source YAML or production loader changes are included.
