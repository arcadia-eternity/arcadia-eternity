# Native mark and stat-stage transfers

Three candidates use shared authoring operations and compare against unchanged YAML: transfer negative stages, transfer status-tagged marks, and transfer the source mark then increment its stack. No source correction is recorded.

`ops.transferMarks` queries the mark list once and transfers to the first selected pet through Pet.transferMarks and MarkTransferPhase. The phase now explicitly accepts EffectContext as well as SwitchPetContext, replacing the legacy cast without changing dispatch or stacking behavior. Target and source ownership are validated before mutation. The existing phase handles detach, target collisions and MarkStackPhase.

`ops.transferStatStages` reads one source pet and uses the existing getClearableStatStageMarks iterator. It visits stats in atk/def/spa/spd/spe order, samples each stat's members when reached, and tests their current levels before transfer. Each destination addition goes through addStatStage, followed by source removal through the normal lifecycle. Callback changes to a later stage can affect whether it is transferred. No mark list is captured across separate actions.

## Observable historical behavior

- Cancelling a destination stage addition does not prevent removal of the source stage.
- When a transferred source mark collides with an existing destination mark, the source object detaches and the existing mark stacks. The following addStacks action still addresses the original source mark identity. It does not retarget the stacked destination mark.
- The defensive transfer condition uses the direct skill event's actual target. Nested effect contexts do not satisfy it.
- A status transfer queries the current owner marks and preserves non-status marks. Late active-slot changes affect the target queried when execution starts.

These are explicit parity assertions, not implicit approval of every design choice. Future changes to collision identity or cancellation atomicity need a separate semantic decision.

## Evidence and scope

Sixty focused cases cover three definitions, skill/mark sources, existing target entries, repeat execution, whole-effect cancellation, destination-add cancellation, wrong ownership, nested context, late slot replacement, later-stage mutation and source suppression. Comparisons include ordered lifecycle traces, stage levels, underlying pet stats, mark membership, detached source identity, stack state and subsequent RNG. Independent assertions verify the default transfer, cancellation and collision outcomes.

Fixtures exercise the real transfer, stack, stage-add and removal machinery with controlled status mark definitions. Arbitrary downstream status-mark behavior, cross-catalog full-game restoration and production admission remain separate acceptance work. The new ledger records candidate ownership only.

Validation: the independent public build passed all 892 cases across transfer, mark-removal, stat-stage-sequence and snapshot suites. The expanded transfer suite then passed 62 cases, including two atomic cross-battle rejection checks. TypeScript checks, V4 lint, declaration generation, provenance and historical audit passed. Candidate coverage is 1,024/1,065.
