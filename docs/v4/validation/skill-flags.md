# Persistent skill flags

Six current `OnBattleStart` definitions compile to shared `targets.selfSkills` queries and `ops.setSkillSureHit`. Source hashes and exact accepted shapes are recorded in `skill-flags-candidates.json`; three other setValue definitions remain rejected and the authored rebirth assignment retains its existing ownership.

This assigns `SkillInstance.sureHit`, not a one-use hit override or a source-bound attribute modifier. BaseSkill is unchanged. Existing UseSkillContext instances retain their constructor-time value; newly constructed contexts observe the assignment. Suppression/removal of the source does not revert it. Snapshot serialization already preserves this instance field; the core change only makes its existing mutability explicit in TypeScript.

Selection occurs on each action execution, including after BeforeEffect hooks change source ownership or skill membership. Added skills are unchanged until the effect executes again. Value input is read once for the selected collection, missing values skip assignment, and targets are validated both before and after the read.

The legacy whereAttr normalizes an array into evaluator inputs; notSame compares the first input. Thus multihit 1, [1,1], and [1,2] are excluded, while 2 and [2,3] match. The shared generator preserves this rule explicitly. An initial strict array-vs-number translation failed six differential cases and was corrected before acceptance.

Validation: 91 public cases cover six IDs, mark/skill sources, cancellation, repetition, empty selection, late ownership/membership, literal expected results, context read timing, source removal, fresh-catalog JSON restoration, and later-added skills. Two additional runtime checks cover once-only input reads, false assignment, missing values and foreign ownership before/after reads. Generator reproduction and type assertions cover the supported shapes and reject context targets/numeric flags.

Status: candidates only. Full-game acceptance, dependency closure and production registration remain pending.
