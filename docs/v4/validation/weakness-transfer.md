# Weakness-mark transfer configuration

`createWeaknessTransfer()` owns `effect_emblem_set_ruodianbiaoji_keeponswitchout`. The legacy action sets transferOnSwitch, despite the effect ID's keep-on-switch wording. The native definition retains that action through the existing AddMarkContext.setTransferOnSwitch method; it does not reinterpret it as keepOnSwitchOut.

C09 changes the nonexistent condition path `baseMarkId` to `baseMark.id`. Original parsing failure and independently repaired oracle parsing are tested. The shared ownerAddsMark condition compares applicant ownership, not recipient ownership: a matching effect can change an application onto either player's pet. Admission remains direct-context-only; an intervening EffectContext fails that condition. Late changes to the pending base do not rerun admission.

`ops.setMarkTransferOnSwitch` reads one optional boolean and applies it to the selected pending contexts, validating their battle before reading and before each write. Missing input skips; false is an explicit override. It edits the application configuration, not the BaseMark or existing MarkInstances. The authored boolean parameter `transfer` defaults to true.

Real switch tests establish that transferOnSwitch moves the created mark to the incoming pet, with stack and ownership retained. The transfer branch takes precedence even when keepOnSwitchOut is also true. Configuring transfer=false leaves a keepOnSwitchOut mark on the outgoing pet instead. These semantics reuse the current MarkSwitchOutPhase and MarkTransferPhase rather than adding a new lifecycle.

Forty repaired-oracle comparisons cover mark/skill sources, self/opponent recipients, wrong applicant/base, effect cancellation, nesting, late base changes, suppression, repetition and real switches with/without keepOnSwitchOut. Two additional cases verify the C09 parser boundary and configurable transfer disabling. Four operator checks cover one read across contexts, true/false/missing values and rejection of foreign contexts before reads or writes. Compile-only tests enforce boolean inputs and pending-application targets.

No production YAML was changed. Candidate ownership does not establish production admission or full-game/fresh-catalog snapshot acceptance.

Validation result: 46 focused checks and 589 mark-application-setting/mark-transfer regressions pass (635 unique checks) against the isolated public bundle. The initial operator fixtures incorrectly assumed empty application config; they now verify retention of the actual copied base config, including a preexisting true flag when input is absent. V4/design type checks, scoped lint, declarations, provenance and historical audit verification pass.
