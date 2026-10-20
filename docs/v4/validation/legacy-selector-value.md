# Historical selectorValue compatibility

Later V1 (`61c349fa7ca35c392b0e751c9238759b02aefcb3`) uses `selectorValue` in its DSL and recognizes it in both parseSelector and parseValue. The imported baseline uses `selector`. Both spellings now share the same schema and execution paths. Unknown near-spellings still fail validation. This is an oracle compatibility restoration, not a new interpretation of official effect data.

The parser still evaluates the value-backed selector when invoked; it does not cache its selected value at parse time. Seven focused tests cover both spellings in value and dynamic-selector positions, nested action-time player rage queries, and unknown-tag rejection.

The random-damage, random-mark and random-stat references now use the original YAML value tag. The random-damage full-game/checkpoint references likewise remove the tag adapter. Earlier C10/C14 metadata remains in candidate ledgers as historical migration bookkeeping pending catalog-wide reclassification; tests no longer treat rejection of valid historical syntax as acceptance evidence.

C07 is separate: it renames useSkillContext to usingSkillContext. Later V1 declares useSkillContext; restoring that selector spelling and revisiting its rejection assertions is the next compatibility step. It must not be conflated with selectorValue/C10.

Production YAML and candidate code are unchanged. Candidate coverage does not increase merely because more definitions can be parsed.

Focused validation: 720 distinct tests pass across historical value syntax, random damage, random mark application and stat-stage sequences. The combined run passed 719 and hit one default 5-second timeout; rerunning that exact late-owner case independently passed in 88 ms with a 30-second limit. V4 typechecking, lint and declaration build pass. Complete V4 regression is recorded separately and must not be inferred from this scoped result.

Four random-damage full-game/fresh-catalog checkpoint comparisons also pass using unchanged YAML. At this checkpoint the complete V4 run remains active; its final result has not been accepted. Evidence logs: `/tmp/selector-value-focused.log`, `/tmp/selector-value-timeout-recheck.log`, `/tmp/selector-value-games.log`, and `/tmp/selector-value-suite.log`.
