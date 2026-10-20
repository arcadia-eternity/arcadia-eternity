# Skill-use shield bypass

`effect_skill_ignore_opponent_shield_if_has_shunliu` now has a generated native candidate. It uses the shared `conditions.selfUsesSkill`, owner-mark query, and `contexts.skillUse.apply(ops.setIgnoreShield())`. The operation changes each selected use context, leaving the persistent skill default unchanged. It validates all selected contexts before writing, so a foreign context cannot cause a partial local update.

The reference is unchanged current YAML parsed through the restored historical `setIgnoreShield` operation and `useSkillContext` alias. The candidate ledger treats this selector spelling as historical compatibility, not a C07 source correction. Source hashes and generator checks pin the definition. This restoration does not resolve the separate rage, turn-order or hit-ordinal baseline discrepancies.

Seven source-import tests pass. Five compare native and legacy execution through `SkillPhase`, asserting actual HP loss and shield-stack consumption: support absent, present, removed by BeforeEffect after condition admission, effect cancellation, and a second use after support removal. The sixth rejects a mixed local/foreign context selection before either flag changes. The seventh serializes a selection-boundary snapshot through JSON, restores with a fresh native-effect catalog, and verifies that removing the restored support mark changes the next use without changing the skill default. The skill fixture uses a low-power physical move; a status move would not exercise shield damage.

The authoring typecheck accepts use-context targets and rejects skill-instance targets. V4 typechecking, lint, and the existing 87 authoring/value-binding tests pass. All 185 generator tests pass, including three covering this candidate's reproduction, both selector spellings, and rejection of unsupported inputs.

The seven checks also pass against independently bundled public entrypoints; see the [restoration checkpoint](historical-restoration-checkpoint.md). Status: candidate only. Full-game acceptance and production registration remain pending.
