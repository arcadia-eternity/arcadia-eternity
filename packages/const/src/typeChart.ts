import { Element, ELEMENT_CHART, ELEMENT_MAP } from './element'

export interface MatchupCell {
  attack: string
  defense: string
  multiplier: number
}
export interface ElementRelation {
  other: string
  direction: 'attack' | 'defense'
  multiplier: number
  whenNamespace?: string
}
export interface ElementDefinition {
  id: string
  name?: string
  emoji?: string
  relations?: ElementRelation[]
}
export interface MatchupTable {
  id: string
  name?: string
  cells: MatchupCell[]
}
export interface MatchupPolicy {
  table?: string
  adjustments?: MatchupCell[]
}
export interface ElementCatalogInput {
  elements?: readonly unknown[]
  matchupTables?: readonly unknown[]
}
const validId = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^[a-zA-Z0-9][\w.:/-]{0,255}$/.test(value) &&
  !['constructor', 'prototype', '__proto__'].includes(value)
const validMultiplier = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0
const validDefinition = (value: unknown): value is { id: string; name?: string } =>
  !!value &&
  typeof value === 'object' &&
  'id' in value &&
  validId(value.id) &&
  (!('name' in value) || (typeof value.name === 'string' && !!value.name.trim()))

export function legacyElements(): ElementDefinition[] {
  return Object.values(Element).map(id => ({ id, ...ELEMENT_MAP[id] }))
}
export function legacyMatchupTables(): MatchupTable[] {
  const cells = Object.entries(ELEMENT_CHART).flatMap(([attack, row]) =>
    Object.entries(row).map(([defense, multiplier]) => ({ attack, defense, multiplier })),
  )
  return [{ id: 'base:standard', name: '基础属性相克表', cells }]
}

function cells(input: unknown): MatchupCell[] {
  if (!Array.isArray(input) || input.length > 50000) throw new Error('INVALID_MATCHUP_CELLS')
  const seen = new Set<string>()
  return input.map((entry: MatchupCell) => {
    if (!entry || !validId(entry.attack) || !validId(entry.defense) || !validMultiplier(entry.multiplier))
      throw new Error('INVALID_MATCHUP_CELL')
    const key = entry.attack + '>' + entry.defense
    if (seen.has(key)) throw new Error('DUPLICATE_MATCHUP_CELL: ' + key)
    seen.add(key)
    return { attack: entry.attack, defense: entry.defense, multiplier: entry.multiplier }
  })
}

export function readElementCatalog(data: ElementCatalogInput) {
  const definitions = data.elements ?? legacyElements()
  const tables = data.matchupTables ?? (data.elements === undefined ? legacyMatchupTables() : [])
  if (!Array.isArray(definitions) || definitions.length > 10000 || !Array.isArray(tables) || tables.length > 1000)
    throw new Error('INVALID_ELEMENT_CATALOG')
  const ids = new Set<string>()
  const elements = definitions.map((element: ElementDefinition) => {
    if (
      !validDefinition(element) ||
      ids.has(element.id) ||
      (element.emoji !== undefined && typeof element.emoji !== 'string')
    )
      throw new Error('INVALID_ELEMENT: ' + element?.id)
    ids.add(element.id)
    return element
  })
  const check = (id: string) => {
    if (!ids.has(id)) throw new Error('UNKNOWN_ELEMENT: ' + id)
  }
  for (const element of elements) {
    if (element.relations === undefined) continue
    if (!Array.isArray(element.relations) || element.relations.length > 10000)
      throw new Error('INVALID_ELEMENT_RELATIONS')
    for (const relation of element.relations) {
      if (
        !relation ||
        !validId(relation.other) ||
        !['attack', 'defense'].includes(relation.direction) ||
        !validMultiplier(relation.multiplier) ||
        (relation.whenNamespace !== undefined &&
          (!validId(relation.whenNamespace) || !relation.other.startsWith(relation.whenNamespace + ':')))
      )
        throw new Error('INVALID_ELEMENT_RELATION: ' + element.id)
      if (!relation.whenNamespace || ids.has(relation.other)) check(relation.other)
    }
  }
  const tableIds = new Set<string>()
  const matchupTables = tables.map((table: MatchupTable) => {
    if (!validDefinition(table) || tableIds.has(table.id)) throw new Error('INVALID_MATCHUP_TABLE')
    tableIds.add(table.id)
    const entries = cells(table.cells)
    for (const entry of entries) {
      check(entry.attack)
      check(entry.defense)
    }
    return { id: table.id, ...(table.name !== undefined && { name: table.name }), cells: entries }
  })
  return { elements, matchupTables }
}

export function validateElementReferences(
  data: ElementCatalogInput & { species: readonly unknown[]; skills: readonly unknown[] },
) {
  const { elements } = readElementCatalog(data)
  const ids = new Set(elements.map(element => element.id))
  for (const records of [data.species, data.skills]) {
    for (const row of records) {
      const record = row as { element?: string; id?: string } | null
      if (record?.element !== undefined && !ids.has(record.element))
        throw new Error('UNKNOWN_ELEMENT: ' + record.id + ' → ' + record.element)
    }
  }
}

export function resolveElementChart(input: ElementCatalogInput, policy: MatchupPolicy = {}) {
  const { elements, matchupTables } = readElementCatalog(input)
  const ids = new Set(elements.map(entry => entry.id))
  const byCell = new Map<string, Array<{ source: string; value: number }>>()
  const keyOf = (attack: string, defense: string) => attack + '>' + defense
  for (const element of elements) {
    for (const relation of element.relations ?? []) {
      if (relation.whenNamespace && !ids.has(relation.other)) continue
      const key =
        relation.direction === 'attack' ? keyOf(element.id, relation.other) : keyOf(relation.other, element.id)
      const sources = byCell.get(key) ?? []
      sources.push({ source: element.id, value: relation.multiplier })
      byCell.set(key, sources)
    }
  }
  const tableId =
    policy.table ?? (matchupTables.some(table => table.id === 'base:standard') ? 'base:standard' : undefined)
  const table = matchupTables.find(entry => entry.id === tableId)
  if (tableId && !table) throw new Error('UNKNOWN_MATCHUP_TABLE: ' + tableId)
  const values: Record<string, Record<string, number>> = Object.fromEntries(
    elements.map(element => [element.id, Object.create(null)]),
  )
  const sources = new Map<string, string[]>()
  for (const cell of table?.cells ?? []) {
    values[cell.attack][cell.defense] = cell.multiplier
    sources.set(keyOf(cell.attack, cell.defense), [table!.id])
  }
  const adjustments = cells(policy.adjustments ?? [])
  const overrides = new Set(adjustments.map(cell => keyOf(cell.attack, cell.defense)))
  const conflicts: Array<{ attack: string; defense: string; proposals: Array<{ source: string; value: number }> }> = []
  for (const [key, proposals] of byCell) {
    const [attack, defense] = key.split('>')
    if (overrides.has(key)) continue
    if (proposals.some(row => row.value !== proposals[0].value)) {
      conflicts.push({ attack, defense, proposals })
      continue
    }
    values[attack][defense] = proposals[0].value
    sources.set(
      key,
      proposals.map(row => row.source),
    )
  }
  for (const cell of adjustments) {
    if (!ids.has(cell.attack) || !ids.has(cell.defense))
      throw new Error('UNKNOWN_MATCHUP_CELL: ' + keyOf(cell.attack, cell.defense))
    values[cell.attack][cell.defense] = cell.multiplier
    sources.set(keyOf(cell.attack, cell.defense), ['environment'])
  }
  return { values, sources, conflicts }
}

export function requireElementChart(data: ElementCatalogInput, policy?: MatchupPolicy) {
  const { conflicts, values } = resolveElementChart(data, policy)
  if (conflicts.length)
    throw new Error(
      '属性相克冲突：' +
        conflicts
          .map(
            cell =>
              cell.attack +
              ' → ' +
              cell.defense +
              ' (' +
              cell.proposals.map(row => row.source + ' ' + row.value).join('、') +
              ')',
          )
          .join('；'),
    )
  return values
}
