# C08: record the actual turn schedule

This document records historical conversion evidence. The offline generators have been removed; maintained behavior lives in `packs/base/src/effects/`. Retained candidate records and YAML fixtures support behavior regression tests.

> Historical baseline review (2026-10-20): later V1 provides behavior missing from the imported oracle. Claims below about C07/C08/C14/C15 require revalidation; see [the audit](historical-v1-audit.md). Earlier passing tests establish agreement with the imported/corrected reference, not with final V1.

C08 initially corrected missing bookkeeping in the imported `phase/turn.ts`. Later V1 already populated planned contexts and registered execution attempts in the skill/switch phase wrappers. It also used recursive ancestor predicates. The earlier direct-parent/no-op interpretation is withdrawn.

## Selected behavior

The executor keeps the existing phase comparator and execution order. A scheduled entry pairs a phase with the exact context constructed for it. After sorting:

- `contexts` contains the complete plan in pop order, the reverse of dispatch order. Its first skill is the last planned skill.
- `contextQueue` initially copies the plan and loses one entry immediately before each phase dispatch.
- `appledContexts` records attempts in the skill/switch phase wrappers before their effects run, including direct phase execution. The turn scheduler does not append a second time. Its first skill is the first attempted skill, including an attempt later disabled or rejected for insufficient rage.

This does not redefine first as first successful hit. Switch entries remain in all three views; skill predicates filter them out. Native and legacy predicates now recursively locate the nearest skill and turn ancestors, including damage and nested effect contexts. The two legacy predicate bodies are digest-pinned to the later V1 reference.

The current actual-order plan remains in place: it follows the sorted phase schedule rather than reproducing later V1's separate pushContext sort during selection collection. Equal-priority/equal-speed ordering is now checked explicitly and retains A-then-B stable dispatch with B-then-A planned pop order. A concrete remaining difference is priority: later V1 sorts the plan by UseSkillContext.priority but sorts phases by SkillInstance.priority; current C08 consistently uses the use-context priority. BeforeSort priority inversion remains an intentional C08 correction, not a claim of byte-for-byte historical scheduling. Planning-time reads while selections are still being collected also require separate consideration.

## Scope and acceptance

[Potential reference inventory](turn-order-correction.json) pins all 27 current official definitions containing first/last skill predicates, their stages, hashes and node paths. It is a scope inventory, not acceptance of all 27 definitions.

Current restoration evidence: 138 source checks pass (16 historical ancestor/direct-phase checks, 112 damage-order comparisons, and 10 execution-lifecycle cases), plus all 14 damage-order full-game/checkpoint comparisons and 87 authoring/value-binding tests. Every damage-order full game now requires a positive effect-application count. Older evidence below is historical and does not certify the restored nested-context behavior or all other affected families.

The same 138 checks and 14 full-game/checkpoint comparisons pass against independently bundled public entrypoints. A subsequent execution-lifecycle run passes all 11 cases after adding the stable-tie case. Both typechecks, lint, provenance, the 27-reference inventory reproduction, and the damage-modifier generator checks pass. Logs: `/tmp/historical-turn-{tests,built-tests,fullgames,built-games,tie,design,types,lint,generator}.log`. This is scoped evidence, not a complete-suite result.

Four skill-power candidates carry `additionalDecisions: ["C08"]` alongside C07:

- `effect_skill_add_power_40_if_first`
- `effect_skill_add_power_40_if_last`
- `effect_skill_power_2x_if_first`
- `effect_skill_power_2x_if_last`

Other referenced definitions retain their previous migration status until their own cases are accepted. The legacy `currentRoundUseSkill` API also reads the planned view; no current official YAML or parser condition entry uses that name. Trusted code reading these public views can observe the newly populated state.

## Evidence

Before C08, the expanded 2,075-check power run failed precisely four complete-game cases on the positive-application assertion; the corrected legacy implementation itself recorded zero applications. The prior kernel is pinned at `cdf6fdf4`. Hand-seeded TurnContext scenarios were insufficient to expose this defect.

After C08, all four complete-game cases pass against the rebuilt public package, including native uninterrupted and fresh-catalog JSON-restored execution. They require actual application after the checkpoint. The six additional lifecycle scenarios cover faster A, faster B, BeforeSort priority inversion, switching, a single skill and a disabled first attempt. Assertions inspect complete plans, remaining queues and dispatched attempts at the skill boundary and after the turn.

Both independent review axes approved the core change before its provenance digest was refreshed. All 9,108 V4 tests, 52 source authoring/binding tests and Node/real-Chrome host continuation pass; typechecks, declaration builds, lint and refreshed source provenance also pass. Comparisons between legacy and native effects on the corrected kernel prove agreement under C08, not equivalence with the previous kernel's always-false behavior.

## Stat-stage candidate extension

`effect_skill_reduce_opponent_spa_1_stage_if_opponent_has_kaowen_and_last` records C08 for its single `/condition/conditions/2` last-skill predicate. It retains the preceding self-use and opposing `mark_kaowen` conditions and lowers the opposing active pet's special attack one stage. The generator recursively collects all first/last nodes and rejects appended, duplicate, moved or nested nodes outside this exact mapping. Candidate tests cover admission and action timing with a seeded turn schedule and actual SkillPhase execution; per-ID full-turn/game and checkpoint acceptance remain pending.

## Hit and critical candidate extension

Five first-skill outcome candidates now pin `/condition/conditions/1` and record C08 in [their ledger](skill-outcomes-candidates.json). Their [205-check evidence](skill-outcomes.md#first-skill-extension-c08) includes 20 actual executor turns, both actor orderings and both skill/mark sources. This extends candidate evidence; complete-game/checkpoint acceptance for these five remains pending.

## Single rage action extension

Three single-vital candidates pin their first/last condition at /condition/conditions/1: effect_ability_add_rage_5_when_first_attack, effect_skill_add_rage_15_if_first, and effect_ability_reduce_opponent_rage_5_when_last_attack_opponent_has_kaowen. The last one retains its opponent-kaowen condition. Their ledger records C08 explicitly and rejects any change to the mapped condition nodes. Twelve real double-skill turns cover both actor orders and both source kinds, alongside empty/wrong/late/non-skill schedule boundaries. Full-game/checkpoint and production admission remain pending; see [single-vital evidence](vital-actions.md).
