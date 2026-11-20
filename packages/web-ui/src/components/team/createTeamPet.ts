import {
  isEligible,
  resolveEnvironmentMechanics,
  resolveLearnset,
} from '@arcadia-eternity/content-sdk/environment-rules'
import { individualValueSpread, defaultEditorSkillSlots, Gender, Nature } from '@arcadia-eternity/const'
import type { EnvironmentRules } from '@arcadia-eternity/protocol'
import type { PetSchemaType, SpeciesSchemaType } from '@arcadia-eternity/schema'
import { nanoid } from 'nanoid'
import i18next from 'i18next'
import { useGameDataStore } from '@/stores/gameData'

export function allowsTeamContent(
  rules: EnvironmentRules | undefined,
  kind: 'species' | 'skills' | 'marks',
  id: string,
) {
  const allowed = rules?.allow?.[kind]
  return (!allowed || allowed.includes(id)) && !rules?.deny?.[kind]?.includes(id)
}

export function startingSkills(data: ReturnType<typeof useGameDataStore>, species: SpeciesSchemaType, level: number) {
  const skills = [...resolveLearnset(data.rules, species, level).normal].filter(
    id => data.getSkill(id) && allowsTeamContent(data.rules, 'skills', id),
  )
  const slots = data.rules?.mechanics?.skillSlots ?? defaultEditorSkillSlots
  const normal = skills.filter(id => data.getSkill(id)?.category !== 'Climax')
  const climax = skills.filter(id => data.getSkill(id)?.category === 'Climax')
  return normal.slice(0, slots.normalMax).concat(climax.slice(0, slots.climaxMax))
}

export function createTeamPet(): PetSchemaType | undefined {
  const data = useGameDataStore()
  const candidates = data.speciesList.filter(species => allowsTeamContent(data.rules, 'species', species.id))
  const species = candidates.find(species => species.id === 'pet_dilante') ?? candidates[0]
  if (!species) return
  const nature =
    data.natures.find(row => row.id === Nature.Modest && row.generation === 1) ??
    data.natures.find(
      row => row.generation === 1 || isEligible(species, data.rules?.mechanics?.secondGenerationNatures),
    )
  if (!nature) return
  const { defaultValue, max } = resolveEnvironmentMechanics(data.rules).individualValues
  return {
    id: nanoid(),
    name: i18next.t(species.id + '.name', { ns: 'species', nsSeparator: false, defaultValue: species.id }),
    species: species.id,
    level: 100,
    evs: { hp: 4, atk: 0, def: 0, spa: 252, spd: 0, spe: 252 },
    ivs: individualValueSpread(defaultValue),
    ivMax: individualValueSpread(max),
    skills: startingSkills(data, species, 100),
    gender: species.genderRatio?.[1] ? Gender.Male : species.genderRatio?.[0] ? Gender.Female : Gender.NoGender,
    nature: nature.id,
    ability: species.ability.find(id => allowsTeamContent(data.rules, 'marks', id)),
    emblem: species.emblem.find(id => allowsTeamContent(data.rules, 'marks', id)),
    height: species.heightRange[0],
    weight: species.weightRange[0],
  }
}
