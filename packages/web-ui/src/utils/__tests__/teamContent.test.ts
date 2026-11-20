// @vitest-environment node
import { expect, it } from 'vitest'
import { findMissingTeamContent, teamSkillGroups } from '../teamContent'
import type { PetSchemaType } from '@arcadia-eternity/schema'

const skills = new Map([
  ['normal', { category: 'Physical' }],
  ['other', { category: 'Special' }],
  ['climax', { category: 'Climax' }],
])
const getSkill = (id: string) => skills.get(id)
it('retains the saved slot positions when a definition disappears and resolves the same slots when it returns', () => {
  const original = ['normal', 'mod:missing', 'climax', 'other']
  const groups = teamSkillGroups(original, { normalMax: 1, climaxMax: 2 }, getSkill)
  expect(groups[0].slots.map(s => [s.position, s.id, s.category])).toEqual([
    [0, 'normal', 'normal'],
    [1, 'mod:missing', 'missing'],
    [2, 'climax', 'climax'],
    [3, 'other', 'normal'],
  ])
  expect(groups[0].slots[3].overflow).toBe(true)
  expect(groups[1].slots[0]).toMatchObject({ position: 4, category: 'climax', id: '' })
  const restored = teamSkillGroups(original, undefined, id =>
    id === 'mod:missing' ? { category: 'Climax' } : getSkill(id),
  )
  expect(restored[1].slots.map(s => s.position)).toEqual([1, 2, 4])
  expect(original).toEqual(['normal', 'mod:missing', 'climax', 'other'])
})

it('keeps both append choices for a free unreserved slot and none when unresolved moves fill the team member', () => {
  const chosen = ['normal', 'other', 'climax', 'missing']
  const emptySlots = (ids: string[]) =>
    teamSkillGroups(ids, undefined, getSkill).flatMap(group => group.slots.filter(slot => !slot.id))
  expect(emptySlots(chosen).map(slot => slot.category)).toEqual(['normal', 'climax'])
  expect(emptySlots([...chosen, 'another'])).toEqual([])
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

it('retains unresolved inherited skills, community natures and stages as distinct build choices', () => {
  const pet = {
    id: 'one',
    name: '一号',
    species: 'pet_x',
    skills: [],
    inheritedSkill: 'mod:heal',
    enhancement: 'mod:stage',
    nature: 'mod:nature',
  } as unknown as PetSchemaType
  const missing = findMissingTeamContent([pet], {
    getSpecies: () => true,
    getMark: () => true,
    getSkill: () => undefined,
    getNature: () => undefined,
    getEnhancement: () => undefined,
  })
  expect(missing.map(row => [row.kind, row.contentId])).toEqual([
    ['inheritedSkill', 'mod:heal'],
    ['nature', 'mod:nature'],
    ['enhancement', 'mod:stage'],
  ])
})
