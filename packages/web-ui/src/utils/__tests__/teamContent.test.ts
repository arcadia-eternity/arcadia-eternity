// @vitest-environment node
import { expect, it } from 'vitest'
import { findMissingTeamContent, replaceResolvedSkills } from '../teamContent'
import type { PetSchemaType } from '@arcadia-eternity/schema'

const skills = new Map([
  ['normal', { category: 'Physical' }],
  ['other', { category: 'Special' }],
  ['climax', { category: 'Climax' }],
])
const getSkill = (id: string) => skills.get(id)
it('preserves unknown references and their order when replacing either recognized category', () => {
  const original = ['mod:missing', 'normal', 'mod:another', 'climax']
  expect(replaceResolvedSkills(original, ['other'], false, getSkill)).toEqual([
    'mod:missing',
    'other',
    'mod:another',
    'climax',
  ])
  expect(replaceResolvedSkills(original, [], true, getSkill)).toEqual(['mod:missing', 'normal', 'mod:another'])
  expect(original).toEqual(['mod:missing', 'normal', 'mod:another', 'climax'])
})
it('counts unresolved skills toward capacity instead of silently removing them', () => {
  const original = ['mod:a', 'mod:b', 'mod:c', 'mod:d', 'climax']
  expect(() => replaceResolvedSkills(original, ['normal'], false, getSkill)).toThrow('仍占用槽位')
  expect(original).toHaveLength(5)
})
it('keeps a missing skill until its definition becomes available', () => {
  const original = ['mod:missing', 'normal', 'climax']
  expect(replaceResolvedSkills(original, ['other'], false, getSkill)).toEqual(['mod:missing', 'other', 'climax'])
  const resolved = (id: string) => (id === 'mod:missing' ? { category: 'Physical' } : getSkill(id))
  expect(replaceResolvedSkills(original, ['other', 'normal'], false, resolved)).toEqual(['other', 'normal', 'climax'])
})
it('reports every missing reference with its owner and skill position without modifying the saved pet', () => {
  const pet = {
    id: 'saved-pet',
    name: '保留的精灵',
    species: 'mod:pet',
    skills: ['mod:one', 'mod:two'],
    ability: 'mod:ability',
    emblem: 'mod:emblem',
  } as PetSchemaType
  const before = structuredClone(pet)
  const lookup = { getSpecies: () => undefined, getSkill: () => undefined, getMark: () => undefined }
  const issues = findMissingTeamContent([pet], lookup)
  expect(issues).toHaveLength(5)
  expect(issues[2]).toMatchObject({
    kind: 'skill',
    contentId: 'mod:two',
    skillIndex: 1,
    namespace: 'mod',
    petId: pet.id,
  })
  expect(issues[2].message).toContain('mod:two')
  expect(findMissingTeamContent([pet], { getSpecies: () => true, getSkill: () => true, getMark: () => true })).toEqual(
    [],
  )
  expect(pet).toEqual(before)
})
