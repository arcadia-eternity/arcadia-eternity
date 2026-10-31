import { Type, type Static } from '@sinclair/typebox'

export const ResourceReferenceSchema = Type.Union([
  Type.String({ minLength: 1 }),
  Type.Object(
    { namespace: Type.String({ minLength: 1 }), id: Type.String({ minLength: 1 }) },
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
      tags: Type.Optional(Type.Array(Type.String())),
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
      tags: Type.Optional(Type.Array(Type.String())),
      id: Type.String({ minLength: 1 }),
      source: Type.String({ pattern: '^https?://' }),
      mime: Type.Optional(ResourceMimeSchema),
    },
    { additionalProperties: false },
  ),
])

export const ResourceDefinitionSchema = Type.Object(
  {
    id: Type.String({ pattern: '^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$' }),
    kind: Type.Union([Type.Literal('image'), Type.Literal('audio'), Type.Literal('swf')]),
    source: Type.String({ minLength: 1 }),
    name: Type.Optional(Type.String()),
    tags: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
)
export const PresentationBindingSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    target: Type.Object(
      {
        kind: Type.Union([Type.Literal('species'), Type.Literal('skills'), Type.Literal('marks')]),
        id: Type.String({ minLength: 1 }),
      },
      { additionalProperties: false },
    ),
    ...ContentPresentationSchema.properties,
  },
  { additionalProperties: false },
)
export const ResourceDataSetSchema = Type.Array(ResourceDefinitionSchema)
export const PresentationDataSetSchema = Type.Array(PresentationBindingSchema)
export const PresentationManifestSchema = Type.Object(
  {
    version: Type.Literal(2),
    bindings: PresentationDataSetSchema,
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
