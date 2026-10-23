# Native TypeScript source authority

The reviewed issue #206 requires TypeScript to own behavior after conversion and forbids a later migration rerun from overwriting manual repairs. All eight generators that emit native TS now use `writeMigrationArtifact`. Their shared sequence emitter also covers its mechanism-specific callers.

A migration command may create a missing TS file once. Existing identical TS is left untouched; different TS causes an error before its paired ledger is written. Exclusive first creation (`wx`) also refuses to replace a file created after the initial read. There is no force-overwrite option. Behavior changes use explicit source edits and review. Metadata-only reports can still be regenerated. `--check` remains a read-only reproducibility check, and reports source/template drift rather than repairing it.

Four regressions verify initial creation, manual and empty-file preservation, missing/drifting check-mode rejection, metadata generation, and an actual skill-power command rerun in an isolated fixture. That command encounters a reviewed TS edit, exits with failure, and leaves both the source and paired ledger unchanged. The complete offline migration suite passes 196 cases. Independent Standards and Spec reviews report zero findings, each separately rerunning all four protection checks.

This only changes offline migration tools. It adds no runtime parser or DSL dependency and does not change the fixed native build used by the complete battle regression.
