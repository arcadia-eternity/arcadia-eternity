import { assertSkillSlots, type SkillSlots } from '@arcadia-eternity/const'
import { z } from 'zod'

const id = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[^\p{Cc}]+$/u)
const ids = z
  .array(id)
  .max(10000)
  .refine(values => new Set(values).size === values.length, '重复的内容 ID')
export const eligibilitySchema = z.union([z.enum(['species', 'all', 'off']), ids])
export const enhancementSchema = z
  .object({
    mode: z.enum(['forbidden', 'suppressed', 'active']),
    stages: ids.optional(),
    species: ids.optional(),
  })
  .strict()
export const inheritanceSchema = z
  .object({
    eligible: eligibilitySchema,
    pool: z
      .object({ mode: z.enum(['fallback', 'append', 'replace']), skills: ids })
      .strict()
      .optional(),
  })
  .strict()
export const learnsetAdjustmentsSchema = z
  .array(
    z
      .object({
        species: id,
        source: z.enum(['normal', 'inherited']),
        skill: id,
        action: z.enum(['add', 'remove']),
        level: z.number().int().min(1).max(100).optional(),
      })
      .strict()
      .refine(
        row => row.level === undefined || (row.action === 'add' && row.source === 'normal'),
        '只有普通学习条目的新增操作能指定等级',
      ),
  )
  .max(10000)
  .refine(
    rows => new Set(rows.map(row => JSON.stringify([row.species, row.source, row.skill]))).size === rows.length,
    '同一物种、来源与技能只能调整一次',
  )

export interface LearnsetSpecies {
  id: string
  learnable_skills: readonly { skill_id: string; level: number }[]
  inheritance?: { skills: string[] }
}
type Eligibility = z.infer<typeof eligibilitySchema>
type LearningRules = {
  mechanics?: {
    skillSlots?: SkillSlots
    inheritance?: z.infer<typeof inheritanceSchema>
    secondGenerationNatures?: Eligibility
    enhancement?: z.infer<typeof enhancementSchema>
  }
  learnsetAdjustments?: z.infer<typeof learnsetAdjustmentsSchema>
}
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
  const inheritance = rules?.mechanics?.inheritance
  const eligible = isEligible(species, inheritance?.eligible)
  const inherited = new Set(species.inheritance?.skills)
  const pool = inheritance?.pool
  if (pool && (pool.mode !== 'fallback' || !inherited.size)) {
    if (pool.mode === 'replace') inherited.clear()
    for (const skill of pool.skills) inherited.add(skill)
  }
  for (const row of rules?.learnsetAdjustments ?? []) {
    if (row.species !== species.id) continue
    const source = row.source === 'normal' ? normal : inherited
    if (row.action === 'remove') source.delete(row.skill)
    else if ((row.level ?? 1) <= level) source.add(row.skill)
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
  for (const id of rules?.mechanics?.enhancement?.stages ?? []) check('enhancement', id, knownStage)
  for (const id of rules?.mechanics?.enhancement?.species ?? []) check('species', id, knownSpecies)
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
  if (!species || !isEligible(species, rules?.mechanics?.secondGenerationNatures))
    throw new Error('该精灵不能使用二代性格 ' + natureId)
}

const learningSelection = z.object({
  species: id,
  nature: id,
  enhancement: id.optional(),
  level: z.number().int().positive(),
  skills: z.array(id),
  inheritedSkill: id.optional(),
})
export function assertLearningChoices(
  rules: LearningRules | undefined,
  team: readonly unknown[],
  speciesById: (id: string) => unknown,
  natureById: NatureLookup,
  stageById: (id: string) => unknown,
  skillById: (id: string) => unknown = () => undefined,
) {
  for (const input of team) {
    const pet = learningSelection.parse(input)
    assertSkillSlots(rules?.mechanics?.skillSlots, pet.skills, skillById)
    if (pet.enhancement && !stageById(pet.enhancement)) throw new Error('缺少强化阶段 ' + pet.enhancement)
    const species = () => speciesById(pet.species) as LearnsetSpecies | undefined
    assertNatureChoice(rules, pet.nature, natureById, species)
    if (!rules?.mechanics?.inheritance && !rules?.learnsetAdjustments?.length && !pet.inheritedSkill) continue
    const definition = species()
    if (!definition || !Array.isArray(definition.learnable_skills)) throw new Error('缺少物种学习表 ' + pet.species)
    const issues = learningIssues(rules, definition, pet)
    if (issues.length) throw new Error(issues.join('、'))
  }
}
