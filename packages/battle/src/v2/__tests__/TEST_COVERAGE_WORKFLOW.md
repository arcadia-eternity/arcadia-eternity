# Skill/Mark Coverage Workflow

## Goal

Every base skill and base mark should have at least one dedicated unit/regression test.

## Infrastructure

- Coverage manifest:
  - `helpers/coverage-manifest.ts`
- Coverage contract test:
  - `v2-skill-mark-coverage.contract.test.ts`

## How to add coverage for a new case

1. Add or extend a test in existing regression files (or create a new one).
2. Add the covered `skillId` / `markId` in `helpers/coverage-manifest.ts` with a short case note.
3. Run:
   - `pnpm --filter @arcadia-eternity/battle run test:run -- v2-skill-mark-coverage.contract.test.ts`

## Strict mode

Set env:

```bash
STRICT_SKILL_MARK_COVERAGE=true
```

In strict mode, contract test fails if any skill/mark is not listed in manifest.
