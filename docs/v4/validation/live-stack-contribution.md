# Live stack-based crit contribution

The remaining independent attribute contribution now has a native candidate, bringing that ledger to 21 generated / 0 rejected. Source YAML and its hash are unchanged; no correction decision is applied. The candidate remains U pending complete-game and production admission.

## Semantics and API

The source's `selectAttribute$('stack')` passes a live source into the modifier. Its multiply operand is read when that source is constructed. The authored equivalent explicitly captures source-mark identity, follows its stack, and captures the configured multiplier once per installation. Products use `Math.floor`, including negative and fractional factors.

`bindings.combine(left, right, project)` preserves each input's temporal policy and optionality. It reuses the low-level plan combinator: both siblings are evaluated when an ordinary input faults, structural dependencies remain tracked, and corrupt restored capture state takes priority over ordinary evaluation errors. Execution-budget errors retain the low-level immediate-abort behavior. Type assertions reject immediate values and non-scalar projections.

`bindAttribute({ stacking: 'append', ... })` installs independent contributions, each with its own capture state. The existing default replacement identity is unchanged. Removing the source mark disposes every contribution; suppression temporarily removes their effect. Shared sequence emission derives binding keys from action paths, avoiding collisions between separate live actions.

## Evidence

- Seven focused public cases cover four independent legacy differential traces (positive, fractional, negative and zero factors), full JSON snapshot restoration with a fresh effect factory, combined-plan dependency/error recovery, and unchanged source identity/hash.
- The differential trace changes stack, changes configuration without reinstalling, installs again, changes stack again, suppresses/restores the source, then removes it. Both the legacy comparison and independent numeric assertions pass.
- Snapshot restoration preserves two separately captured factors (3.5 and 7) despite later configuration changes. After restoration, changing stack updates both; removing the source returns the stat to baseline.
- Left-input faults do not lose right-input dependencies. A later right-side change restores the contribution. Missing right capture state is rejected even while the left input has an ordinary fault.
- The complete scoped run has 415 public passes: seven focused cases, 394 static-contribution regressions and 14 authoring snapshot regressions. Generator tests: 150 passed; design tests: 75 passed. Scoped types/lint, declaration build and unchanged V1 provenance pass. Both review axes pass.
- An initial snapshot fixture omitted original base-skill effects from its catalog; that fixture was corrected before the final run. Test-only unknown recipe fields were validated before access. No broad repository-wide or full-game claim is made.

Logs: `/tmp/live-stack-tests-final-verified.log`, `/tmp/live-stack-generators-verified.log`, `/tmp/live-stack-types-complete.log`, `/tmp/live-stack-lint-verified.log`, `/tmp/live-stack-design-verified.log`, `/tmp/live-stack-declarations-final.log`, `/tmp/live-stack-provenance-final.log`.
