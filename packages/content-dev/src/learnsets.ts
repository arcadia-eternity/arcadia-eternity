import {
  defaultLearnsetLevel,
  supportsEnhancementBranch,
  assertSkillSlots,
  resolveEnvironmentMechanics,
  type EnvironmentRules,
} from '@arcadia-eternity/const'
import { z } from 'zod'

const id = z.string().min(1).max(256)
export interface LearnsetSpecies {
  id: string
  learnable_skills: readonly { skill_id: string; level: number }[]
  enhancementBranches?: readonly string[]
  ability?: readonly (string | { id: string })[]
  emblem?: readonly (string | { id: string })[]
  inheritance?: { skills: string[] }
}
type LearningRules = Pick<EnvironmentRules, 'mechanics' | 'learnsetAdjustments'>
type Eligibility = NonNullable<EnvironmentRules['mechanics']>['secondGenerationNatures']
export function isEligible(species: Pick<LearnsetSpecies, 'id' | 'inheritance'>, selection?: Eligibility) {
  return (
    selection === 'all' ||
    (selection === 'species' && species.inheritance !== undefined) ||
    (Array.isArray(selection) && selection.includes(species.id))
  )
}

/** Static acquisition sources. Choosing an inherited skill does not create an equipment slot. */
export function resolveLearnset(rules: LearningRules | undefined, species: LearnsetSpecies, level: number) {
  const normal = new Set(species.learnable_skills.filter(entry => entry.level <= level).map(entry => entry.skill_id))
  const { inheritance } = resolveEnvironmentMechanics(rules)
  const eligible = isEligible(species, inheritance.eligible)
  const inherited = new Set(species.inheritance?.skills)
  const pool = inheritance.pool
  if (pool && (pool.mode !== 'fallback' || !inherited.size)) {
    if (pool.mode === 'replace') inherited.clear()
    for (const skill of pool.skills) inherited.add(skill)
  }
  for (const row of rules?.learnsetAdjustments ?? []) {
    if (row.species !== species.id) continue
    const source = row.source === 'normal' ? normal : inherited
    if (row.action === 'remove') source.delete(row.skill)
    else if ((row.level ?? defaultLearnsetLevel) <= level) source.add(row.skill)
  }
  if (!eligible) inherited.clear()
  return { normal, inherited, eligible }
}

export function learningIssues(
  rules: LearningRules | undefined,
  species: LearnsetSpecies,
  pet: { level: number; inheritedSkill?: string; skills: string[] },
) {
  const { normal, inherited } = resolveLearnset(rules, species, pet.level)
  const issues: string[] = []
  if (pet.inheritedSkill && !inherited.has(pet.inheritedSkill)) issues.push('该精灵无法遗传 ' + pet.inheritedSkill)
  for (const skill of pet.skills)
    if (!normal.has(skill) && !(pet.inheritedSkill === skill && inherited.has(skill)))
      issues.push('该精灵不能学习 ' + skill)
  return issues
}

/** Called only with the definitions captured for this environment. */
export function validateLearningReferences(
  rules: LearningRules | undefined,
  knownSpecies: (id: string) => boolean,
  knownSkill: (id: string) => boolean,
  knownStage: (id: string) => boolean,
) {
  const check = (kind: string, value: string, exists: (id: string) => boolean) => {
    if (!exists(value)) throw new Error(`ENVIRONMENT_REFERENCE_MISSING: ${kind} ${value}`)
  }
  const enhancement = rules?.mechanics?.enhancement
  if (enhancement?.mode === 'active') {
    for (const id of enhancement.stages ?? []) check('enhancement', id, knownStage)
    for (const id of enhancement.species ?? []) check('species', id, knownSpecies)
  }
  for (const eligible of [rules?.mechanics?.inheritance?.eligible, rules?.mechanics?.secondGenerationNatures])
    if (Array.isArray(eligible)) for (const id of eligible) check('species', id, knownSpecies)
  for (const id of rules?.mechanics?.inheritance?.pool?.skills ?? []) check('skill', id, knownSkill)
  for (const row of rules?.learnsetAdjustments ?? []) {
    check('species', row.species, knownSpecies)
    check('skill', row.skill, knownSkill)
  }
}

type NatureLookup = (id: string) => { generation: 1 | 2 } | undefined

export function assertNatureChoice(
  rules: LearningRules | undefined,
  natureId: string,
  natureById: NatureLookup,
  speciesById: () => Pick<LearnsetSpecies, 'id' | 'inheritance'> | undefined,
) {
  const nature = natureById(natureId)
  if (!nature) throw new Error('缺少性格定义 ' + natureId)
  if (nature.generation === 1) return
  const species = speciesById()
  if (!species || !isEligible(species, resolveEnvironmentMechanics(rules).secondGenerationNatures))
    throw new Error('该精灵不能使用二代性格 ' + natureId)
}

const learningSelection = z.object({
  species: id,
  nature: id,
  enhancement: id.optional(),
  level: z.number().int().min(1).max(100),
  evs: z.record(z.string(), z.number()).optional(),
  ability: z.string().optional(),
  emblem: z.string().optional(),
  skills: z.array(id),
  inheritedSkill: id.optional(),
})
export type LearningLookups = [
  speciesById: (id: string) => unknown,
  natureById: NatureLookup,
  stageById: (id: string) => unknown,
  skillById?: (id: string) => unknown,
  markById?: (id: string) => unknown,
]
export function assertLearningChoices(
  rules: LearningRules | undefined,
  team: readonly unknown[],
  ...[speciesById, natureById, stageById, skillById, markById]: LearningLookups
) {
  for (const input of team) {
    const pet = learningSelection.parse(input)
    if (skillById) {
      for (const id of new Set(pet.inheritedSkill ? [...pet.skills, pet.inheritedSkill] : pet.skills))
        if (!skillById(id)) throw new Error('缺少技能定义 ' + id)
    }
    assertSkillSlots(rules?.mechanics?.skillSlots, pet.skills, skillById ?? (() => undefined))
    if (pet.evs && Object.values(pet.evs).reduce((sum, value) => sum + value, 0) > 510)
      throw new Error('学习力总和不能超过 510')
    const species = () => speciesById(pet.species) as LearnsetSpecies | undefined
    assertNatureChoice(rules, pet.nature, natureById, species)
    const definition = species()
    if (!definition || !Array.isArray(definition.learnable_skills)) throw new Error('缺少物种学习表 ' + pet.species)
    if (pet.enhancement && rules?.mechanics?.enhancement?.mode === 'active') {
      const stage = stageById(pet.enhancement) as { branch: string } | undefined
      if (!stage) throw new Error('缺少强化阶段 ' + pet.enhancement)
      if (!supportsEnhancementBranch(rules.mechanics.enhancement, definition, stage.branch))
        throw new Error('该物种不能使用强化阶段 ' + pet.enhancement)
    }
    for (const kind of ['ability', 'emblem'] as const) {
      const selected = pet[kind]
      if (selected && markById && !markById(selected)) throw new Error('缺少印记定义 ' + selected)
      if (selected && !definition[kind]?.some(mark => (typeof mark === 'string' ? mark : mark.id) === selected))
        throw new Error(
          (kind === 'ability' ? 'Ability' : 'Emblem') + ' ' + selected + ' is not allowed for ' + pet.species,
        )
    }
    const issues = learningIssues(rules, definition, pet)
    if (issues.length) throw new Error(issues.join('、'))
  }
}
