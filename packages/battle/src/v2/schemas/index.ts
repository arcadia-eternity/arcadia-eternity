// battle/src/schemas/index.ts
// Re-export all schemas

export {
  StatOutBattleSchema,
  SpeciesSchema,
  type SpeciesData,
} from './species.schema.js'

export {
  PetSchema,
  type PetData,
} from './pet.schema.js'

export {
  MultihitSchema,
  BaseSkillSchema,
  SkillSchema,
  type BaseSkillData,
  type SkillData,
} from './skill.schema.js'

export {
  MarkConfigSchema,
  BaseMarkSchema,
  MarkSchema,
  type MarkConfigData,
  type BaseMarkData,
  type MarkData,
} from './mark.schema.js'

export {
  PlayerSchema,
  type PlayerData,
} from './player.schema.js'

export {
  UseSkillContextSchema,
  DamageContextSchema,
  HealContextSchema,
  RageContextSchema,
  AddMarkContextSchema,
  RemoveMarkContextSchema,
  SwitchPetContextSchema,
  StackContextSchema,
  ConsumeStackContextSchema,
  TransformContextSchema,
  TurnContextSchema,
  type UseSkillContextData,
  type DamageContextData,
  type HealContextData,
  type RageContextData,
  type AddMarkContextData,
  type RemoveMarkContextData,
  type SwitchPetContextData,
  type StackContextData,
  type ConsumeStackContextData,
  type TransformContextData,
  type TurnContextData,
} from './context.schema.js'
