# Shared action parameters and Config reads

This slice connects #223 D/E public battle parameters to compiled actions. It does not complete preset expansion, sustained Config readers or full UGC acceptance.

Trusted actions opt individual top-level scalar argument slots into `publicParams`, declaring effective-result schema, permitted Config operations and tags. Content arguments still derive their TypeScript type from the action's TypeBox schema. The definition validates scalar contracts and delegates effective-to-content type compatibility to TypeBox `Type.Extends`, so effective numeric ranges may differ while an inferred literal or boolean argument cannot silently become another type.

A rule's finite `parameters` table declares stable nodeId, scalar kind and base value. Actions can use `{ parameter: id }` only in opted-in slots. Compilation preserves those references in normalized content and creates one address `(effectId, parameter.nodeId, parameterId)` for each shared parameter. Source identity is separate. All receiving content schemas and effective schemas are intersected using TypeBox; the declared base value must satisfy every applicable constraint. Allowed modifier operations are intersected and tags combined. Missing references, kind mismatches and invalid connections reject the candidate.

The successful result includes a `ParameterCatalog` and its immutable definitions. The host explicitly installs it before executing the effect. Each action reads linked values from the battle ConfigSystem in the current Skill/Mark source scope at that action's start. The read validates the shared effective constraints and receiving slot, then supplies frozen arguments to the typed implementation. Modifications made by an earlier action are visible to the next action. A sustained binding does not yet get automatic Config dependency tracking from this interface.

Direct numeric/string/boolean arguments remain content constants. They are validated against the content schema and do not become Config entries; `effectiveSchema` governs Config references. For example, a content constant 20 may be legal under a content maximum of 100 while a Config reader for that slot has an explicitly narrower effective maximum of 12. This distinction is covered by a regression rather than silently applying a clamp.

Evidence in `content-parameter-links.test.ts`:

- Two actions preserve one shared reference and address, and source-scoped modifiers affect only the intended skill instance.
- An intervening action modifies Config; the next action reads the updated value, yielding 10 + 15 healing.
- A shared reference obeys both receiving effective ranges. A separate explicitly wider effective range allows a runtime value above the content editing maximum.
- Missing references, mismatched kinds and widening a literal argument to arbitrary numbers are rejected.
- Content constants remain constants; JSON serialization/recompilation retains shared references and addresses; reordering action steps does not renumber the parameter address.

Review status: Standards review found no actionable issues. The independent Spec reviewer checked the shared-address/scope/read/reference paths and raised the constant-versus-reader distinction, then hit a usage limit before a terminal review result. The distinction is now documented and tested; no independent Spec pass is claimed for this slice.

Remaining: shared predicate/trigger/value slots, finite value presets, apply-time captures, continuous Config dependency/cycle tracking, template expansion/copy mappings, Mark instance parameters, catalog manifests/restoration, full diagnostics and production conversion/behavioral acceptance.
