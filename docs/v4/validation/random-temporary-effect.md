# Random temporary effect (xifa)

The native candidate uses `targets.sourceSkill.apply(ops.addTemporaryEffect(selectFrom(choices).shuffled().first()))`. Its four dependencies are validated by effect identity and ID, in original source order, and copied at construction. Clearing or rebinding the supplied map cannot change the choices. The dependency implementations are reused from existing native mark-application, compound-action and skill-reference families.

The new authoring operator accepts an effect or an immediate effect value, validates every selected write target before mutation, samples once, and attaches the result using the shared Battle lifetime query. That query is also used by the restored legacy operator: Skill, then Turn, then current phase. Without a phase, the operator does not read its input. Empty source-skill selection still samples when a phase exists, matching the historical operator's ordering.

## Trigger timing

Adding an effect does not replay the trigger already being dispatched. In particular, the priority +1 dependency also uses BeforeSort, so selecting it during BeforeSort does not change that use's priority immediately. An explicit later BeforeSort dispatch can see it. This is observed historical behavior, not a new immediate-priority policy; changing it requires a separate semantic decision and validation of ordering.

Mark-owned invocation follows the original `skill` selector: it has no selected source skill and therefore adds nothing. The admission condition still observes source ownership. Scoped entries disappear at the end of the owning turn and cannot leak into subsequent turns; independently created skill contexts retain their ordinary defaults.

## Dependency assembly and evidence

The composition fixture installs each native dependency's parameter catalog in the battle configuration. This is required for the parameterized accuracy-reduction stack value; attaching its effect object alone is insufficient. The parent effect does not silently install configuration or mutate the caller's dependency registry.

Four deterministic seeds cover all four choices. Both skill and mark sources cover ordinary use, repeat turns, the low-HP condition, wrong actor, dispatch without an outer phase, effect cancellation and explicit redispatch. Actual SkillPhase execution verifies the resulting shanbi, both-side damage-increase, and opponent accuracy-reduction marks, along with priority, membership expiry and subsequent RNG state. The original xifa YAML and all four original dependency effect definitions are used without correction. Native composition uses the existing native dependency bodies.

The marks in this focused fixture use their original definitions with downstream effect lists omitted. Thus the tests prove selection, dependency actions, parameter assembly and lifetime behavior, but do not claim complete downstream mark behavior or dependency-closed full-game acceptance. The ledger remains a candidate. Active temporary effects remain outside the supported snapshot boundary; cleaned turn state follows the existing snapshot tests.

Additional checks verify dependency identity errors, copying of the dependency map, native no-phase input laziness, atomic rejection of cross-battle targets, and direct effect-object input.

Validation: the independent public build passes 59 xifa/authoring-operator checks and 16 temporary-lifecycle checks. The snapshot suite passes 10 checks; authoring-design tests pass 87. Both TypeScript checks, V4 lint, source provenance, historical audit and candidate coverage checks pass. Coverage is 1,021/1,065 and remains separate from behavioral admission.
