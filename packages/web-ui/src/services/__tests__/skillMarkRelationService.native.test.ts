// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import YAML from 'yaml'
import type { Effect, MarkSchemaType, SkillSchemaType } from '@arcadia-eternity/schema'
import { officialEffectMarkRelations } from '../../../../../packs/base/src/effect-mark-relations'
import { SkillMarkRelationService } from '../skillMarkRelationService'

const base = new URL('../../../../../packs/base/', import.meta.url)
const legacy = new URL('../../../../../packages/battle/test/v4/fixtures/effect-regression/', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('pack.json', base), 'utf8')) as {
  data: Record<'marks' | 'skills', string[]>
}
const read = <T>(root: URL, file: string): T[] => YAML.parse(readFileSync(new URL(file, root), 'utf8'), { merge: true })
const index = <T extends { id: string }>(rows: T[]): Record<string, T> =>
  Object.fromEntries(rows.map(row => [row.id, row]))
const marks = index(manifest.data.marks.flatMap(file => read<MarkSchemaType>(base, `data/${file}`)))
const skills = index(manifest.data.skills.flatMap(file => read<SkillSchemaType>(base, `data/${file}`)))
const effects = index(
  ['ability', 'emblem', 'global', 'mark', 'skill'].flatMap(kind => read<Effect>(legacy, `effect_${kind}.yaml`)),
)

describe('native effect presentation relations', () => {
  it('preserves related marks for every existing skill without loading editable effect definitions', () => {
    const previous = new SkillMarkRelationService(skills, marks, effects)
    const native = new SkillMarkRelationService(skills, marks, {}, officialEffectMarkRelations)
    for (const skillId of Object.keys(skills)) {
      expect(native.analyzeSkillMarkRelations(skillId), skillId).toEqual(previous.analyzeSkillMarkRelations(skillId))
    }
    expect(native.analyzeSkillMarkRelations('skill_shuiwenpingzhang').relatedMarks).toContainEqual(
      expect.objectContaining({ markId: 'mark_shuiwenpingzhang', relationType: 'adds' }),
    )
    expect(native.analyzeMarkSkillRelations('mark_shuiwenpingzhang')).toEqual(
      previous.analyzeMarkSkillRelations('mark_shuiwenpingzhang'),
    )
  })

  it('uses current mark presence and editable effect overrides when supplied', () => {
    const omittedMarks = { ...marks }
    delete omittedMarks.mark_shuiwenpingzhang
    const native = new SkillMarkRelationService(skills, omittedMarks, {}, officialEffectMarkRelations)
    expect(native.analyzeSkillMarkRelations('skill_shuiwenpingzhang').relatedMarks).not.toContainEqual(
      expect.objectContaining({ markId: 'mark_shuiwenpingzhang' }),
    )
    const overrides = Object.fromEntries(
      (skills.skill_shuiwenpingzhang.effect ?? []).map(id => [id, { ...effects[id], apply: [] }]),
    ) as Record<string, Effect>
    native.updateData(skills, marks, overrides)
    expect(native.analyzeSkillMarkRelations('skill_shuiwenpingzhang').relatedMarks).toEqual([])
  })
})
