const fail = code => {
  throw Object.assign(new Error(code), { code })
}
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const keysAllowed = (value, names) => Object.keys(value).every(name => names.includes(name))
const identifier = value =>
  typeof value === 'string' && value.length > 0 && value.length <= 256 && !/\p{Cc}/u.test(value)

/** Validate the currently implemented rule vocabulary before admitting an environment. */
export function validateEnvironmentRules(input) {
  const rules = input === undefined ? { schemaVersion: 1 } : input
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
  const { minSize = 1, maxSize = 6, uniqueSpecies } = rules.team ?? {}
  if (
    !Number.isInteger(minSize) ||
    !Number.isInteger(maxSize) ||
    minSize < 1 ||
    maxSize > 6 ||
    minSize > maxSize ||
    (uniqueSpecies !== undefined && typeof uniqueSpecies !== 'boolean')
  )
    fail('ENVIRONMENT_RULES_INVALID')
  return structuredClone(rules)
}

/** Version requirements fail closed until a host implements capability negotiation. */
export function assertEnvironmentRequirements(input) {
  const requires = input === undefined ? {} : input
  if (!record(requires) || !keysAllowed(requires, ['engine', 'sdk', 'capabilities']))
    fail('ENVIRONMENT_REQUIREMENT_INVALID')
  for (const key of ['engine', 'sdk'])
    if (requires[key] !== undefined && (typeof requires[key] !== 'string' || !requires[key].trim()))
      fail('ENVIRONMENT_REQUIREMENT_INVALID')
  if (
    requires.capabilities !== undefined &&
    (!Array.isArray(requires.capabilities) || requires.capabilities.some(value => !identifier(value)))
  )
    fail('ENVIRONMENT_REQUIREMENT_INVALID')
  if (requires.capabilities?.length) fail('ENVIRONMENT_CAPABILITY_UNSUPPORTED')
  if (requires.engine !== undefined || requires.sdk !== undefined) fail('ENVIRONMENT_REQUIREMENT_UNSUPPORTED')
}

/** Admission checks apply to normalized team definitions, before creating any battle. */
export function assertEnvironmentTeam(input, team) {
  const rules = validateEnvironmentRules(input)
  const { minSize = 1, maxSize = 6, uniqueSpecies = false } = rules.team ?? {}
  if (!Array.isArray(team) || team.length < minSize || team.length > maxSize) fail('ENVIRONMENT_TEAM_REJECTED')
  for (const pet of team) {
    if (
      !record(pet) ||
      !identifier(pet.species) ||
      !Array.isArray(pet.skills) ||
      pet.skills.some(skill => !identifier(skill))
    )
      fail('ENVIRONMENT_TEAM_REJECTED')
    if ([pet.ability, pet.emblem].some(mark => mark !== undefined && mark !== '' && !identifier(mark)))
      fail('ENVIRONMENT_TEAM_REJECTED')
    const selected = {
      species: [pet.species],
      skills: pet.skills,
      marks: [pet.ability, pet.emblem].filter(value => !!value),
    }
    for (const kind of ['species', 'skills', 'marks']) {
      const allow = rules.allow?.[kind],
        deny = rules.deny?.[kind]
      if (selected[kind].some(id => (allow !== undefined && !allow.includes(id)) || deny?.includes(id)))
        fail('ENVIRONMENT_TEAM_REJECTED')
    }
  }
  if (uniqueSpecies && new Set(team.map(pet => pet.species)).size !== team.length) fail('ENVIRONMENT_TEAM_REJECTED')
}
