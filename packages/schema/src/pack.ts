import { Type, type Static } from '@sinclair/typebox'

export const PackEngineSchema = Type.Literal('seer2-v2')

export const PackDependencySchema = Type.Object({
  path: Type.String({ minLength: 1 }),
  id: Type.Optional(Type.String({ minLength: 1 })),
  optional: Type.Optional(Type.Boolean()),
})

export const PackPathsSchema = Type.Object({
  dataDir: Type.Optional(Type.String({ minLength: 1 })),
  localesDir: Type.Optional(Type.String({ minLength: 1 })),
})

export const PackDataFilesSchema = Type.Object({
  effects: Type.Array(Type.String({ minLength: 1 })),
  marks: Type.Array(Type.String({ minLength: 1 })),
  skills: Type.Array(Type.String({ minLength: 1 })),
  species: Type.Array(Type.String({ minLength: 1 })),
})

export const PackLocaleEntrySchema = Type.Object({
  locale: Type.String({ minLength: 1 }),
  files: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  namespaces: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
})

export const PackLocalesSchema = Type.Union([
  Type.Record(Type.String({ minLength: 1 }), Type.Array(Type.String({ minLength: 1 }))),
  Type.Array(PackLocaleEntrySchema),
])

export const PackManifestSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  version: Type.String({ minLength: 1 }),
  engine: PackEngineSchema,
  engineRange: Type.Optional(Type.String({ minLength: 1 })),
  assetsRef: Type.Optional(
    Type.Union([
      Type.String({ minLength: 1 }),
      Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
    ]),
  ),
  layoutVersion: Type.Optional(Type.Literal(1)),
  dependencies: Type.Optional(Type.Array(PackDependencySchema)),
  paths: Type.Optional(PackPathsSchema),
  data: PackDataFilesSchema,
  locales: Type.Optional(PackLocalesSchema),
})

export const PackLockEntrySchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  version: Type.String({ minLength: 1 }),
  integrity: Type.String({ minLength: 1 }),
  source: Type.String({ minLength: 1 }),
})

export const PackLockSchema = Type.Object({
  lockVersion: Type.Literal(1),
  engine: PackEngineSchema,
  packs: Type.Array(PackLockEntrySchema, { minItems: 1 }),
})

export type PackDependency = Static<typeof PackDependencySchema>
export type PackManifest = Static<typeof PackManifestSchema>
export type PackLockEntry = Static<typeof PackLockEntrySchema>
export type PackLock = Static<typeof PackLockSchema>
