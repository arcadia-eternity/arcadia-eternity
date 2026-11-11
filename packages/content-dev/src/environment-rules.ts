import type { EnvironmentRules } from './content-workspace.ts'
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
export function validateEnvironmentRules(input?: unknown): EnvironmentRules {
  const rules: unknown = input === undefined ? { schemaVersion: 1 } : input
  if (!record(rules) || !keysAllowed(rules, ['schemaVersion', 'tier', 'allow', 'deny', 'team']))
    fail('ENVIRONMENT_RULES_INVALID')
  if (rules.schemaVersion !== 1 || (rules.tier !== undefined && rules.tier !== 'standard'))
    fail('ENVIRONMENT_RULES_UNSUPPORTED')
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
  if (Array.isArray(requires.capabilities) && requires.capabilities.length) fail('ENVIRONMENT_CAPABILITY_UNSUPPORTED')
  if (requires.engine !== undefined || requires.sdk !== undefined) fail('ENVIRONMENT_REQUIREMENT_UNSUPPORTED')
}

/** Admission checks apply to normalized team definitions, before creating any battle. */
export function assertEnvironmentTeam(input: unknown, team: unknown): void {
  const rules = validateEnvironmentRules(input)
  const { minSize = 1, maxSize = 6, uniqueSpecies = false } = rules.team ?? {}
  if (!Array.isArray(team) || team.length < minSize || team.length > maxSize) fail('ENVIRONMENT_TEAM_REJECTED')
  const players: unknown[] = team
  for (const pet of players) {
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
    const selected: Record<'species' | 'skills' | 'marks', unknown[]> = {
      species: [petRecord.species],
      skills: petRecord.skills as unknown[],
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
  if (uniqueSpecies && new Set(players.map(pet => (pet as UnknownRecord).species)).size !== players.length)
    fail('ENVIRONMENT_TEAM_REJECTED')
}
