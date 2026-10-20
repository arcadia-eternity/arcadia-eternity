# Rage assignment candidates

Four unchanged definitions now compile through `ops.setRage`: clearing rage at turn start, clearing on switch-out, keeping at least 25 rage, and copying the owner's rage to the opposing player.

The operation reads its numeric input once, then executes a `RagePhase` with reason `effect` and mode `setting` for every selected Pet or Player. This preserves the restored historical operator's clamping, fractional inputs, duplicate-target execution, and `RageChange` messages. It does not substitute a direct `settingRage` call. Missing input performs no assignment. Shared numeric-operation validation checks ownership and finite values before execution and rechecks each target after callbacks.

The generator uses the shared owner/context conditions and player-value queries. Switch-out selects the switch condition domain explicitly. The dynamic copied value remains a deferred query; it is read after BeforeEffect hooks, once for the operation, rather than when the native definition is constructed.

45 source-import tests pass: 40 native/unchanged-YAML comparisons cover all four IDs with skill and mark sources, normal and threshold values, bench ownership, cancellation, and late value changes. They compare both final rage and message traces and assert expected writes independently. Four operator comparisons cover clamping, fractional values, and duplicate targets. One read-timing test changes the input source in the first phase's message callback and verifies both targets still receive the single sampled value; missing input emits no extra messages.

These comparisons use the restored historical assignment operator. The subsequent lifecycle restoration is covered by `historical-rage-lifecycle.test.ts`: a real loss settles 40 to 10 and the minimum-rage effect then assigns 25, with the nested assignment message emitted before the outer loss message. The working rage function is pinned to the later V1 body. Broader affected-family and public-build validation remain open; direct OnBattleStart comparisons alone are not used as proof of loss behavior.

All 188 generator tests pass, including exact reproduction of these four candidates, switch-domain selection, and rejection of unsupported targets and trigger lists. Authoring type assertions accept Pet/Player selections and reject SkillInstance assignment.

The 45 checks also pass against independently bundled public entrypoints; see the [restoration checkpoint](historical-restoration-checkpoint.md) for the completed affected-family source regression. Status: candidates only. Fresh-catalog snapshot/full-game acceptance, complete-suite validation and production registration remain pending.
