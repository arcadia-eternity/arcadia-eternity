# Restore historical setIgnoreShield

Reference: `61c349fa7ca35c392b0e751c9238759b02aefcb3`. Restored UseSkillContext.setIgnoreShield, the historical operator body, DSL type, schema branch and parser dispatch. This sets the selected use contexts' ignoreShield flag; it does not change SkillInstance defaults. The existing skill phase already forwards that flag to damage.

Six source and independently bundled-entrypoint checks pass: the unchanged official shunliu definition with present/absent support and matching/nonmatching actor ownership; all selected contexts updated while a fresh context retains the skill default; and an exact whitespace-normalized historical operator digest. These run alongside 284 selector-name checks. Typechecking passes.

Oracle restoration alone does not establish native migration. The subsequent [native candidate](ignore-shield.md) adds seven checks for actual damage/shield behavior, cancellation, later use, cross-battle validation and fresh-catalog snapshot restoration. Full-game and production admission remain pending.
