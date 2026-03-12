import type { TSchema } from '@sinclair/typebox'
import {
  type EntityKind,
  type ExtractorFieldMeta,
  type ExtractorRegistry,
  type ExtractorValueType,
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

type JsonSchemaNode = {
  type?: unknown
  properties?: Record<string, unknown>
  items?: unknown
  anyOf?: unknown[]
  oneOf?: unknown[]
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

const attributes: ExtractorRegistry['attributes'] = [
  { kind: 'attribute', key: 'maxHp', owners: ['pet'], valueType: 'number', modifiable: true },
  { kind: 'attribute', key: 'atk', owners: ['pet'], valueType: 'number', modifiable: true },
  { kind: 'attribute', key: 'def', owners: ['pet'], valueType: 'number', modifiable: true },
  { kind: 'attribute', key: 'spa', owners: ['pet'], valueType: 'number', modifiable: true },
  { kind: 'attribute', key: 'spd', owners: ['pet'], valueType: 'number', modifiable: true },
  { kind: 'attribute', key: 'spe', owners: ['pet'], valueType: 'number', modifiable: true },
  { kind: 'attribute', key: 'accuracy', owners: ['pet'], valueType: 'number', modifiable: true },
  { kind: 'attribute', key: 'evasion', owners: ['pet'], valueType: 'number', modifiable: true },
  { kind: 'attribute', key: 'critRate', owners: ['pet'], valueType: 'number', modifiable: true },
  { kind: 'attribute', key: 'ragePerTurn', owners: ['pet'], valueType: 'number', modifiable: true },
  { kind: 'attribute', key: 'weight', owners: ['pet'], valueType: 'number', modifiable: true },
  { kind: 'attribute', key: 'height', owners: ['pet'], valueType: 'number', modifiable: true },
  { kind: 'attribute', key: 'currentHp', owners: ['pet'], valueType: 'number', modifiable: true },
  { kind: 'attribute', key: 'isAlive', owners: ['pet'], valueType: 'boolean', modifiable: true },
  { kind: 'attribute', key: 'appeared', owners: ['pet', 'skill'], valueType: 'boolean', modifiable: true },
  { kind: 'attribute', key: 'name', owners: ['pet'], valueType: 'string', modifiable: true },
  { kind: 'attribute', key: 'speciesId', owners: ['pet'], valueType: 'string', modifiable: true },
  { kind: 'attribute', key: 'level', owners: ['pet'], valueType: 'number', modifiable: true },
  { kind: 'attribute', key: 'element', owners: ['pet', 'skill'], valueType: 'string', modifiable: true },
  { kind: 'attribute', key: 'gender', owners: ['pet'], valueType: 'string', modifiable: true },
  { kind: 'attribute', key: 'nature', owners: ['pet'], valueType: 'string', modifiable: true },
  { kind: 'attribute', key: 'power', owners: ['skill'], valueType: 'number', modifiable: true },
  { kind: 'attribute', key: 'accuracy', owners: ['skill'], valueType: 'number', modifiable: true },
  { kind: 'attribute', key: 'priority', owners: ['skill'], valueType: 'number', modifiable: true },
  { kind: 'attribute', key: 'rage', owners: ['skill'], valueType: 'number', modifiable: true },
  { kind: 'attribute', key: 'category', owners: ['skill'], valueType: 'string', modifiable: true },
  { kind: 'attribute', key: 'target', owners: ['skill'], valueType: 'string', modifiable: true },
  { kind: 'attribute', key: 'multihit', owners: ['skill'], valueType: 'object', modifiable: true },
  { kind: 'attribute', key: 'sureHit', owners: ['skill'], valueType: 'boolean', modifiable: true },
  { kind: 'attribute', key: 'sureCrit', owners: ['skill'], valueType: 'boolean', modifiable: true },
  { kind: 'attribute', key: 'ignoreShield', owners: ['skill'], valueType: 'boolean', modifiable: true },
  { kind: 'attribute', key: 'tags', owners: ['skill', 'mark'], valueType: 'object', modifiable: true },
  { kind: 'attribute', key: 'duration', owners: ['mark'], valueType: 'number', modifiable: true },
  { kind: 'attribute', key: 'stack', owners: ['mark'], valueType: 'number', modifiable: true },
  { kind: 'attribute', key: 'isActive', owners: ['mark'], valueType: 'boolean', modifiable: true },
  { kind: 'attribute', key: 'config', owners: ['mark'], valueType: 'object', modifiable: true },
  { kind: 'attribute', key: 'currentRage', owners: ['player'], valueType: 'number', modifiable: true },
  { kind: 'attribute', key: 'maxRage', owners: ['player'], valueType: 'number', modifiable: true },
]

const relations: ExtractorRegistry['relations'] = [
  { kind: 'relation', key: 'owner', owners: ['pet', 'skill', 'mark'], target: 'player', cardinality: 'one' },
  { kind: 'relation', key: 'skills', owners: ['pet'], target: 'skill', cardinality: 'many' },
  { kind: 'relation', key: 'marks', owners: ['pet', 'skill', 'player'], target: 'mark', cardinality: 'many' },
  { kind: 'relation', key: 'activePet', owners: ['player'], target: 'pet', cardinality: 'one' },
]

const autoFields = uniqueFields(
  (Object.entries(schemaByOwner) as Array<[EntityKind, TSchema | undefined]>)
    .flatMap(([owner, schema]) => (schema ? collectFieldMeta(owner, schema) : [])),
)

export const battleExtractorRegistry: ExtractorRegistry = {
  attributes,
  relations,
  fields: autoFields,
}

export function getBattleExtractorRegistry(): ExtractorRegistry {
  return battleExtractorRegistry
}
