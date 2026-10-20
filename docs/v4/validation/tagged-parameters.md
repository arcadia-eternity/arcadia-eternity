# Fixed tagged-parameter modifiers

Five native candidates share addTaggedParameterModifier. It samples amount then priority separately for each selected Pet or Player, uses the existing ConfigSystem tagged modifier operation, and binds its grouped cleanup to a source mark. Repeated execution appends modifiers. The operator accepts finite numeric samples; it does not turn an instant value into a persistent follow. The separate mark-stack-driven probability definition is not included in this batch.

The existing ParameterCatalog installs canonical addresses and tags. Tag lookup therefore modifies those canonical entries directly; aliases remain available through ParameterCatalog.read and no parallel config store is introduced. Only keys registered and tagged at execution are selected. Adding a tag during BeforeEffect is visible; registering a new key after execution does not attach old modifiers retroactively.

Candidates cover fire-heart stack gain, generic skill probability, sound-wave stacks, accuracy-reduction stacks and opposing-player paralysis chance. All compare against unchanged YAML. Tests install two canonical tagged parameters plus an unrelated one, use both source kinds, and check owner-pet/owner-skill/bench/opposing-player/opposing-pet scopes. They exercise repeated application, empty tags, late tags/registration/ownership, cancellation, suppression/recovery and source destruction. Stored modifier counts supplement effective-value assertions, and RNG continuation is compared.

## Existing opposing-scope limitation

The paralysis-chance definition selects opponentPlayer but binds its modifier to the actor's source. ConfigSystem additionally requires the read scope to descend from the source owner's scope. Thus the modifier is stored on the opponent but does not affect opposing reads. The candidate deliberately preserves this measured behavior and has no silent scope rewrite. This is an unresolved content/engine semantic issue for production acceptance, not evidence that the described paralysis bonus works.

## Snapshot and acceptance scope

A real normal-selection checkpoint test saves an installed native probability modifier, restores with a fresh effect catalog and fresh ParameterCatalog, and reads through the restored skill scope and parameter alias. Removing the restored source mark removes the modifier and restores the base value. Prototype/effect identities are registered from the exporting battle; restoration uses new instances. This verifies the existing grouped cleanup representation through the new API, not complete-game acceptance of every dependency.

Production registration and YAML remain unchanged. Dynamic parameter modifiers, key-address/alias resolution for non-tagged modifiers, the opposing-scope decision, full dependency closure and overall cutover remain separate work.

Validation: 93 focused candidate/operator/checkpoint checks and 20 existing parameter/authoring-snapshot regressions pass against the isolated public bundle. Tests independently assert per-target amount→priority read order and reject a foreign target before reading values. V4/design typechecking, V4 lint, declarations, provenance and the historical audit pass. Coverage validates all five unchanged source hashes and reports 1038/1065 candidates.
