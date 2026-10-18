# Mark instance parameter readers

This slice connects #223 mark-instance parameters to bounded UGC rules. A trusted host binds `compileRule` to a registered `sourceMark`; normalized rule data preserves `sourceMarkId`, and recompilation requires the matching definition. Admission checks definition identity, not only its string ID.

Authors use `{ "instanceParameter": "ratio" }` in public predicate/action fields, probability thresholds, and nested action argument groups. The reader uses the executing source mark's scoped Config value at the point of evaluation. It does not copy the field into the rule parameter catalog. Collect-time conditions, probability, and action-time reads remain separate; later Config changes cannot retroactively change admission.

`core.markCreated` and `core.markOwnerTurnEnd` expose the source's owner pet. The saved example in `../examples/ugc-recovery-mark-tick.json` heals using that mark's current ratio. The existing apply-mark example and this tick example execute together through a skill, mark creation, JSON checkpoint restoration, and a later turn-end trigger.

Compilation checks declared references and TypeBox structural compatibility. A source default is only preview data: it cannot reject a dynamic reference merely because the receiving editor or effective range is narrower. Reading checks the actual value against both the source contract and receiving effective schema before invoking the callback. Static literals retain editor validation. For example, source default 3 with an actual value 1.5 can feed an action whose editor range is 0–1 and effective range 0–2; a later actual value 3 fails before executing that action.

Fourteen tests cover independent instances, Config changes, creation before insertion, collect/action timing, zero/100 probability draws, exact definition identity, malformed or missing bindings, nested references, saved UGC composition and restoration, and preview versus actual range validation. Independent Standards review found the preview issue above and passed after repair. Independent Spec review remains pending reviewer availability; no Spec pass is claimed.

Authored mark-pack loading is now covered by the [pack compiler](content-pack.md). Remaining: general finite value presets, templates/editor integration, structured action outcomes, complete catalog migration, and environment identity/cutover. These readers are live reads at their evaluation point; they do not yet expose a general capture/follow authoring vocabulary.
