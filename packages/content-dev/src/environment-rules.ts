export { RuleCompositionError, resolveEnvironmentMechanics } from '@arcadia-eternity/const'
import type { ContentPrototypeData } from '@arcadia-eternity/battle/engine'
import { readSkillParameterCatalog, resolveSkillParameters, requireElementChart } from '@arcadia-eternity/const'
import { resolveDeclaredRules } from './rule-composition.ts'
import {
  effectSdkApiVersion,
  allowsEnhancementRecord,
  IndependentEnvironmentRulesSchema,
  readEnvironmentRuleSets,
  resolveEnvironmentMechanics,
  resolveEnvironmentTeam,
  validateConstraintReferences,
  type RuleCollection,
  EnvironmentRulesSchema,
  parseRuleData,
  EnvironmentRequirementsSchema,
  teamConstraintIssues,
} from '@arcadia-eternity/const'
import type { EnvironmentRules } from './content-workspace.ts'
import { assertLearningChoices, validateLearningReferences } from './learnsets.ts'
export {
  resolveLearnset,
  learningIssues,
  isEligible,
  assertNatureChoice,
  validateLearningReferences,
  assertLearningChoices,
} from './learnsets.ts'
import { isRecord, type UnknownRecord } from './types.ts'

function fail(code: string): never {
  throw Object.assign(new Error(code), { code })
}
const record = (value: unknown): value is UnknownRecord => isRecord(value)
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 && !/\p{Cc}/u.test(value)

/** Validate the currently implemented rule vocabulary before admitting an environment. */
function validateRuleFields(input?: unknown): EnvironmentRules {
  return parseRuleData(EnvironmentRulesSchema, input)
}

function checkEffectiveRules(rules: EnvironmentRules) {
  const { max, defaultValue } = resolveEnvironmentMechanics(rules).individualValues
  const team = resolveEnvironmentTeam(rules)
  if (team.minSize > team.maxSize) fail('ENVIRONMENT_TEAM_SELECTION_EXCEEDS_ROSTER')
  if (defaultValue > max) fail('ENVIRONMENT_IV_DEFAULT_EXCEEDS_MAX')
  return rules
}

export function validateEnvironmentRules(input?: unknown): EnvironmentRules {
  return checkEffectiveRules(validateRuleFields(input))
}

const capabilityFields = {
  'team.constraints.v1': (rules: EnvironmentRules) => rules.constraints?.length,
  'team.skill-slots.v1': (rules: EnvironmentRules) => rules.mechanics?.skillSlots,
  'training.individual-values.v1': (rules: EnvironmentRules) =>
    rules.mechanics?.individualValues || rules.mechanics?.individualValueDefault !== undefined,
  'training.inheritance.v1': (rules: EnvironmentRules) =>
    rules.mechanics?.inheritance || rules.mechanics?.secondGenerationNatures || rules.learnsetAdjustments?.length,
  'training.enhancement.v1': (rules: EnvironmentRules) => rules.mechanics?.enhancement,
  'battle.skill-parameters.v1': (rules: EnvironmentRules) => rules.skillParameters,
  'battle.type-chart.v1': (rules: EnvironmentRules) => rules.matchups,
  'battle.timer.v1': (rules: EnvironmentRules) => rules.mechanics?.timer,
  'battle.team-selection.v1': (rules: EnvironmentRules) => rules.mechanics?.teamSelection,
  'battle.faint-switch.v1': (rules: EnvironmentRules) => rules.mechanics?.allowFaintSwitch !== undefined,
}
export const environmentCapabilities = Object.freeze(['rules.composition.v1', ...Object.keys(capabilityFields)])
const currentHost = { engine: '4', sdk: String(effectSdkApiVersion), capabilities: environmentCapabilities }
export function assertEnvironmentRequirements(input?: unknown, host = currentHost): void {
  const parsed = EnvironmentRequirementsSchema.safeParse(input === undefined ? {} : input)
  if (!parsed.success) fail('ENVIRONMENT_REQUIREMENT_INVALID')
  const requires = parsed.data
  for (const name of ['engine', 'sdk'] as const)
    if (requires[name] !== undefined && requires[name] !== host[name]) fail('ENVIRONMENT_REQUIREMENT_UNSUPPORTED')
  const missing = requires.capabilities?.filter(id => !host.capabilities.includes(id)) ?? []
  if (missing.length)
    throw Object.assign(new Error('ENVIRONMENT_CAPABILITY_UNSUPPORTED: ' + missing.join(', ')), {
      code: 'ENVIRONMENT_CAPABILITY_UNSUPPORTED',
    })
}

function rejectTeam(detail: string): never {
  const code = 'ENVIRONMENT_TEAM_REJECTED'
  throw Object.assign(new Error(code), { code, detail })
}

/** Admission checks apply to normalized team definitions, before creating any battle. */
export function assertEnvironmentTeam(input: unknown, team: unknown): void {
  const rules = validateEnvironmentRules(input)
  const { minSize, maxSize, uniqueSpecies } = resolveEnvironmentTeam(rules)
  if (!Array.isArray(team)) rejectTeam('队伍必须是精灵列表')
  if (team.length < minSize || team.length > maxSize)
    rejectTeam(`队伍需要 ${minSize}–${maxSize} 只精灵，当前为 ${team.length} 只`)
  for (const pet of team) assertEnvironmentMember(rules, pet)
  const [issue] = teamConstraintIssues(rules.constraints, team, 'team')
  if (issue) rejectTeam(issue.message)
  if (uniqueSpecies) {
    const species = team.map(pet => pet.species)
    const duplicate = species.find((id, index) => species.indexOf(id) !== index)
    if (duplicate) rejectTeam(`team.uniqueSpecies 禁止重复携带 ${duplicate}`)
  }
}

export function assertPlayableTeam(
  rules: EnvironmentRules | undefined,
  team: readonly unknown[],
  ...content: import('./learnsets.ts').LearningLookups
) {
  assertEnvironmentTeam(rules, team)
  assertLearningChoices(rules, team, ...content)
}

/** Check one build against prepared rules independently of team size and composition. */
export function assertEnvironmentMember(rules: EnvironmentRules, pet: unknown): void {
  const ivLimit = resolveEnvironmentMechanics(rules).individualValues.max
  if (!record(pet)) rejectTeam('精灵配置应为对象')
  const petRecord = pet as UnknownRecord
  if (
    !identifier(petRecord.species) ||
    !Array.isArray(petRecord.skills) ||
    petRecord.skills.some(skill => !identifier(skill))
  )
    rejectTeam('精灵配置需要有效的物种和技能 ID')
  if ([petRecord.ability, petRecord.emblem].some(mark => mark !== undefined && mark !== '' && !identifier(mark)))
    rejectTeam(`${petRecord.species} 的特性或纹章 ID 无效`)
  if (petRecord.enhancement !== undefined) {
    if (!identifier(petRecord.enhancement)) rejectTeam(`${petRecord.species} 的强化阶段 ID 无效`)
    if (
      !allowsEnhancementRecord(
        rules.mechanics?.enhancement,
        petRecord.species,
        petRecord.enhancement,
        typeof petRecord.level === 'number' ? petRecord.level : undefined,
      )
    )
      rejectTeam(`${petRecord.species} 不能使用强化阶段 ${petRecord.enhancement}`)
  }
  const sourceLimits = petRecord.ivMax
  if (sourceLimits !== undefined && !record(sourceLimits)) rejectTeam(`${petRecord.species} 的资质上限无效`)
  if (
    petRecord.ivs !== undefined &&
    (!record(petRecord.ivs) ||
      Object.entries(petRecord.ivs).some(([stat, value]) => {
        const max = sourceLimits === undefined ? ivLimit : sourceLimits[stat]
        return (
          typeof max !== 'number' ||
          !Number.isInteger(max) ||
          max < 0 ||
          max > 120 ||
          typeof value !== 'number' ||
          !Number.isInteger(value) ||
          value < 0 ||
          value > max
        )
      }))
  )
    rejectTeam(`${petRecord.species} 的资质或资质上限不符合环境要求`)
  const [issue] = teamConstraintIssues(
    rules.constraints,
    [
      {
        species: petRecord.species,
        skills: petRecord.skills as string[],
        ability: petRecord.ability as string | undefined,
        emblem: petRecord.emblem as string | undefined,
      },
    ],
    'pet',
  )
  if (issue) rejectTeam(`${petRecord.species}：${issue.message}`)
  const selected: Record<'species' | 'skills' | 'marks', unknown[]> = {
    species: [petRecord.species],
    skills: [
      ...(petRecord.skills as unknown[]),
      ...(petRecord.inheritedSkill === undefined ? [] : [petRecord.inheritedSkill]),
    ],
    marks: [petRecord.ability, petRecord.emblem].filter(value => !!value),
  }
  for (const kind of ['species', 'skills', 'marks'] as const) {
    const allow = rules.allow?.[kind],
      deny = rules.deny?.[kind]
    for (const id of selected[kind]) {
      if (!identifier(id)) rejectTeam(`${petRecord.species} 的 ${kind} ID 无效`)
      if (deny?.includes(id)) rejectTeam(`${petRecord.species}：deny.${kind} 禁止使用 ${id}`)
      if (allow !== undefined && !allow.includes(id)) rejectTeam(`${petRecord.species}：allow.${kind} 未包含 ${id}`)
    }
  }
}

/** Compatibility defaults for unmanaged projects with the official base package. */
export function defaultRuleDeclaration(definitions: readonly unknown[] = []) {
  return definitions.some(row => isRecord(row) && row.id === 'base:classic')
    ? {
        schemaVersion: 2 as const,
        mechanics: {
          individualValues: { max: 31 },
          inheritance: { eligible: 'species' as const },
          secondGenerationNatures: 'species' as const,
        },
      }
    : { schemaVersion: 1 as const }
}

export function prepareEnvironmentRules(input: unknown, definitions: readonly unknown[] = [], host = currentHost) {
  const declaration = input === undefined ? defaultRuleDeclaration(definitions) : input
  const prepared = resolveDeclaredRules(validateEnvironmentRuleDeclaration(declaration))
  checkEffectiveRules(prepared.rules)
  const requiredCapabilities = Object.entries(capabilityFields)
    .filter(([, used]) => used(prepared.rules))
    .map(([key]) => key)
  if (isRecord(declaration) && 'collections' in declaration) requiredCapabilities.unshift('rules.composition.v1')
  assertEnvironmentRequirements({ capabilities: requiredCapabilities }, host)
  return { ...prepared, ruleSets: readEnvironmentRuleSets(definitions), requiredCapabilities }
}
export function validateEnvironmentRuleDeclaration(input: unknown) {
  return parseRuleData(IndependentEnvironmentRulesSchema, input)
}

/** Validate selectors once against the catalog held by this preparation. */
export function assertRuleContentReferences(
  rules: EnvironmentRules,
  catalog: {
    species: ReadonlySet<string>
    skill: ReadonlySet<string>
    mark: ReadonlySet<string>
    stage: ReadonlySet<string>
  },
  fields: readonly { path: readonly string[]; value: unknown }[] = [],
) {
  const known = {
    species: (id: string) => catalog.species.has(id),
    skill: (id: string) => catalog.skill.has(id),
    mark: (id: string) => catalog.mark.has(id),
  }
  validateConstraintReferences(rules.constraints, known)
  validateLearningReferences(rules, known.species, known.skill, id => catalog.stage.has(id))
  function check(path: string, kind: keyof typeof known, ids: readonly string[]) {
    for (const id of ids)
      if (!known[kind](id))
        throw Object.assign(new Error(`ENVIRONMENT_REFERENCE_MISSING: ${path} / ${kind} / ${id}`), {
          code: 'ENVIRONMENT_REFERENCE_MISSING',
        })
  }
  for (const field of fields)
    if (field.path[0] === 'collections') {
      const collection = field.value as RuleCollection
      check(collection.id, collection.kind, collection.ids)
    }
  if (rules.schemaVersion === 2)
    for (const side of ['allow', 'deny'] as const) {
      const selection = rules[side]
      if (selection?.species) check(side, 'species', selection.species)
      if (selection?.skills) check(side, 'skill', selection.skills)
      if (selection?.marks) check(side, 'mark', selection.marks)
    }
}

/** Resolve declarations against the exact package data used to build this runtime. */
export function prepareRulesForContent(declaration: unknown, data: ContentPrototypeData) {
  const composition = prepareEnvironmentRules(declaration, data.ruleSets)
  const { rules, fields } = composition
  resolveSkillParameters(readSkillParameterCatalog(data), rules.skillParameters)
  requireElementChart(data, rules.matchups)
  assertRuleContentReferences(rules, indexRuleContent(data), fields)
  return { rules, fields, ruleSets: composition.ruleSets, requiredCapabilities: composition.requiredCapabilities }
}

export function indexRuleContent(data: Pick<ContentPrototypeData, 'species' | 'skills' | 'marks' | 'enhancements'>) {
  const ids = (rows: readonly unknown[] = []) =>
    new Set(rows.flatMap(row => (isRecord(row) && typeof row.id === 'string' ? [row.id] : [])))
  return { species: ids(data.species), skill: ids(data.skills), mark: ids(data.marks), stage: ids(data.enhancements) }
}
