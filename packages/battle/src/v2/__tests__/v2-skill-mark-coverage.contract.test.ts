import { beforeAll, describe, expect, test } from 'vitest'
import type { V2DataRepository } from '../data/v2-data-repository.js'
import { getTestRepository } from './helpers/regression-helpers.js'
import { v2CoverageManifest } from './helpers/coverage-manifest.js'

let repo: V2DataRepository

beforeAll(async () => {
  repo = await getTestRepository()
})

function diffIds(all: string[], covered: Record<string, string[]>): string[] {
  return all.filter(id => !covered[id])
}

describe('v2 skill/mark test coverage contract', () => {
  test('reports missing skill/mark test coverage', () => {
    const allSkillIds = [...repo.allSkills()].map(s => s.id).sort()
    const allMarkIds = [...repo.allMarks()].map(m => m.id).sort()
    const missingSkills = diffIds(allSkillIds, v2CoverageManifest.skills)
    const missingMarks = diffIds(allMarkIds, v2CoverageManifest.marks)

    const strict = process.env.STRICT_SKILL_MARK_COVERAGE === 'true'
    if (strict) {
      expect(
        { missingSkills, missingMarks },
        `Missing skill cases: ${missingSkills.slice(0, 20).join(', ')}; missing mark cases: ${missingMarks.slice(0, 20).join(', ')}`,
      ).toEqual({ missingSkills: [], missingMarks: [] })
      return
    }

    // Non-strict mode: contract infrastructure is active, but does not block CI yet.
    // This keeps migration incremental while making gaps visible.
    if (missingSkills.length > 0 || missingMarks.length > 0) {
      console.warn(
        `[coverage-contract] missing skill cases=${missingSkills.length}, missing mark cases=${missingMarks.length}`,
      )
    }

    expect(allSkillIds.length).toBeGreaterThan(0)
    expect(allMarkIds.length).toBeGreaterThan(0)
  })
})

