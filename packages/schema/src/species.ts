import { Type, type Static } from '@sinclair/typebox'
import { Element } from './element'
import { withUIHint } from './uiMetadata'

export const LearnableSkillSchema = Type.Object({
  skill_id: Type.String(),
  level: Type.Number({ default: 1 }),
  hidden: Type.Boolean({ default: false }),
})

export const SpeciesSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  num: Type.Number({ default: 0 }),
  assetRef: Type.Optional(Type.String()),
  element: Type.Union(
    Object.values(Element).map(v => Type.Literal(v)),
    {
      default: Element.Normal,
    },
  ),
  baseStats: withUIHint(
    Type.Object(
      {
        hp: Type.Number({ default: 100 }),
        atk: Type.Number({ default: 100 }),
        spa: Type.Number({ default: 100 }),
        def: Type.Number({ default: 100 }),
        spd: Type.Number({ default: 100 }),
        spe: Type.Number({ default: 100 }),
      },
      {
        default: {
          hp: 100,
          atk: 100,
          spa: 100,
          def: 100,
          spd: 100,
          spe: 100,
        },
      },
    ),
    { display: 'inline' },
  ),
  genderRatio: Type.Union([Type.Tuple([Type.Number(), Type.Number()]), Type.Null()], {
    default: [50, 50],
  }),
  heightRange: Type.Tuple([Type.Number(), Type.Number()], {
    default: [10, 20],
  }),
  weightRange: Type.Tuple([Type.Number(), Type.Number()], {
    default: [10, 20],
  }),
  learnable_skills: withUIHint(Type.Array(LearnableSkillSchema, { default: [] }), {
    display: 'inline',
    itemLabel: 'skill_id',
    collapsible: true,
    collapsed: true,
  }),
  ability: withUIHint(Type.Array(Type.String(), { default: [] }), { display: 'inline' }),
  emblem: withUIHint(Type.Array(Type.String(), { default: [] }), { display: 'inline' }),
})

export type LearnableSkill = Static<typeof LearnableSkillSchema>

export type SpeciesSchemaType = Static<typeof SpeciesSchema>

export const SpeciesDataSetSchema = Type.Array(SpeciesSchema)

export type SpeciesDataSet = Static<typeof SpeciesDataSetSchema>
