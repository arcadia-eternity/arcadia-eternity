# Built-in UGC healing vocabulary

The [editable example](../examples/ugc-healing.json) compiles with `createCoreCapabilityRegistry()`: when the source's own skill hits and the owner's current HP is below half maximum HP, heal one quarter maximum HP. Authors edit the parameter table or use literal action arguments; no uploaded callback or formula is evaluated.

| Registered ID          | Author parameters               | Semantics                                                                                          |
| ---------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------- |
| core.selfSkillHit      | none                            | OnHit of the matching Skill instance, or an owner Pet's skill for a pet Mark; field Marks rejected |
| core.ownerHpBelowRatio | ratio, default 0.5, range 0–1   | Collect-time current HP < maximum HP × ratio                                                       |
| core.healOwner         | amount, default 90, nonnegative | Action-time fixed amount through HealContext and Pet.heal                                          |
| core.healOwnerByMaxHp  | ratio, default 0.5, range 0–1   | Action-time current maximum HP × ratio, floored before HealContext                                 |

Numeric slots opt into public Config delta/override operations. The registry descriptors expose the same TypeBox schemas/defaults and public slots used by compilation. The compiler retains references and stable addresses; the host installs the returned parameter catalog before gameplay. Effective values outside the declared range fail rather than clamp. Static capability/trigger selection remains outside the modifier interface.

Definitions are frozen and contain no Battle state. Trusted hosts can combine `coreCapabilities.actions/triggers/predicates` with additional registered definitions. This small vocabulary does not automatically install itself in the production environment or replace the native official catalog.

Validation: the saved JSON example executes on a real Battle. Editing its ratio changes healing from 100 to 200 at maximum HP 401. A BeforeEffect change demonstrates that the condition retains its collection result while the action reads the new ratio. Tests also cover pet Mark sources, unrelated Skill rejection, field Mark rejection, two ordered independent action configurations, schema defaults, JSON reference/address preservation and invalid author fields/ranges. Existing HealPhase handles hooks, active-target checks and HP application.

This is a concrete authoring slice of #223, not the complete compiler or editor. Compound conditions, reusable value presets, template expansion, Mark instance parameter transmission, immutable environment manifests, full execution records and editor integration remain open. It does not establish E-equivalence for converting old DSL definitions with unrelated Config metadata or RNG semantics.
