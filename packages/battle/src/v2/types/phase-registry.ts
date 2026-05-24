// battle/src/v2/types/phase-registry.ts
// Maps phase handler type strings to their TData types.
// Threaded through PhaseManager as the TRegistry generic.

import type {
  UseSkillContextData,
  DamageContextData,
  HealContextData,
  RageContextData,
  AddMarkContextData,
  RemoveMarkContextData,
  SwitchPetContextData,
} from '../schemas/context.schema.js'

export type PhaseRegistry = Record<string, unknown> & {
  battleStart: { playerAId: string; playerBId: string }
  battleSwitch: {
    selectionSystem: unknown
    decisionManager: unknown
  }
  selection: unknown
  turn: { selections: unknown }
  skill: { context: UseSkillContextData }
  switch: { context: SwitchPetContextData }
  damage: { context: DamageContextData }
  heal: { context: HealContextData }
  rage: { context: RageContextData }
  addMark: { context: AddMarkContextData }
  removeMark: { context: RemoveMarkContextData }
  markUpdate: { markId: string }
  markCleanup: Record<string, never>
  statStage: { stat: string; stage: number; targetId: string }
}
