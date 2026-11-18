export { RuleCompositionError } from './rule-composition.ts'
import type { ContentPrototypeData } from '@arcadia-eternity/battle/engine'
import { readSkillParameterCatalog, resolveSkillParameters, requireElementChart } from '@arcadia-eternity/const'
import { composeRuleSets, splitRuleDeclaration } from './rule-composition.ts'
import {
  validateConstraintReferences,
  type RuleCollection,
  skillSlotsSchema,
  teamConstraintsSchema,
  teamConstraintIssues,
  skillParameterPolicySchema,
} from '@arcadia-eternity/const'
import type { EnvironmentRules } from './content-workspace.ts'
import {
  validateLearningReferences,
  eligibilitySchema,
  enhancementSchema,
  inheritanceSchema,
  learnsetAdjustmentsSchema,
} from './learnsets.ts'
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
const keysAllowed = (value: UnknownRecord, names: readonly string[]) =>
  Object.keys(value).every(name => names.includes(name))
const identifier = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 && !/\p{Cc}/u.test(value)

/** Validate the currently implemented rule vocabulary before admitting an environment. */
function validateRuleFields(input?: unknown): EnvironmentRules {
  const rules: unknown = input === undefined ? { schemaVersion: 1 } : input
  if (
    !record(rules) ||
    !keysAllowed(rules, [
      'schemaVersion',
      'tier',
      'allow',
      'deny',
      'team',
      'mechanics',
      'learnsetAdjustments',
      'matchups',
      'skillParameters',
      'constraints',
    ])
  )
    fail('ENVIRONMENT_RULES_INVALID')
  if (
    (rules.schemaVersion !== 1 && rules.schemaVersion !== 2) ||
    (rules.tier !== undefined && rules.tier !== 'standard')
  )
    fail('ENVIRONMENT_RULES_UNSUPPORTED')
  if (
    rules.constraints !== undefined &&
    (rules.schemaVersion !== 2 || !teamConstraintsSchema.safeParse(rules.constraints).success)
  )
    fail('ENVIRONMENT_RULES_INVALID')
  if (
    rules.skillParameters !== undefined &&
    (rules.schemaVersion !== 2 || !skillParameterPolicySchema.safeParse(rules.skillParameters).success)
  )
    fail('ENVIRONMENT_RULES_INVALID')
  if (rules.matchups !== undefined) {
    const policy = rules.matchups
    if (
      rules.schemaVersion !== 2 ||
      !record(policy) ||
      !keysAllowed(policy, ['table', 'adjustments']) ||
      (policy.table !== undefined && !identifier(policy.table))
    )
      fail('ENVIRONMENT_RULES_INVALID')
    if (policy.adjustments !== undefined) {
      if (!Array.isArray(policy.adjustments) || policy.adjustments.length > 50000) fail('ENVIRONMENT_RULES_INVALID')
      const seen = new Set<string>()
      for (const cell of policy.adjustments) {
        if (
          !record(cell) ||
          !keysAllowed(cell, ['attack', 'defense', 'multiplier']) ||
          !identifier(cell.attack) ||
          !identifier(cell.defense) ||
          typeof cell.multiplier !== 'number' ||
          !Number.isFinite(cell.multiplier) ||
          cell.multiplier < 0
        )
          fail('ENVIRONMENT_RULES_INVALID')
        const key = JSON.stringify([cell.attack, cell.defense])
        if (seen.has(key)) fail('ENVIRONMENT_RULES_INVALID')
        seen.add(key)
      }
    }
  }
  const mechanics = rules.mechanics
  if (mechanics !== undefined) {
    if (
      rules.schemaVersion !== 2 ||
      !record(mechanics) ||
      !keysAllowed(mechanics, [
        'skillSlots',
        'individualValues',
        'individualValueDefault',
        'allowFaintSwitch',
        'inheritance',
        'secondGenerationNatures',
        'enhancement',
      ])
    )
      fail('ENVIRONMENT_RULES_INVALID')
    if (mechanics.skillSlots !== undefined && !skillSlotsSchema.safeParse(mechanics.skillSlots).success)
      fail('ENVIRONMENT_RULES_INVALID')
    if (mechanics.allowFaintSwitch !== undefined && typeof mechanics.allowFaintSwitch !== 'boolean')
      fail('ENVIRONMENT_RULES_INVALID')
    if (mechanics.enhancement !== undefined && !enhancementSchema.safeParse(mechanics.enhancement).success)
      fail('ENVIRONMENT_RULES_INVALID')
    if (mechanics.inheritance !== undefined && !inheritanceSchema.safeParse(mechanics.inheritance).success)
      fail('ENVIRONMENT_RULES_INVALID')
    if (
      mechanics.secondGenerationNatures !== undefined &&
      !eligibilitySchema.safeParse(mechanics.secondGenerationNatures).success
    )
      fail('ENVIRONMENT_RULES_INVALID')
    const initial = mechanics.individualValueDefault
    if (
      initial !== undefined &&
      (typeof initial !== 'number' || !Number.isInteger(initial) || initial < 0 || initial > 120)
    )
      fail('ENVIRONMENT_IV_DEFAULT_INVALID')
    const ivs = mechanics.individualValues
    if (
      ivs !== undefined &&
      (!record(ivs) ||
        !keysAllowed(ivs, ['max']) ||
        typeof ivs.max !== 'number' ||
        !Number.isInteger(ivs.max) ||
        ivs.max < 0 ||
        ivs.max > 120)
    )
      fail('ENVIRONMENT_RULES_INVALID')
  }
  if (
    rules.learnsetAdjustments !== undefined &&
    (rules.schemaVersion !== 2 || !learnsetAdjustmentsSchema.safeParse(rules.learnsetAdjustments).success)
  )
    fail('ENVIRONMENT_RULES_INVALID')
  for (const group of [rules.allow, rules.deny]) {
    if (group === undefined) continue
    if (!record(group) || !keysAllowed(group, ['species', 'skills', 'marks'])) fail('ENVIRONMENT_RULES_INVALID')
    for (const values of Object.values(group)) {
      if (
        !Array.isArray(values) ||
        values.length > 10000 ||
        values.some(value => !identifier(value)) ||
        new Set(values).size !== values.length
      )
        fail('ENVIRONMENT_RULES_INVALID')
    }
  }
  if (
    rules.team !== undefined &&
    (!record(rules.team) || !keysAllowed(rules.team, ['minSize', 'maxSize', 'uniqueSpecies']))
  )
    fail('ENVIRONMENT_RULES_INVALID')
  const team = record(rules.team) ? rules.team : {}
  const minSize = team.minSize === undefined ? 1 : team.minSize
  const maxSize = team.maxSize === undefined ? 6 : team.maxSize
  const uniqueSpecies = team.uniqueSpecies
  if (
    typeof minSize !== 'number' ||
    typeof maxSize !== 'number' ||
    !Number.isInteger(minSize) ||
    !Number.isInteger(maxSize) ||
    minSize < 1 ||
    maxSize > 6 ||
    minSize > maxSize ||
    (uniqueSpecies !== undefined && typeof uniqueSpecies !== 'boolean')
  )
    fail('ENVIRONMENT_RULES_INVALID')
  return structuredClone(rules) as unknown as EnvironmentRules
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

export const environmentCapabilities = Object.freeze([
  'rules.composition.v1',
  'team.constraints.v1',
  'team.skill-slots.v1',
  'training.individual-values.v1',
  'training.inheritance.v1',
  'training.enhancement.v1',
  'battle.skill-parameters.v1',
  'battle.type-chart.v1',
])
/** Version requirements fail closed until a host implements capability negotiation. */
export function assertEnvironmentRequirements(input?: unknown): void {
  const requires: unknown = input === undefined ? {} : input
  if (!record(requires) || !keysAllowed(requires, ['engine', 'sdk', 'capabilities']))
    fail('ENVIRONMENT_REQUIREMENT_INVALID')
  for (const key of ['engine', 'sdk'] as const) {
    const value = requires[key]
    if (value !== undefined && (typeof value !== 'string' || !value.trim())) fail('ENVIRONMENT_REQUIREMENT_INVALID')
  }
  if (
    requires.capabilities !== undefined &&
    (!Array.isArray(requires.capabilities) || requires.capabilities.some(value => !identifier(value)))
  )
    fail('ENVIRONMENT_REQUIREMENT_INVALID')
  if (Array.isArray(requires.capabilities)) {
    const missing = requires.capabilities.filter(value => !environmentCapabilities.includes(value))
    if (missing.length)
      throw Object.assign(new Error('ENVIRONMENT_CAPABILITY_UNSUPPORTED: ' + missing.join(', ')), {
        code: 'ENVIRONMENT_CAPABILITY_UNSUPPORTED',
      })
  }
  if (requires.engine !== undefined || requires.sdk !== undefined) fail('ENVIRONMENT_REQUIREMENT_UNSUPPORTED')
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
export function prepareEnvironmentRules(input: unknown, definitions: readonly unknown[] = []) {
  const prepared = composeRuleSets(input, definitions, validateRuleFields)
  checkIVDefault(prepared.rules)
  return prepared
}
export function validateEnvironmentRuleDeclaration(input: unknown) {
  return splitRuleDeclaration(input, validateRuleFields)
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
