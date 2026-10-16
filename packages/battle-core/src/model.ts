export interface Seir2Species {
  id: string
  name: string
  maxHp: number
  attack: number
  defense: number
  speed: number
}

export interface Skill {
  id: string
  name: string
  /** Base power used by this first executable core slice. */
  power: number
  accuracy: number
  rageCost: number
  priority?: number
  target: 'opponent' | 'self'
}

export type Seir2Skill = Skill

export interface Mark {
  id: string
  definitionId: string
  ownerPetId: string
  stacks: number
  turnsRemaining: number | null
  active: boolean
}

export interface BattleContent {
  species: Seir2Species[]
  skills: Skill[]
}

export interface PetSetup {
  id: string
  speciesId: string
  skillIds: string[]
}

export interface PlayerSetup {
  id: string
  name: string
  team: PetSetup[]
}

export interface Pet {
  id: string
  speciesId: string
  skillIds: string[]
  hp: number
  marks: Mark[]
}

export interface Player {
  id: string
  name: string
  petIds: string[]
  activePetId: string
  rage: number
}

export type BattleAction = { type: 'use-skill'; skillId: string } | { type: 'switch-pet'; petId: string }

export type BattlePhase =
  | { type: 'selection' }
  | { type: 'turn-resolution' }
  | { type: 'forced-switch'; playerIds: string[] }
  | { type: 'ended' }

export type Phase = BattlePhase

export interface BattleState {
  id: string
  seed: number
  rngState: number
  turn: number
  phase: BattlePhase
  winnerId: string | null
  players: Player[]
  pets: Pet[]
  pendingActions: Record<string, BattleAction>
  actionLog: LoggedAction[]
  events: BattleEvent[]
}

export interface LoggedAction {
  index: number
  turn: number
  playerId: string
  action: BattleAction
}

export type BattleEvent =
  | { sequence: number; turn: number; type: 'battle-started'; battleId: string }
  | { sequence: number; turn: number; type: 'action-submitted'; playerId: string; action: BattleAction }
  | {
      sequence: number
      turn: number
      type: 'pet-switched'
      playerId: string
      fromPetId: string
      toPetId: string
      rage: number
    }
  | {
      sequence: number
      turn: number
      type: 'skill-used'
      playerId: string
      petId: string
      skillId: string
      targetPetId: string
    }
  | { sequence: number; turn: number; type: 'skill-missed'; playerId: string; skillId: string; targetPetId: string }
  | {
      sequence: number
      turn: number
      type: 'damage'
      sourcePetId: string
      targetPetId: string
      amount: number
      hp: number
    }
  | { sequence: number; turn: number; type: 'pet-fainted'; playerId: string; petId: string }
  | { sequence: number; turn: number; type: 'turn-ended'; rage: Record<string, number> }
  | { sequence: number; turn: number; type: 'battle-ended'; winnerId: string | null }
  | { sequence: number; turn: number; type: 'phase-changed'; phase: BattlePhase }

export interface BattleSnapshot {
  schemaVersion: 1
  content: BattleContent
  state: BattleState
}

export interface BattleReplay {
  schemaVersion: 1
  initial: BattleSnapshot
  actions: Array<{ playerId: string; action: BattleAction }>
  expectedEvents: BattleEvent[]
}

export interface CreateBattleOptions {
  id: string
  seed: number
  content: BattleContent
  players: [PlayerSetup, PlayerSetup]
}

export type BattleEventListener = (event: BattleEvent) => void
export type BattleEventInput = BattleEvent extends infer Event
  ? Event extends BattleEvent
    ? Omit<Event, 'sequence' | 'turn'>
    : never
  : never
