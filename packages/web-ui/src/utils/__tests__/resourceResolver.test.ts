import { afterEach, expect, it, vi } from 'vitest'
import { SpeciesSchema, SkillSchema, parseWithErrors } from '@arcadia-eternity/schema'
import { setServerContentText } from '@/i18n/serverContent'
import unknownPet from '@/assets/images/unknown-pet.svg'
import {
  resolveMarkIconUrl,
  resolveSkillSfxUrl,
  resolveSpeciesPortraitUrl,
  resolveSpeciesSpriteAsset,
} from '../resourceResolver'

afterEach(() => setServerContentText(null))

it('uses bundled placeholders and silence for remote same-ID content with undeclared optional media', () => {
  const species = parseWithErrors(SpeciesSchema, { id: 'pet_dilan', num: 1 })
  const skill = parseWithErrors(SkillSchema, { id: 'skill_qili' })
  setServerContentText({
    species: [species],
    skills: [skill],
    marks: [{ id: 'mark_ability_zhongjie', tags: ['ability'] }],
  })
  const localLookup = vi.fn(() => 'https://local-catalog.test/wrong.png')
  expect(resolveMarkIconUrl({ id: 'mark_ability_zhongjie', tags: ['ability'] }, localLookup)).toBe(unknownPet)
  expect(resolveSkillSfxUrl(skill, localLookup)).toBe('')
  expect(resolveSpeciesSpriteAsset(species, localLookup)).toEqual({ swfNum: 0, customImageUrl: unknownPet })
  expect(resolveSpeciesPortraitUrl(species)).toBe(unknownPet)
  expect(localLookup).not.toHaveBeenCalled()
})

it('keeps explicit server media references and local trusted/offline fallback behavior', () => {
  const species = parseWithErrors(SpeciesSchema, { id: 'pet_dilan', num: 1 })
  const skill = parseWithErrors(SkillSchema, { id: 'skill_qili' })
  const content = { species: [species], skills: [skill], marks: [] }
  setServerContentText(content)
  expect(resolveSkillSfxUrl({ ...skill, sfxRef: 'https://server.test/declared.mp3' }, vi.fn())).toBe(
    'https://server.test/declared.mp3',
  )
  expect(resolveMarkIconUrl({ id: 'mark', iconRef: 'https://server.test/declared.png' }, vi.fn())).toBe(
    'https://server.test/declared.png',
  )
  expect(
    resolveSpeciesSpriteAsset({
      ...species,
      presentation: { battle: { renderer: 'seer2-swf', source: 'https://server.test/declared.swf' } },
    }),
  ).toMatchObject({ customSwfUrl: 'https://server.test/declared.swf' })
  setServerContentText(content, false)
  expect(resolveSkillSfxUrl(skill, () => '/trusted.mp3')).toBe('/trusted.mp3')
  expect(resolveMarkIconUrl({ id: 'mark' }, () => '/trusted.png')).toBe('/trusted.png')
  expect(resolveSpeciesSpriteAsset(species)).toEqual({ swfNum: 1 })
  expect(resolveSpeciesPortraitUrl(species)).toContain('/png/pet/1.png')
})
