# Skill hit and critical outcome operators

The shared authored API now exposes `addAccuracy`, `setAccuracy`, `addCritRate`, `setSureHit`, `setSureMiss`, `setSureCrit` and `setSureNoCrit`. This runtime seam precedes conversion of the 65 current single-action definitions; it registers no official Effect IDs.

Accuracy reads its input once per invocation, including an empty target list, then consumes only the first value for all selected contexts. Empty input skips writes. Critical rate reads separately for each selected context and applies every value in order, preserving clamping after each update. The existing power helper now has a name reflecting its shared use; power behavior is unchanged.

Override operators append to the existing skill context arrays. Defaults remain 0 for hit/critical and -1 for miss/no-critical. The context chooses the greatest priority and the last entry on a tie. Overrides bypass only their corresponding random roll; numeric changes continue to use ordinary hit/critical resolution. Priorities must be finite and foreign battle contexts are rejected.

All 136 dedicated public-artifact tests pass. Legacy-parser fixtures compare all seven operations with skill and mark sources, normal/nested/missing context, late values, empty input, cancellation and competing/tied priorities. Independent assertions pin numeric results, defaults, last-writer tie behavior, query counts for two/zero targets, per-update clamping, cross-battle rejection and exact subsequent RNG state. The RNG fixture uses a publicly constructed non-guaranteed skill: the generic scenario's built-in sure-hit flag would otherwise suppress the roll under test. No private field overrides are used.

The four-suite public integration run passes 221 tests. All 69 authoring design tests, V4 typechecking, lint, declarations and source provenance pass. Both review axes approve the runtime seam. Candidate generation, per-ID behavior, full-game/checkpoint acceptance and production registration remain pending.

Next source inventory: 26 setSureHit, seven setSureMiss, nine setSureCrit, 18 addCritRate and five addAccuracy definitions. Stages are BeforeUseSkillCheck (six), AfterUseSkillCheck (55) and BeforeHit (four). Correcting selector spelling, mapping defensive conditions, preserving automatic stack consumption, and explicitly recording any turn-order or malformed attribute paths belong to the per-ID conversion step.
