# Configurable fractional healing

Three native candidates retain the original triggers, ownership checks and optional guanghuilingyu requirement. The original raw:number divisor becomes an authored `divisor` parameter, with default 6 or 4. Its canonical address is `parameterAddress(effectId, 'parameters', 'divisor')`. These anonymous original parameters had no stable configId alias. Install the effect's parameter catalog as part of content assembly.

The shared selector reads the current owner's effective maxHp and the effective divisor at action execution. `values.combine` floors their quotient before `ops.heal` creates HealContext. No per-definition context lookup, custom heal phase, or cached instance binding is introduced. BeforeEffect changes are visible; OnBeforeHeal sees the already rounded amount. Repeated executions query again.

## C18: finite action inputs

The old scalar divide permits nonfinite results. Dividing positive maxHp by zero or a sufficiently small positive divisor yields Infinity; the old heal phase exposes that amount to hooks and clamps resulting HP to maxHp. The shared native numeric action boundary rejects nonfinite values before creating HealContext. Dispatch emits EffectApplyFail, and HP is unchanged. C18 records this deliberate difference on each candidate. The source YAML is unchanged; tests show both actual outcomes instead of correcting the old oracle.

Finite negative and fractional divisors retain historical behavior. For example maxHp 241 divided by -2 reaches OnBeforeHeal as -121, then the heal phase clamps its final result to zero. The parameter remains editable; invalid derived action amounts fail at the existing numeric boundary, not through a newly invented parameter type system. The generic generator continues to reject configured division until its broader inputs have been classified.

## Evidence and remaining acceptance

Tests cover both skill and mark sources, all three original effects, custom fractional/negative values, late divisor/maxHp changes, missing support, wrong ownership, nested contexts, effect/heal cancellation and repeat execution. Independent assertions cover exact amounts and HP; comparisons include pre/post heal traces, effect failure messages and RNG continuation. Separate zero/overflow cases assert the C18 difference and direct finite-input rejection.

Validation: 78 fractional-healing checks and 14 shared vital-operator checks pass against the isolated public bundle. V4 and authoring-design typechecking, V4 lint, provenance verification and reproducible historical audit checks pass.

These are explicit native candidates, not automatic production registration. Full-game and fresh-catalog checkpoint acceptance remain part of the overall migration. The support mark fixture is an identity-only mark, so downstream field behavior is not inferred from these tests.
