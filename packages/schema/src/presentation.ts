import { Type, type Static } from '@sinclair/typebox'

export const ResourceReferenceSchema = Type.Union([
  Type.String({ minLength: 1 }),
  Type.Object(
    { namespace: Type.String({ minLength: 1 }), path: Type.String({ minLength: 1 }) },
    { additionalProperties: false },
  ),
])

export const ContentPresentationSchema = Type.Object(
  {
    icon: Type.Optional(ResourceReferenceSchema),
    portrait: Type.Optional(ResourceReferenceSchema),
    cry: Type.Optional(ResourceReferenceSchema),
    sfx: Type.Optional(ResourceReferenceSchema),
    background: Type.Optional(ResourceReferenceSchema),
    music: Type.Optional(ResourceReferenceSchema),
    battle: Type.Optional(
      Type.Object(
        {
          renderer: Type.Union([Type.Literal('image'), Type.Literal('seer2-swf')]),
          source: ResourceReferenceSchema,
          fallback: Type.Optional(ResourceReferenceSchema),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
)

const ResourceMimeSchema = Type.Union(
  ['image/png', 'image/jpeg', 'image/webp', 'audio/ogg', 'audio/mpeg', 'application/x-shockwave-flash'].map(value =>
    Type.Literal(value),
  ),
)
export const PresentationResourceSchema = Type.Union([
  Type.Object(
    {
      kind: Type.Literal('file'),
      id: Type.String({ minLength: 1 }),
      source: Type.String({ minLength: 1 }),
      sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
      bytes: Type.Integer({ minimum: 1, maximum: 64 * 1024 * 1024 }),
      mime: ResourceMimeSchema,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal('http'),
      id: Type.String({ minLength: 1 }),
      source: Type.String({ pattern: '^https?://' }),
      mime: Type.Optional(ResourceMimeSchema),
    },
    { additionalProperties: false },
  ),
])

export const PresentationManifestSchema = Type.Object(
  {
    version: Type.Literal(1),
    defaultLocale: Type.String({ minLength: 1 }),
    resources: Type.Array(PresentationResourceSchema, { maxItems: 4096 }),
    locales: Type.Record(Type.String(), Type.Record(Type.String(), Type.Record(Type.String(), Type.Unknown()))),
  },
  { additionalProperties: false },
)

export type ResourceReference = Static<typeof ResourceReferenceSchema>
export type ContentPresentation = Static<typeof ContentPresentationSchema>
export type PresentationResource = Static<typeof PresentationResourceSchema>
export type PresentationManifest = Static<typeof PresentationManifestSchema>
