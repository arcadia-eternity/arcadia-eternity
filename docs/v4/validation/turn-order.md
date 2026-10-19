# C08: record the actual turn schedule

C08 corrects a missing domain-state update in `phase/turn.ts`. The executor sorted and dispatched phases but never populated `TurnContext.contexts`, `contextQueue` or `appledContexts`. First/last skill conditions therefore remained false in complete games, even after C07 repaired selector spelling.

## Selected behavior

The executor keeps the existing phase comparator and execution order. A scheduled entry pairs a phase with the exact context constructed for it. After sorting:

- `contexts` contains the complete plan in pop order, the reverse of dispatch order. Its first skill is the last planned skill.
- `contextQueue` initially copies the plan and loses one entry immediately before each phase dispatch.
- `appledContexts` records dispatch attempts in execution order, including the current attempt. Its first skill is the first attempted skill, including an attempt later disabled or rejected for insufficient rage.

This does not redefine first as first successful hit. Switch entries remain in all three views; skill predicates filter them out. Direct UseSkillContext → TurnContext ancestry is still required. Damage-context uses are not broadened to search ancestors. BeforeSort priority and speed determine the same order as before; stable ties and switch precedence are unchanged.

## Scope and acceptance

[Potential reference inventory](turn-order-correction.json) pins all 27 current official definitions containing first/last skill predicates, their stages, hashes and node paths. Reproduce with `node scripts/effect-migration/turn-order.mjs --check`. It is a scope inventory, not acceptance of all 27 definitions. In particular, damage-stage predicates still fail the direct-parent check.

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
