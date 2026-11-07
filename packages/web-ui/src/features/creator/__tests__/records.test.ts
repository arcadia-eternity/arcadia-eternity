// @vitest-environment node
import { expect, it } from 'vitest'
import type { Json } from '@arcadia-eternity/pack-loader/native'
import { selectLearnableSkills } from '../records'
it('preserves copied learning metadata and structured references when adding or removing a skill', () => {
  const original: Json[] = [
    { skill_id: 'skill_official', level: 40, hidden: true, note: 'keep' },
    { skill_id: { $ref: { id: 'strike', kind: 'skill', projectId: 'one' } }, level: 12, hidden: false },
  ]
  const changed = selectLearnableSkills(original, [
    'skill_official',
    { $ref: { projectId: 'one', kind: 'skill', id: 'strike' } },
    'skill_new',
  ])
  expect(changed).toEqual([...original, { skill_id: 'skill_new', level: 1, hidden: false }])
  expect(selectLearnableSkills(changed, ['skill_official'])).toEqual([original[0]])
})
