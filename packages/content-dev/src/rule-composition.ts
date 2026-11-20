import {
  EnvironmentRulesSchema,
  parseRuleData,
  resolveEnhancement,
  RuleCompositionError,
  type DeclaredTeamConstraint,
  type IndependentEnvironmentRules,
  type TeamConstraint,
  type EnvironmentRules,
} from '@arcadia-eternity/const'

function entries(rules: EnvironmentRules) {
  const out: { path: string[]; value: unknown }[] = []
  const add = (path: string[], value: unknown) => out.push({ path, value })
  for (const section of ['mechanics', 'allow', 'deny', 'team'] as const)
    for (const [key, value] of Object.entries(rules[section] ?? {}))
      add(
        [section, key],
        section === 'mechanics' && key === 'enhancement' ? resolveEnhancement(rules.mechanics?.enhancement) : value,
      )
  if (rules.tier !== undefined) add(['tier'], rules.tier)
  for (const row of rules.constraints ?? []) add(['constraints', row.id], row)
  for (const row of rules.learnsetAdjustments ?? [])
    add(['learnsetAdjustments', row.species, row.source, row.skill], row)
  const matchups = rules.matchups
  if (matchups?.table !== undefined) add(['matchups', 'table'], matchups.table)
  for (const row of matchups?.adjustments ?? []) add(['matchups', 'adjustments', row.attack, row.defense], row)
  const parameters = rules.skillParameters
  if (parameters?.profile !== undefined) add(['skillParameters', 'profile'], parameters.profile)
  for (const [key, value] of Object.entries(parameters?.groups ?? {})) add(['skillParameters', 'groups', key], value)
  for (const row of parameters?.overrides ?? [])
    add(['skillParameters', 'overrides', row.skill, row.useId, row.parameter], row)
  return out
}

export function resolveDeclaredRules({ collections: lists = [], constraints, ...local }: IndependentEnvironmentRules) {
  const collections = new Map(lists.map(row => [row.id, row]))
  function expandConstraint(row: DeclaredTeamConstraint): TeamConstraint {
    const expand = (selector: DeclaredTeamConstraint['allOf'][number]) => {
      const ids = new Set(selector.ids)
      for (const id of selector.fromCollections ?? []) {
        const collection = collections.get(id)
        if (!collection) throw new RuleCompositionError('ENVIRONMENT_COLLECTION_MISSING', row.id + ' / ' + id)
        if (collection.kind !== selector.kind)
          throw new RuleCompositionError('ENVIRONMENT_COLLECTION_KIND', row.id + ' / ' + id)
        for (const member of collection.ids) ids.add(member)
      }
      return { kind: selector.kind, ids: [...ids].sort() }
    }
    return {
      ...row,
      allOf: row.allOf.map(expand),
      ...(row.kind === 'ban' && {
        ...(row.exceptWhen && { exceptWhen: row.exceptWhen.map(expand) }),
        ...(row.exceptAny && { exceptAny: row.exceptAny.map(clause => clause.map(expand)) }),
      }),
    }
  }
  const rules = parseRuleData(EnvironmentRulesSchema, {
    ...local,
    ...(constraints && { constraints: constraints.map(expandConstraint) }),
  })
  const fields = [...entries(rules), ...lists.map(value => ({ path: ['collections', value.id], value }))].map(
    field => ({ ...field, sources: ['$environment'], effectiveSources: ['$environment'] }),
  )
  return { rules, fields }
}
