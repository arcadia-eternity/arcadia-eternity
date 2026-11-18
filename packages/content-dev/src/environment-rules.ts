export { RuleCompositionError } from './rule-composition.ts'
import type { ContentPrototypeData } from '@arcadia-eternity/battle/engine'
import { readSkillParameterCatalog, resolveSkillParameters, requireElementChart } from '@arcadia-eternity/const'
import { composeRuleSets, splitRuleDeclaration } from './rule-composition.ts'
import {
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

function checkIVDefault(rules: EnvironmentRules) {
  const { max, defaultValue } = resolveEnvironmentMechanics(rules).individualValues
  if (defaultValue > max) fail('ENVIRONMENT_IV_DEFAULT_EXCEEDS_MAX')
  return rules
}

export function validateEnvironmentRules(input?: unknown): EnvironmentRules {
  return checkIVDefault(validateRuleFields(input))
}

/** Shared defaults for environments created before mechanics were configurable. */
export function resolveEnvironmentMechanics(rules?: EnvironmentRules) {
  const max = rules?.mechanics?.individualValues?.max ?? 31
  return {
    individualValues: { max, defaultValue: rules?.mechanics?.individualValueDefault ?? Math.min(31, max) },
    allowFaintSwitch: rules?.mechanics?.allowFaintSwitch ?? true,
  }
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
  'battle.faint-switch.v1': (rules: EnvironmentRules) => rules.mechanics?.allowFaintSwitch !== undefined,
}
export const environmentCapabilities = Object.freeze(['rules.composition.v1', ...Object.keys(capabilityFields)])
const currentHost = { engine: '4', sdk: '2', capabilities: environmentCapabilities }
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

/** Admission checks apply to normalized team definitions, before creating any battle. */
export function assertEnvironmentTeam(input: unknown, team: unknown): void {
  const rules = validateEnvironmentRules(input)
  const { minSize = 1, maxSize = 6, uniqueSpecies = false } = rules.team ?? {}
  if (!Array.isArray(team) || team.length < minSize || team.length > maxSize) fail('ENVIRONMENT_TEAM_REJECTED')
  for (const pet of team) assertEnvironmentMember(rules, pet)
  if (teamConstraintIssues(rules.constraints, team, 'team').length) fail('ENVIRONMENT_TEAM_REJECTED')
  if (uniqueSpecies && new Set(team.map(pet => pet.species)).size !== team.length) fail('ENVIRONMENT_TEAM_REJECTED')
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
  if (!record(pet)) fail('ENVIRONMENT_TEAM_REJECTED')
  const petRecord = pet as UnknownRecord
  if (
    !identifier(petRecord.species) ||
    !Array.isArray(petRecord.skills) ||
    petRecord.skills.some(skill => !identifier(skill))
  )
    fail('ENVIRONMENT_TEAM_REJECTED')
  if ([petRecord.ability, petRecord.emblem].some(mark => mark !== undefined && mark !== '' && !identifier(mark)))
    fail('ENVIRONMENT_TEAM_REJECTED')
  if (petRecord.enhancement !== undefined) {
    const policy = rules.mechanics?.enhancement
    if (
      !identifier(petRecord.enhancement) ||
      !policy ||
      policy.mode === 'forbidden' ||
      (policy.species && !policy.species.includes(petRecord.species)) ||
      (policy.stages && !policy.stages.includes(petRecord.enhancement))
    )
      fail('ENVIRONMENT_TEAM_REJECTED')
  }
  if (
    petRecord.ivs !== undefined &&
    (!record(petRecord.ivs) ||
      Object.values(petRecord.ivs).some(
        value => typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > ivLimit,
      ))
  )
    fail('ENVIRONMENT_TEAM_REJECTED')
  if (
    teamConstraintIssues(
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
    ).length
  )
    fail('ENVIRONMENT_TEAM_REJECTED')
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
    if (
      selected[kind].some(id => !identifier(id) || (allow !== undefined && !allow.includes(id)) || deny?.includes(id))
    )
      fail('ENVIRONMENT_TEAM_REJECTED')
  }
}

/** Author declarations are expanded only against a captured installation. */
export function defaultRuleDeclaration(definitions: readonly unknown[] = []) {
  return definitions.some(row => isRecord(row) && row.id === 'base:classic')
    ? { schemaVersion: 2 as const, include: ['base:classic'] }
    : { schemaVersion: 1 as const }
}

export function prepareEnvironmentRules(input: unknown, definitions: readonly unknown[] = [], host = currentHost) {
  const declaration = input === undefined ? defaultRuleDeclaration(definitions) : input
  const prepared = composeRuleSets(declaration, definitions, validateRuleFields)
  checkIVDefault(prepared.rules)
  const requiredCapabilities = Object.entries(capabilityFields)
    .filter(([, used]) => used(prepared.rules))
    .map(([key]) => key)
  if (isRecord(declaration) && ['include', 'constraintEdits', 'collections'].some(field => field in declaration))
    requiredCapabilities.unshift('rules.composition.v1')
  assertEnvironmentRequirements({ capabilities: requiredCapabilities }, host)
  return { ...prepared, requiredCapabilities }
}
export function validateEnvironmentRuleDeclaration(input: unknown) {
  return splitRuleDeclaration(input)
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
  const ids = (rows: readonly unknown[] = []) =>
    new Set(rows.flatMap(row => (isRecord(row) && typeof row.id === 'string' ? [row.id] : [])))
  assertRuleContentReferences(
    rules,
    {
      species: ids(data.species),
      skill: ids(data.skills),
      mark: ids(data.marks),
      stage: ids(data.enhancements),
    },
    fields,
  )
  return composition
}
