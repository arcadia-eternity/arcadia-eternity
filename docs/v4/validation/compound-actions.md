# Ordered compound actions

Thirty-four previously uncovered action lists now have native candidates. Ten lists already owned by earlier ledgers are retained without duplicate generation. Two definitions remain rejected: `effect_mark_transfer_to_opponent_on_hit` needs a typed transfer lifecycle, and `effect_mark_prevent_rage_loss_on_switch` uses a BeforeRageLoss trigger not dispatched by the current engine.

## Reused execution API

The generated code composes existing actions through `actions.sequence`. Each action performs its own queries when reached. Mark arguments use a shared static emitter for fixed identities or conditional BaseMark values; `values.choose` evaluates the chosen mark at the addMark operation's read. Both possible dependencies are validated by the factory. Stack and duration use the existing typed numeric value API. Literal zero retains the legacy parser's omitted-option behavior, while explicit numeric value objects remain values.

The same stack-context query emitter now reads stacksBefore as well as stacksAfter. Dynamic source-stack consumption is admitted for this compound profile and uses the existing once-per-invocation consumption operation. No runtime interpreter or new effect execution engine is introduced.

The shandianluoyin effect has an exact C09 skillId-to-skill path repair after C07. Both original and spelling-only parser failures are asserted before comparing an independently corrected reference. Other source actions, selectors and IDs are preserved.

## Ordering evidence

- Consuming a mark can change the opponent's active position through its removal callback. The next addMark action queries that new position and applies there.
- Yinbo-derived stack values are read before removal; duplicate selected Yinbo marks are all removed, while the new mark uses the first value as in the legacy operator.
- Fear/confusion test all combinations around their thresholds: after must reach the threshold and before must remain below it. The current source stack is consumed only after the mark application.
- `[4,5]` remains a first-item multihit assignment of 4. Assignment precedes consumption.
- Baiya/Heiya stack values clamp at 800. Double rage/power excludes Status and Climax; source suppression removes both contributions from effective values.
- The frost effect retains its existing asymmetric condition/removal targets: it checks the source owner's dongqifuti but removes opponent dongqifuti. Migration does not silently change that source behavior.

## Verification

- 581 public cases pass in the initial complete run: 544 source/scenario comparisons, three independent ordering assertions and 34 fresh-factory checkpoint executions.
- Four additional independent tests pass, including 24 explicit threshold combinations across the two stack effects. Total: 585 distinct passing scoped cases.
- Checkpoints precede action execution, restore fresh effect factories and fresh mark dependencies, then compare event outputs, mark state and skill attributes against the live battle. Applied mark dependencies retain official configs/tags but omit downstream effects; dependency closure is not claimed.
- All 169 generator tests and 75 design runtime tests pass. Battle typecheck, lint, declarations and unchanged V1 provenance pass. The generator reproduces 34 generated / 2 rejected / 10 retained entries.
- Complete-game, downstream dependency closure and production admission remain open. These are U candidates. The repository-wide suite and the separately known design-directory typecheck error are not represented as clean by this scoped evidence.

Logs: `/tmp/compound-tests.log`, `/tmp/compound-independent.log`, `/tmp/compound-generators.log`, `/tmp/compound-types-final.log`, `/tmp/compound-lint.log`, `/tmp/compound-declarations.log`, `/tmp/compound-design.log`, `/tmp/compound-provenance.log`.
