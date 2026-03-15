import { Type, type Static } from '@sinclair/typebox'

export const AssetEngineSchema = Type.Literal('seer2-v2')

export const AssetTypeSchema = Type.Union([
  Type.Literal('petSwf'),
  Type.Literal('petSfx'),
  Type.Literal('petSprite'),
  Type.Literal('petPortrait'),
  Type.Literal('markIcon'),
  Type.Literal('skillSfx'),
  Type.Literal('bgm'),
  Type.Literal('uiImage'),
  Type.Literal('misc'),
])

export const AssetEntrySchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  type: AssetTypeSchema,
  uri: Type.String({ minLength: 1 }),
  integrity: Type.Optional(Type.String({ minLength: 1 })),
  mimeType: Type.Optional(Type.String({ minLength: 1 })),
  tags: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  meta: Type.Optional(Type.Record(Type.String({ minLength: 1 }), Type.Unknown())),
})

export const AssetMappingsSchema = Type.Object({
  species: Type.Optional(Type.Record(Type.String({ minLength: 1 }), Type.String({ minLength: 1 }))),
  marks: Type.Optional(Type.Record(Type.String({ minLength: 1 }), Type.String({ minLength: 1 }))),
  skills: Type.Optional(Type.Record(Type.String({ minLength: 1 }), Type.String({ minLength: 1 }))),
})

export const AssetManifestSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  version: Type.String({ minLength: 1 }),
  engine: AssetEngineSchema,
  dependencies: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  assets: Type.Array(AssetEntrySchema),
  mappings: Type.Optional(AssetMappingsSchema),
})

export const AssetLockEntrySchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  version: Type.String({ minLength: 1 }),
  integrity: Type.String({ minLength: 1 }),
  source: Type.String({ minLength: 1 }),
})

export const AssetLockSchema = Type.Object({
  lockVersion: Type.Literal(1),
  engine: AssetEngineSchema,
  assets: Type.Array(AssetLockEntrySchema, { minItems: 1 }),
})

export type AssetEntry = Static<typeof AssetEntrySchema>
export type AssetManifest = Static<typeof AssetManifestSchema>
export type AssetLockEntry = Static<typeof AssetLockEntrySchema>
export type AssetLock = Static<typeof AssetLockSchema>
