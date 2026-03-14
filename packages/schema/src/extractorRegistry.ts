import { Type, type Static } from '@sinclair/typebox'
import { parseWithErrors, StringEnum } from './utils'

/**
 * Runtime entity kinds used by selector/extractor typing.
 * Keep this list in sync with battle-side selector base typing.
 */
export const EntityKindSchema = StringEnum([
  'pet',
  'skill',
  'mark',
  'player',
  'battle',
  'useSkillContext',
  'damageContext',
  'healContext',
  'rageContext',
  'addMarkContext',
  'switchPetContext',
  'turnContext',
  'stackContext',
  'consumeStackContext',
] as const)

export type EntityKind = Static<typeof EntityKindSchema>

export const ExtractorValueTypeSchema = StringEnum([
  'number',
  'string',
  'boolean',
  'id',
  'id[]',
  'unknown',
  'object',
] as const)

export type ExtractorValueType = Static<typeof ExtractorValueTypeSchema>

export const ExtractorAttributeMetaSchema = Type.Object(
  {
    kind: Type.Literal('attribute'),
    key: Type.String({ minLength: 1 }),
    owners: Type.Array(EntityKindSchema, { minItems: 1 }),
    valueType: ExtractorValueTypeSchema,
    modifiable: Type.Boolean(),
    tags: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
)

export const ExtractorFieldMetaSchema = Type.Object(
  {
    kind: Type.Literal('field'),
    path: Type.String({ minLength: 1 }),
    owners: Type.Array(EntityKindSchema, { minItems: 1 }),
    valueType: ExtractorValueTypeSchema,
    readonly: Type.Optional(Type.Boolean()),
    tags: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
)

export const ExtractorRelationMetaSchema = Type.Object(
  {
    kind: Type.Literal('relation'),
    key: Type.String({ minLength: 1 }),
    owners: Type.Array(EntityKindSchema, { minItems: 1 }),
    target: EntityKindSchema,
    cardinality: StringEnum(['one', 'many'] as const),
    tags: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
)

export const ExtractorRegistrySchema = Type.Object(
  {
    attributes: Type.Array(ExtractorAttributeMetaSchema),
    fields: Type.Array(ExtractorFieldMetaSchema),
    relations: Type.Array(ExtractorRelationMetaSchema),
  },
  { additionalProperties: false },
)

export type ExtractorAttributeMeta = Static<typeof ExtractorAttributeMetaSchema>
export type ExtractorFieldMeta = Static<typeof ExtractorFieldMetaSchema>
export type ExtractorRelationMeta = Static<typeof ExtractorRelationMetaSchema>
export type ExtractorRegistry = Static<typeof ExtractorRegistrySchema>

/**
 * Parse + validate registry with default-clean/convert behavior.
 * This is intended as the editor/runtime shared entrypoint.
 */
export function parseExtractorRegistry(data: unknown): ExtractorRegistry {
  return parseWithErrors(ExtractorRegistrySchema, data)
}

