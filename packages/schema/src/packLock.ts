import { Type, type Static } from '@sinclair/typebox'

export const LockProvenanceSchema = Type.Union([
  Type.Literal('npm'),
  Type.Literal('workspace'),
  Type.Literal('file'),
  Type.Literal('git'),
  Type.Literal('http'),
  Type.Literal('builtin'),
  Type.Literal('unknown'),
])

export const LockPackageKindSchema = Type.Union([Type.Literal('data'), Type.Literal('asset')])

export const LockResolutionSchema = Type.Object({
  integrity: Type.Optional(Type.String({ minLength: 1 })),
  resolved: Type.Optional(Type.String({ minLength: 1 })),
  tarball: Type.Optional(Type.String({ minLength: 1 })),
  path: Type.Optional(Type.String({ minLength: 1 })),
  commit: Type.Optional(Type.String({ minLength: 1 })),
})

export const LockImporterDependencySchema = Type.Object({
  specifier: Type.String({ minLength: 1 }),
  version: Type.String({ minLength: 1 }),
  packageKey: Type.String({ minLength: 1 }),
})

export const LockImporterSnapshotSchema = Type.Object({
  specifiers: Type.Optional(Type.Record(Type.String({ minLength: 1 }), Type.String({ minLength: 1 }))),
  dependencies: Type.Optional(Type.Record(Type.String({ minLength: 1 }), LockImporterDependencySchema)),
})

export const LockPackageSnapshotSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  version: Type.String({ minLength: 1 }),
  kind: LockPackageKindSchema,
  engine: Type.String({ minLength: 1 }),
  source: Type.String({ minLength: 1 }),
  entry: Type.String({ minLength: 1 }),
  provenance: LockProvenanceSchema,
  resolution: Type.Optional(LockResolutionSchema),
  dependencies: Type.Optional(Type.Record(Type.String({ minLength: 1 }), Type.String({ minLength: 1 }))),
})

export const PackLockfileSchema = Type.Object({
  lockfileVersion: Type.Literal(1),
  generatedAt: Type.String({ minLength: 1 }),
  importers: Type.Record(Type.String({ minLength: 1 }), LockImporterSnapshotSchema),
  packages: Type.Record(Type.String({ minLength: 1 }), LockPackageSnapshotSchema),
})

export type LockProvenance = Static<typeof LockProvenanceSchema>
export type LockPackageKind = Static<typeof LockPackageKindSchema>
export type LockResolution = Static<typeof LockResolutionSchema>
export type LockImporterDependency = Static<typeof LockImporterDependencySchema>
export type LockImporterSnapshot = Static<typeof LockImporterSnapshotSchema>
export type LockPackageSnapshot = Static<typeof LockPackageSnapshotSchema>
export type PackLockfile = Static<typeof PackLockfileSchema>

