# Bounded UGC condition composition

A rule's optional when accepts the original predicate invocation or a compound node:

- `{ nodeId, kind: "all", conditions: [...] }`: every child must pass, in declared order.
- `{ nodeId, kind: "any", conditions: [...] }`: stop at the first passing child.
- `{ nodeId, kind: "not", condition: ... }`: negate one child.

All/any require at least one child. Every compound and predicate leaf has a stable nodeId unique across the entire rule, including parameter, trigger, probability and action IDs. A condition tree permits depth 8 (root is depth 1) and 64 total nodes, counting compounds and leaves. Raw JSON remains bounded separately at 32 levels, 2048 visited values and 65536 text characters; raising the raw depth cap accommodates compound-array nesting without raising semantic depth.

TypeBox derives the recursive TS data shape and validates closed objects. Compilation visits all branches for identity, capability, parameter and budget validation, even when a branch would short-circuit. Predicate leaves retain their own defaults and shared parameter references. Invalid capability/reference diagnostics identify the nested leaf. Normalized trees are frozen with the compiled rule and survive JSON recompilation without renumbering identities.

During collection, leaves read their arguments only when reached. All/any short-circuit in author order; not does not convert errors into false. Conditions add no contextual guarantees. Probability rolls still occur only after the whole condition passes. Action-time reads remain independent.

The [compound healing example](../examples/ugc-conditional-healing.json) heals one quarter maximum HP when current HP is at least 10% and below 50%. Its actual Battle test checks both boundaries and interior/exterior cases. Other tests verify nested short-circuit order, all-branch validation, defaults/references, duplicate IDs, malformed nodes and exact depth/size limits. Existing single-predicate content remains valid; TS consumers of the normalized union now narrow with `id in condition` before accessing leaf params.

Standards review found no actionable defects. This implements condition composition, not template expansion, general value expressions, editor integration or the final manifest policy. The full migration and #218 structural pack-level gates remain open.
