# Resource-prevention candidates

Two authored effects reuse existing cancellation and event lifecycles. The shared API adds contexts.consumeStack with nearest-ancestor lookup, admits ConsumeStackContext and RageContext to disableContext, and extends sourceOwnsEvent with the historical consumption-owner branch. No second consumption or rage engine is introduced.

`effect_mark_zhenshihuanxiang_prevent_consume` retains priority 100 and checks the subject mark's base ID. C09 repairs the source path markId to mark; the original YAML must fail parsing and the corrected reference executes through the restored ConsumeStackPhase. Its checkSelf condition tests source ownership against the consumed mark owner on a direct event, or against the enclosing effect source owner for an EffectContext. It does not add an active-pet restriction absent from the source.

`effect_ability_gugao_prevent_rage_when_opponent_use_skill` compares directly against unchanged YAML. It requires a skill actor different from the source owner, an active source owner and rage reason skillHit. It deliberately preserves the historical actor-difference rule rather than silently replacing it with opposing-player equality. Cancellation prevents the rage change, post-gain event and RageChange message through the existing RagePhase.

Both conditions are admission-time checks; moving source ownership during BeforeEffect does not revoke an admitted cancellation. Actions independently locate the relevant ancestor at execution. Source suppression, wrong subjects/resources, nested events, inactive source owners, effect cancellation and repeats are covered for skill and mark sources. Tests compare hook/message traces, resulting stacks/rage, returned amounts and RNG continuation, with independent expected results. An integration check verifies that cancelling consumesStacks metadata leaves the consuming effect body runnable; disabling the protector makes the next consumption take effect.

The source YAML and production registration remain unchanged. These are candidates pending full-game, content dependency and fresh-catalog snapshot acceptance.

Validation: 38 focused checks and 95 stack-lifecycle, automatic-consumption, native-trigger and snapshot regressions pass against the isolated public bundle. V4/design typechecking includes precise ConsumeStackContext event inference and rejection of cancelling Pet targets. V4 lint, declaration generation, provenance and reproducible historical audit checks pass. Coverage verifies the unchanged source hashes and reports 1033/1065 candidates.
