// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { Gender, Nature } from '@arcadia-eternity/const'
import { memberIssues, validateBasicTeam } from '../basicTeamValidation'

const pet = {
  id: 'a'.repeat(21),
  name: '测试精灵',
  species: 'pet_test',
  level: 100,
  evs: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
  gender: Gender.Male,
  nature: Nature.Jolly,
  skills: ['skill_test'],
  ability: 'mark_ability_test',
  emblem: 'mark_emblem_test',
}
const content = {
  getSpecies: (id: string) =>
    id === pet.species
      ? { id, learnable_skills: [{ skill_id: 'skill_test', level: 1 }], ability: [pet.ability], emblem: [pet.emblem] }
      : undefined,
  getSkill: (id: string) => id === 'skill_test',
  getMark: (id: string) => [pet.ability, pet.emblem].includes(id),
}

describe('basic friend-room team validation', () => {
  it('accepts a playable team without a competitive rule set and leaves the draft intact', () => {
    const original = structuredClone(pet)
    expect(validateBasicTeam([pet], content)).toEqual([])
    expect(pet).toEqual(original)
  })
  it('rejects empty, oversized or malformed teams', () => {
    expect(validateBasicTeam([])).not.toEqual([])
    expect(validateBasicTeam(Array.from({ length: 7 }, () => pet))).not.toEqual([])
    expect(validateBasicTeam([{ ...pet, ivs: { ...pet.ivs, hp: 99 } }])).not.toEqual([])
  })
  it('reports unknown content before a player can ready their team', () => {
    const errors = validateBasicTeam(
      [{ ...pet, species: 'pet_missing', skills: ['skill_missing'], ability: 'mark_missing' }],
      content,
    )
    expect(errors).toHaveLength(3)
  })
  it('rejects duplicate pet instance IDs within one team', () => {
    expect(validateBasicTeam([pet, { ...pet }], content)).toEqual([expect.stringContaining('编号重复')])
  })
})

it('evaluates a warehouse build independently of the minimum team size', () => {
  const environment = { ...content, rules: { schemaVersion: 2 as const, team: { minSize: 2 } } }
  expect(memberIssues(pet, environment)).toEqual([])
  expect(validateBasicTeam([pet], environment)).toEqual([expect.stringContaining('2–6')])
  const trained = { ...pet, enhancement: 'test:divine' }
  expect(memberIssues(trained, { ...environment, getEnhancement: () => undefined })).toEqual([])
  expect(trained.enhancement).toBe('test:divine')
  expect(
    memberIssues(trained, {
      ...content,
      rules: { schemaVersion: 2, mechanics: { enhancement: { mode: 'active', stages: [] } } },
    }),
  ).toContainEqual({
    objectId: pet.id,
    section: 'training',
    message: expect.stringContaining('强化阶段'),
  })
})
