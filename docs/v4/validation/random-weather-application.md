# Random weather and attempted-hit ordinal

`createRandomWeatherApplication` implements `effect_skill_set_field_qingtian_or_yemu` with shared authoring APIs: skill ownership plus a nearest-skill-context first-hit predicate, followed by battle-target addMark using a shuffled ordered pair. Dependencies are qingtian then yemu. The factory validates exact BaseMark IDs and captures resolved objects, so rebinding or clearing its input map cannot replace them. Downstream weather effects and production admission remain pending.

## Explicit corrections

The original definition fails parsing. C10 changes selectorValue to selector; C07 changes useSkillContext to usingSkillContext. Even with both corrections, the legacy selector metadata has no currentHitCount path. That failure remains asserted, and the frozen metadata is not extended. The test reference uses the old parser's unchanged ownership predicate and corrected random action, with an independently written ordinal predicate. This is evidence for the declared corrections, not equivalence with the invalid original.

C13 introduces UseSkillContext.currentHitCount. The source condition explicitly compares it with one, skill_guangyinghuanxiang has two hits, and the earlier V2 regression requires weather only on the first hit. V4 previously had only multihitResult, which is mutable remaining work and cannot identify the first hit.

The new field is zero before any attempt, including all pre-use and pre-multihit stages. Skill execution resets it before dispatching events, even when reusing a context or failing admission. At each loop entry it receives the next one-based attempted-hit ordinal before the hit/miss branch. The last attempted ordinal remains after completion. No attempts means zero. A local counter ensures changing remaining multihitResult cannot repeat or skip ordinal values. A missed attempt has an ordinal but does not dispatch OnHit; this effect therefore does not create weather on a miss. The existing remaining-hit loop and its mutation behavior are preserved.

The ordinal is an immediate execution value. Snapshots remain restricted to settled selection boundaries; this change does not add mid-skill checkpoint support or persistent bindings to transient skill contexts. Each subsequent skill execution starts at zero.

## Evidence

Ninety focused tests cover both skill and mark sources and both weather outcomes. Direct cases exercise ordinal zero/one/two, missing and nested contexts, another skill, admission followed by ordinal/owner changes, effect/add cancellation, weather replacement and option modification. Persistent weather continues to normalize duration to -1. Seed expectations independently verify one shuffle draw on admitted direct executions and none on rejected/cancelled effects.

Real SkillPhase cases use the official skill_guangyinghuanxiang definition, with only its effect list replaced for comparison. Tests cover one/two/three/zero hits, initial miss, a miss after the first hit, extension/shortening during execution, disabled skills and reuse of the same context. They assert event ordinals, remaining-hit values, reset before BeforeUseSkillCheck, exactly one weather application per successful skill execution, and subsequent RNG against the independent reference. Source/dependency hashes and correction details are pinned in random-weather-application.json.

The combined weather, prior multi-hit correction, lucky-mark and snapshot run passes 363 tests. The final 90-case focused run also asserts zero at BeforeMultiHit. V4 typecheck/lint, declarations and Node/Chrome checkpoint continuation pass. Both review axes approved the kernel delta before its two provenance hashes were refreshed. These are scoped results; the full regression is tracked separately and is not claimed by this record.
