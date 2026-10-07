import type { TSchema } from '@sinclair/typebox'
import {
  type EntityKind,
  type ExtractorFieldMeta,
  type ExtractorRegistry,
  type ExtractorValueType,
  type StringEnumOption,
} from '@arcadia-eternity/schema'
import { PetSchema } from '../schemas/pet.schema.js'
import { SkillSchema } from '../schemas/skill.schema.js'
import { MarkSchema } from '../schemas/mark.schema.js'
import { PlayerSchema } from '../schemas/player.schema.js'
import {
  UseSkillContextSchema,
  DamageContextSchema,
  HealContextSchema,
  RageContextSchema,
  AddMarkContextSchema,
  SwitchPetContextSchema,
  TurnContextSchema,
  StackContextSchema,
  ConsumeStackContextSchema,
} from '../schemas/context.schema.js'
import { petAttributes } from './pet.system.js'
import { skillAttributes } from './skill.system.js'
import { markAttributes } from './mark.system.js'
import { playerAttributes } from './player.system.js'

type JsonSchemaNode = {
  type?: unknown
  properties?: Record<string, unknown>
  items?: unknown
  anyOf?: unknown[]
  oneOf?: unknown[]
  const?: unknown
}

function asNode(value: unknown): JsonSchemaNode | undefined {
  return typeof value === 'object' && value !== null ? (value as JsonSchemaNode) : undefined
}

function inferValueType(schema: unknown): ExtractorValueType {
  const node = asNode(schema)
  const type = typeof node?.type === 'string' ? node.type : undefined
  if (type === 'number' || type === 'integer') return 'number'
  if (type === 'string') return 'string'
  if (type === 'boolean') return 'boolean'
  if (type === 'array') {
    const itemType = typeof asNode(node?.items)?.type === 'string' ? (asNode(node?.items)?.type as string) : ''
    if (itemType === 'string') return 'id[]'
    return 'object'
  }
  if (type === 'object') return 'object'

  const variants = [...(node?.anyOf ?? []), ...(node?.oneOf ?? [])]
  if (variants.length > 0) {
    const inferred = variants.map(inferValueType)
    if (inferred.every(v => v === inferred[0])) return inferred[0]
  }
  return 'unknown'
}

function extractStringEnumOptions(schema: unknown): StringEnumOption[] | undefined {
  const node = asNode(schema)
  if (!node?.anyOf || !Array.isArray(node.anyOf) || node.anyOf.length === 0) return undefined

  const options: StringEnumOption[] = []
  for (const variant of node.anyOf) {
    const v = asNode(variant)
    if (!v || v.type !== 'string' || typeof v.const !== 'string') return undefined
    options.push({ value: v.const, label: v.const })
  }

  return options.length > 0 ? options : undefined
}

function collectFieldMeta(owner: EntityKind, schema: unknown, prefix = '', depth = 0): ExtractorFieldMeta[] {
  if (depth > 4) return []
  const node = asNode(schema)
  if (!node) return []

  const fields: ExtractorFieldMeta[] = []
  const properties = node.properties ?? {}
  for (const [key, child] of Object.entries(properties)) {
    const path = prefix ? `${prefix}.${key}` : key
    fields.push({
      kind: 'field',
      path,
      owners: [owner],
      valueType: inferValueType(child),
      readonly: true,
      enumOptions: extractStringEnumOptions(child),
    })
    const childNode = asNode(child)
    if (childNode?.type === 'object' && childNode.properties) {
      fields.push(...collectFieldMeta(owner, childNode, path, depth + 1))
    }
    if (childNode?.type === 'array') {
      const itemNode = asNode(childNode.items)
      if (itemNode?.type === 'object' && itemNode.properties) {
        fields.push(...collectFieldMeta(owner, itemNode, `${path}[]`, depth + 1))
      }
    }
  }
  return fields
}

function uniqueFields(fields: ExtractorFieldMeta[]): ExtractorFieldMeta[] {
  const map = new Map<string, ExtractorFieldMeta>()
  for (const field of fields) {
    const owners = [...field.owners].sort().join('|')
    map.set(`${owners}:${field.path}`, field)
  }
  return [...map.values()]
}

const schemaByOwner: Record<EntityKind, TSchema | undefined> = {
  pet: PetSchema,
  skill: SkillSchema,
  mark: MarkSchema,
  player: PlayerSchema,
  battle: undefined,
  useSkillContext: UseSkillContextSchema,
  damageContext: DamageContextSchema,
  healContext: HealContextSchema,
  rageContext: RageContextSchema,
  addMarkContext: AddMarkContextSchema,
  switchPetContext: SwitchPetContextSchema,
  turnContext: TurnContextSchema,
  stackContext: StackContextSchema,
  consumeStackContext: ConsumeStackContextSchema,
}

// Attributes aggregated from each system's own declarations.
// Each system file (pet.system.ts, skill.system.ts, etc.) exports its attribute
// list as the single source of truth — no duplication.
const attributes: ExtractorRegistry['attributes'] = [
  ...petAttributes.map(a => ({
    kind: 'attribute' as const,
    key: a.key,
    owners: ['pet'] as EntityKind[],
    valueType: a.valueType,
    modifiable: a.modifiable,
  })),
  ...skillAttributes.map(a => ({
    kind: 'attribute' as const,
    key: a.key,
    owners: ['skill'] as EntityKind[],
    valueType: a.valueType,
    modifiable: a.modifiable,
  })),
  ...markAttributes.map(a => ({
    kind: 'attribute' as const,
    key: a.key,
    owners: ['mark'] as EntityKind[],
    valueType: a.valueType,
    modifiable: a.modifiable,
  })),
  ...playerAttributes.map(a => ({
    kind: 'attribute' as const,
    key: a.key,
    owners: ['player'] as EntityKind[],
    valueType: a.valueType,
    modifiable: a.modifiable,
  })),
]

const relations: ExtractorRegistry['relations'] = [
  { kind: 'relation', key: 'owner', owners: ['pet', 'skill', 'mark'], target: 'player', cardinality: 'one' },
  { kind: 'relation', key: 'skills', owners: ['pet'], target: 'skill', cardinality: 'many' },
  { kind: 'relation', key: 'marks', owners: ['pet', 'skill', 'player'], target: 'mark', cardinality: 'many' },
  { kind: 'relation', key: 'activePet', owners: ['player'], target: 'pet', cardinality: 'one' },
]

const autoFields = uniqueFields(
  (Object.entries(schemaByOwner) as Array<[EntityKind, TSchema | undefined]>).flatMap(([owner, schema]) =>
    schema ? collectFieldMeta(owner, schema) : [],
  ),
)

export const battleExtractorRegistry: ExtractorRegistry = {
  attributes,
  relations,
  fields: autoFields,
}

export function getBattleExtractorRegistry(): ExtractorRegistry {
  return battleExtractorRegistry
}
