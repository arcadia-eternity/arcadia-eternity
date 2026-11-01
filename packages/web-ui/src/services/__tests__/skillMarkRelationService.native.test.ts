// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'
import type { MarkSchemaType, SkillSchemaType } from '@arcadia-eternity/schema'
import { officialEffectMarkRelations } from '../../../../../packs/base/src/effect-mark-relations'
import { SkillMarkRelationService } from '../skillMarkRelationService'

const base = new URL('../../../../../packs/base/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('pack.json', base), 'utf8')) as {
  data: Record<'marks' | 'skills', string[]>
}
const read = <T>(file: string): T[] => YAML.parse(readFileSync(new URL(file, base), 'utf8'), { merge: true })
const index = <T extends { id: string }>(rows: T[]): Record<string, T> =>
  Object.fromEntries(rows.map(row => [row.id, row]))
const marks = index(manifest.data.marks.flatMap(file => read<MarkSchemaType>(`data/${file}`)))
const skills = index(manifest.data.skills.flatMap(file => read<SkillSchemaType>(`data/${file}`)))

describe('native effect presentation relations', () => {
  it('resolves current skill and reverse mark relations without executable effect definitions', () => {
    const service = new SkillMarkRelationService(skills, marks, officialEffectMarkRelations)
    for (const skillId of Object.keys(skills)) {
      const analysis = service.analyzeSkillMarkRelations(skillId)
      expect(analysis.totalRelations).toBe(analysis.relatedMarks.length)
      for (const relation of analysis.relatedMarks)
        if (relation.markId !== 'unknown') expect(marks[relation.markId], relation.markId).toBeDefined()
    }
    expect(service.analyzeSkillMarkRelations('skill_shuiwenpingzhang').relatedMarks).toContainEqual(
      expect.objectContaining({ markId: 'mark_shuiwenpingzhang', relationType: 'adds' }),
    )
    expect(service.analyzeMarkSkillRelations('mark_shuiwenpingzhang')).toContain('skill_shuiwenpingzhang')
  })

  it('refreshes cached relations when the available marks or native relation metadata change', () => {
    const service = new SkillMarkRelationService(skills, marks, officialEffectMarkRelations)
    expect(service.analyzeSkillMarkRelations('skill_shuiwenpingzhang').relatedMarks.length).toBeGreaterThan(0)
    const omitted = { ...marks }
    delete omitted.mark_shuiwenpingzhang
    service.updateData(skills, omitted)
    expect(service.analyzeSkillMarkRelations('skill_shuiwenpingzhang').relatedMarks).not.toContainEqual(
      expect.objectContaining({ markId: 'mark_shuiwenpingzhang' }),
    )
    service.updateData(skills, marks, {})
    expect(service.analyzeSkillMarkRelations('skill_shuiwenpingzhang').relatedMarks).toEqual([])
  })
})
