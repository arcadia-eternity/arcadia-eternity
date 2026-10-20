# Historical action-valued selection

Reference: `61c349fa7ca35c392b0e751c9238759b02aefcb3`. The legacy oracle now restores `executeActions`, action-shaped values in `parseValue`, and `Action` in selector opinions. The operator's whitespace-normalized body is pinned to that revision. The value-extraction helper also retains the historical handling of void-returning action functions. This restoration does not admit the three native candidates or change production YAML.

## Observed behavior

The selector-value implementation evaluates function-valued array members before applying selector steps. Consequently, `[actionA, actionB] → randomPick(1) → executeActions` executes both actions in source order before the shuffle. Their void results are then selected and ignored by executeActions. Reversing the shuffle does not change the resulting action trace.

Nested groups behave differently: `[[actionA, actionB], [actionC, actionD]] → randomPick(1) → flat → executeActions` preserves the inner arrays during initial selection. Only the selected group's actions execute, in order. This is the form used by the physical-pair versus special-pair stat reduction effect; the special defense stat is `spd`, while speed is `spe`.

Thus the two single-stat random-choice effects have a reproducible historical eager-execution defect. The paired-stat effect already expresses deferred execution through grouping. Native migration must distinguish these cases: preserve the grouped choice behavior, and explicitly record the flat-choice correction rather than claim unchanged historical equivalence. Functions remain trusted code; this does not expose executable code to UGC authors.

## Parser boundary

The existing Zod oracle now accepts operator values with an action-shape gate before recursive validation. Operator schemas dispatch on their `type` discriminator, avoiding repeated traversal of nested selectors for unrelated operator alternatives. Nested actions still receive normal field validation; a setRage action without its value is rejected. This adapts the local Zod parser, rather than replacing it with the later historical TypeBox schema.

## Evidence

`historical-action-selection.test.ts` covers flat/grouped choices with both selection orders, unchanged parsing of all three current definitions, inventory cardinality, direct action invocation order/duplicates/empty lists, invalid nested values, and the pinned operator body. Timing assertions observe state inside shuffle, independently of final state. The independent public-entrypoint build passed 115 checks across this suite, ignore-shield parsing/execution, rage lifecycle, and random weather. V4 and authoring-design TypeScript checks passed. No full migration acceptance is implied.
