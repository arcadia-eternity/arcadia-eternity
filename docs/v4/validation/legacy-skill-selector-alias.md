# Historical useSkillContext compatibility

Later V1 names the base selector useSkillContext; the imported baseline names the same ancestor query usingSkillContext. The source API now exposes the historical name through a getter returning the existing selector object. Both names therefore share identity, query timing and nearest-context traversal. No skillId/sourceId or other field aliases are introduced.

284 isolated source checks pass: 14 behavioral checks for object identity, direct/nested/missing ancestry, reused queries, parsed target shapes and invalid-field rejection; 270 current catalog definitions compare original-vs-imported spelling acceptance without repairing unrelated source nodes. Equality of rejection is recorded only as parser parity, not effect migration acceptance. V4 typechecking passes.

The same 284 checks now pass against independently bundled v4/v4-legacy entrypoints. Prior C07 rejection assertions now accept name-only differences while retaining rejection for explicit invalid paths. A focused run collected 17 affected files and passed 188 source/parse/mapping tests, with 9,408 unrelated cases skipped. Candidate C07 metadata remains historical bookkeeping pending catalog-wide reclassification.

Current evidence: `/tmp/historical-built-core.log` and `/tmp/historical-selector-assertions.log`. The older full-suite run still uses the previous bundle; its result cannot certify current changes. See [restoration checkpoint](historical-restoration-checkpoint.md). No full-suite success or production admission is claimed here.
