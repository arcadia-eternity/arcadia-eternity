import {
  readEnvironmentRuleSets,
  resolveEnhancement,
  splitRuleDeclaration,
  RuleCompositionError,
  type ConstraintEdits,
  type TeamConstraint,
  type DeclaredTeamConstraint,
  type RuleCollection,
} from '@arcadia-eternity/const'
import type { EnvironmentRules } from './debug-environments.ts'
import { isRecord } from './types.ts'

type ValidateRules = (raw: unknown) => EnvironmentRules
type Path = readonly string[]
type Entry = { path: Path; value: unknown }
type Choice = { value: unknown; sources: Set<string> }
type Field = { path: Path; choices: Map<string, Choice>; sources: Set<string> }
type Fields = Map<string, Field>

function issue(code: string, detail: string): never {
  throw new RuleCompositionError(code, detail)
}

// Arrays that describe eligibility or a selector are sets. Domain records with several
// independently editable entries (matchups, bindings, learnsets) get one address per entry.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).sort().join(',') + ']'
  if (!isRecord(value)) return JSON.stringify(value)
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map(key => JSON.stringify(key) + ':' + canonical(value[key]))
      .join(',') +
    '}'
  )
}

function entries(rules: EnvironmentRules): Entry[] {
  const out: Entry[] = []
  const add = (path: Path, value: unknown) => out.push({ path, value })
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

function merge(fields: Fields, path: Path, choice: Choice, sources: Iterable<string>, replace = false) {
  const key = JSON.stringify(path)
  let field = fields.get(key)
  if (!field) {
    field = { path, choices: new Map(), sources: new Set() }
    fields.set(key, field)
  }
  if (replace) field.choices.clear()
  for (const source of sources) field.sources.add(source)
  const identity = canonical(choice.value)
  const previous = field.choices.get(identity)
  if (previous) {
    for (const source of choice.sources) previous.sources.add(source)
  } else field.choices.set(identity, { value: choice.value, sources: new Set(choice.sources) })
}

function effective(field: Field): unknown {
  const [section, key] = field.path
  const values = Array.from(field.choices.values(), choice => choice.value)
  if (section === 'allow' || section === 'deny') {
    const sets = (values as string[][]).map(list => new Set(list))
    const result =
      section === 'allow'
        ? [...sets[0]!].filter(id => sets.every(set => set.has(id)))
        : Array.from(new Set(sets.flatMap(set => [...set])))
    return result.sort()
  }
  if (section === 'team') {
    if (key === 'uniqueSpecies') return values.includes(true)
    return key === 'minSize' ? Math.max(...(values as number[])) : Math.min(...(values as number[]))
  }
  if (values.length === 1) return values[0]
  if (
    section === 'mechanics' &&
    key === 'enhancement' &&
    values.every(value => isRecord(value) && value.mode === 'suppressed')
  )
    return { mode: 'suppressed' }
  const contenders = [...field.choices.values()].map(
    choice => [...choice.sources].sort().join(', ') + ' = ' + canonical(choice.value),
  )
  issue('ENVIRONMENT_RULE_CONFLICT', field.path.join(' / ') + ' (' + contenders.sort().join(' | ') + ')')
}

function writeField(result: Record<string, unknown>, path: Path, value: unknown) {
  const [section, key] = path
  if (path.length === 1) {
    result[section!] = value
    return
  }
  if (section === 'constraints' || section === 'learnsetAdjustments') {
    const rows = (result[section] ??= []) as unknown[]
    rows.push(value)
    return
  }
  const group = (result[section!] ??= Object.create(null)) as Record<string, unknown>
  if (path.length === 2) group[key!] = value
  else if (key === 'groups') {
    const groups = (group.groups ??= Object.create(null)) as Record<string, unknown>
    groups[path[2]!] = value
  } else {
    const rows = (group[key!] ??= []) as unknown[]
    rows.push(value)
  }
}

function applyConstraintEdits(fields: Fields, source: string, edits: ConstraintEdits, local: TeamConstraint[] = []) {
  const put = (id: string, value: TeamConstraint | null) =>
    merge(fields, ['constraints', id], { value, sources: new Set([source]) }, [source], true)
  const lookup = (id: string) => fields.get(JSON.stringify(['constraints', id]))
  const requireField = (id: string) => {
    const field = lookup(id)
    if (!field || [...field.choices.values()].every(choice => choice.value === null))
      issue('ENVIRONMENT_RULE_TARGET_MISSING', source + ' / ' + id)
    return field
  }
  const clears = new Set(edits.clearExceptions)
  const changed = new Set<string>()
  for (const { id, value } of [
    ...(edits.remove ?? []).map(id => ({ id, value: null })),
    ...(edits.replace ?? []).map(value => ({ id: value.id, value })),
  ]) {
    if (changed.has(id)) issue('ENVIRONMENT_RULE_EDIT_CONFLICT', source + ' / ' + id)
    changed.add(id)
    const field = requireField(id)
    const hasExceptions = [...field.choices.values()].some(choice => {
      const rule = choice.value as TeamConstraint | null
      return rule?.kind === 'ban' && (rule.exceptWhen?.length || rule.exceptAny?.length)
    })
    if (hasExceptions && !clears.has(id)) issue('ENVIRONMENT_RULE_EXCEPTION_DANGLING', source + ' / ' + id)
    put(id, value)
  }
  for (const id of clears) {
    if (changed.has(id)) continue
    const row = effective(requireField(id)) as TeamConstraint
    if (row.kind !== 'ban' || (!row.exceptWhen && !row.exceptAny))
      issue('ENVIRONMENT_RULE_TARGET_MISSING', source + ' / ' + id)
    const { exceptWhen: _old, exceptAny: _others, ...clean } = row
    put(id, clean)
  }
  for (const row of local) {
    const prior = lookup(row.id)
    if (prior && [...prior.choices.values()].some(choice => choice.value !== null))
      issue('ENVIRONMENT_RULE_ALREADY_EXISTS', source + ' / ' + row.id)
    put(row.id, row)
  }
  for (const exception of edits.exceptions ?? []) {
    const field = requireField(exception.target)
    const row = effective(field) as TeamConstraint
    if (row.kind !== 'ban') issue('ENVIRONMENT_RULE_EXCEPTION_INVALID', source + ' / ' + row.id)
    const clauses = row.exceptAny ?? []
    if (!clauses.some(clause => canonical(clause) === canonical(exception.allOf)))
      put(row.id, { ...row, exceptAny: [...clauses, exception.allOf] })
  }
}

export function composeRuleSets(input: unknown, definitions: readonly unknown[], validate: ValidateRules) {
  const root = splitRuleDeclaration(input)
  const ruleSets = readEnvironmentRuleSets(definitions)
  const catalog = new Map(ruleSets.map(row => [row.id, row.rules]))
  const done = new Map<string, Fields>()
  const stack = new Set<string>()
  function visit(id: string): Fields {
    if (stack.has(id)) issue('ENVIRONMENT_RULE_CYCLE', [...stack, id].join(' → '))
    const cached = done.get(id)
    if (cached) return cached
    if (!catalog.has(id)) issue('ENVIRONMENT_RULE_SET_MISSING', [...stack, id].join(' → '))
    if (stack.size >= 128) issue('ENVIRONMENT_RULES_INVALID', '规则集引用超过 128 层')
    stack.add(id)
    const fields = combine(id, splitRuleDeclaration(catalog.get(id)))
    stack.delete(id)
    done.set(id, fields)
    return fields
  }
  function combine(source: string, declaration: typeof root): Fields {
    const fields: Fields = new Map()
    for (const id of [...declaration.include].sort())
      for (const field of visit(id).values())
        for (const choice of field.choices.values()) merge(fields, field.path, choice, field.sources)
    for (const collection of declaration.collections)
      merge(fields, ['collections', collection.id], { value: collection, sources: new Set([source]) }, [source], true)
    applyConstraintEdits(fields, source, declaration.edits, declaration.rules.constraints)
    const own = new Set<string>()
    for (const { path, value } of entries(declaration.rules)) {
      if (path[0] === 'constraints') continue
      const key = JSON.stringify(path)
      if (own.has(key)) issue('ENVIRONMENT_RULES_INVALID', source + ' / ' + path.join(' / '))
      own.add(key)
      merge(fields, path, { value, sources: new Set([source]) }, [source], true)
    }
    return fields
  }
  const fields = combine('$environment', root)
  const collections = new Map<string, RuleCollection>()
  for (const field of fields.values())
    if (field.path[0] === 'collections') collections.set(field.path[1]!, effective(field) as RuleCollection)
  function expandConstraint(row: DeclaredTeamConstraint): TeamConstraint {
    const expand = (selector: DeclaredTeamConstraint['allOf'][number]) => {
      const ids = new Set(selector.ids)
      for (const id of selector.fromCollections ?? []) {
        const collection = collections.get(id)
        if (!collection) issue('ENVIRONMENT_COLLECTION_MISSING', row.id + ' / ' + id)
        if (collection.kind !== selector.kind) issue('ENVIRONMENT_COLLECTION_KIND', row.id + ' / ' + id)
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
  const constraintDeclarations: DeclaredTeamConstraint[] = []
  const fieldsWithSources: { path: string[]; value: unknown; sources: string[]; effectiveSources: string[] }[] = []
  const result: Record<string, unknown> = { schemaVersion: root.rules.schemaVersion }
  for (const key of [...fields.keys()].sort()) {
    const field = fields.get(key)!
    const raw = effective(field)
    let value = raw
    if (raw && field.path[0] === 'constraints') {
      const declaration = raw as DeclaredTeamConstraint
      constraintDeclarations.push(declaration)
      value = expandConstraint(declaration)
    }
    if (field.path[0] !== 'collections' && !(field.path[0] === 'constraints' && value === null))
      writeField(result, field.path, value)
    const effectiveSources = new Set([...field.choices.values()].flatMap(choice => [...choice.sources]))
    fieldsWithSources.push({
      path: [...field.path],
      value,
      sources: [...field.sources].sort(),
      effectiveSources: [...effectiveSources].sort(),
    })
  }
  // Existing documents retain their original representation and revision.
  return {
    rules:
      root.include.length || root.collections.length || root.rules.constraints?.length || Object.keys(root.edits).length
        ? validate(result)
        : root.rules,
    declarations: { constraints: constraintDeclarations, collections: [...collections.values()] },
    fields: fieldsWithSources,
    ruleSets,
  }
}
