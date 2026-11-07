import { expect, it } from 'vitest'
import { createContentIndex, codeEffectDefinition } from '../../v4'

const skill = { id: 'strike', element: 'Normal', category: 'Physical', power: 30, rage: 0, accuracy: 100 }
const definition = {
  ...codeEffectDefinition({ id: 'effects:hit', sourceKind: 'skill' }),
  parameters: { amount: { kind: 'number' as const, default: 5, minimum: 0 } },
}
function data() {
  return {
    marks: [{ id: 'ability' }],
    skills: [{ ...skill, behaviors: [{ useId: 'hit', definitionId: definition.id, params: { amount: 3 } }] }],
    species: [
      {
        id: 'pet',
        num: 1,
        element: 'Normal',
        baseStats: { hp: 100, atk: 100, spa: 100, def: 100, spd: 100, spe: 100 },
        genderRatio: null,
        heightRange: [1, 2],
        weightRange: [1, 2],
        learnable_skills: [{ skill_id: 'strike', level: 1, hidden: false }],
        ability: ['ability'],
        emblem: [],
      },
    ],
    behaviors: [definition],
  }
}
it('validates and indexes copied data without executable exports or domain objects', () => {
  const input = data(),
    index = createContentIndex(input, 'metadata')
  input.skills[0].power = 99
  expect(index.getSkill('strike').power).toBe(30)
  expect(index.getSpecies('pet').ability).toEqual(['ability'])
  expect(Object.isFrozen(index.getSkill('strike').behaviors)).toBe(true)
  expect(index.effectIds).toHaveLength(1)
  expect(index).not.toHaveProperty('createBattle')
  expect(index).not.toHaveProperty('parsePlayers')
})
it('retains schema, duplicate, and species reference checks', () => {
  const input = data()
  expect(() => createContentIndex({ ...input, skills: [skill, skill] }, 'invalid')).toThrow('Duplicate')
  expect(() => createContentIndex({ ...input, skills: [{ ...skill, power: -1 }] }, 'invalid')).toThrow()
  expect(() => createContentIndex({ ...input, marks: [] }, 'invalid')).toThrow('Unknown content mark')
  expect(() => createContentIndex({ ...input, skills: [] }, 'invalid')).toThrow('Unknown content skill')
})
it('retains behavior parameter, owner and content reference checks without calling builders', () => {
  const input = data()
  input.skills[0].behaviors[0].params.amount = -1
  expect(() => createContentIndex(input, 'invalid')).toThrow()
  expect(() =>
    createContentIndex({ ...data(), behaviors: [{ ...definition, sourceKind: 'petMark' }] }, 'invalid'),
  ).toThrow('owner/source')
  expect(() => createContentIndex({ ...data(), behaviors: [] }, 'invalid')).toThrow('unknown behavior')
  expect(() => createContentIndex({ ...data(), behaviors: [definition, definition] }, 'invalid')).toThrow(
    'duplicate behavior',
  )
})
it('accepts declared legacy effects and rejects unlisted or directly attached behavior IDs', () => {
  const input = { ...data(), skills: [{ ...skill, effect: ['official/hit'] }] }
  expect(() => createContentIndex(input, 'valid', { effectIds: ['official/hit'] })).not.toThrow()
  expect(() => createContentIndex(input, 'invalid')).toThrow('official/hit')
  const declared = data(),
    id = createContentIndex(declared, 'metadata').effectIds[0]
  expect(() =>
    createContentIndex({ ...declared, skills: [{ ...declared.skills[0], effect: [id] }] }, 'invalid', {
      effectIds: [id],
    }),
  ).toThrow('directly referenced')
})
it('checks known host template contracts statically while deferring unknown code exports', () => {
  const input = data()
  const template = { ...definition, id: 'official/template' }
  expect(() => createContentIndex(input, 'valid', { templates: [template] })).not.toThrow()
  expect(() => createContentIndex(input, 'invalid', { templates: [{ ...template, parameters: {} }] })).toThrow(
    'public contract',
  )
  expect(() => createContentIndex(input, 'invalid', { templates: [{ ...template, sourceKind: 'petMark' }] })).toThrow(
    'source mismatch',
  )
})
