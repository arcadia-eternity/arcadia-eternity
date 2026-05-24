// battle/src/v2/types/phase-registry.ts
// Maps phase handler type strings to their TData types.
// Threaded through PhaseManager as the TRegistry generic.

import type { BattleStartData } from '../phases/battle-start.handler.js'
import type { BattleSwitchPhaseData } from '../phases/battle-switch.handler.js'
import type { TurnData } from '../phases/turn.handler.js'
import type { SkillPhaseData } from '../phases/skill.handler.js'
import type { SwitchPhaseData } from '../phases/switch.handler.js'
import type { DamagePhaseData } from '../phases/damage.handler.js'
import type { HealPhaseData } from '../phases/heal.handler.js'
import type { RagePhaseData } from '../phases/rage.handler.js'
import type { AddMarkPhaseData } from '../phases/add-mark.handler.js'
import type { RemoveMarkPhaseData } from '../phases/remove-mark.handler.js'
import type { MarkUpdatePhaseData } from '../phases/mark-update.handler.js'
import type { MarkCleanupPhaseData } from '../phases/mark-cleanup.handler.js'
import type { StatStagePhaseData } from '../phases/stat-stage.handler.js'
import type { SelectionData } from '../phases/selection.handler.js'

interface HandlerTypeToDataMap {
  battleStart: BattleStartData
  battleSwitch: BattleSwitchPhaseData
  selection: SelectionData
  turn: TurnData
  skill: SkillPhaseData
  switch: SwitchPhaseData
  damage: DamagePhaseData
  heal: HealPhaseData
  rage: RagePhaseData
  addMark: AddMarkPhaseData
  removeMark: RemoveMarkPhaseData
  markUpdate: MarkUpdatePhaseData
  markCleanup: MarkCleanupPhaseData
  statStage: StatStagePhaseData
}

type HandlerTypes = keyof HandlerTypeToDataMap

type HandlerDataFor<K extends HandlerTypes> = HandlerTypeToDataMap[K]

export type PhaseRegistry = Record<string, unknown> & {
  [K in HandlerTypes]: HandlerDataFor<K>
}
