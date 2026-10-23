# Native TypeScript source authority

Reviewed TypeScript in `packs/base/src/effects/` owns official behavior. The completed DSL conversion generators and their dedicated tests have been removed. Edit the native source directly and validate the affected behavior through the V4 regression suite.

Species, Skill and Mark metadata remain editable YAML selected by the base pack manifest. The reusable content-structure tool inventories references and reorganizes explicitly owned metadata without regenerating behavior. See [content structure](../content-structure.md).

Fixed candidate records and historical YAML fixtures remain test inputs for differential behavior, parameter, lifecycle and restoration checks. They are not inputs to the production native catalog or a source from which to overwrite maintained TypeScript.

Before removal, the offline generators rejected attempts to overwrite manually repaired TypeScript. That protection was verified by initial-creation, preservation and command-level regressions. With the generators removed, native source edits and their behavior checks form the ongoing maintenance workflow.
