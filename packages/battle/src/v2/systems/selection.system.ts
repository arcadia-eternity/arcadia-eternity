// battle/src/v2/systems/selection.system.ts
// SelectionSystem — manages player selections during battle.

import type { World } from '@arcadia-eternity/engine'
import type {
  PlayerSelection,
  UseSkillSelection,
  playerId,
  petId,
  skillId,
} from '@arcadia-eternity/const'
import { AttackTargetOpinion } from '@arcadia-eternity/const'
import type { PlayerSystem } from './player.system.js'
import type { SkillSystem } from './skill.system.js'
import type { PetSystem } from './pet.system.js'

// ---------------------------------------------------------------------------
// SelectionSystem
// ---------------------------------------------------------------------------

export class SelectionSystem {
  private waitResolve: ((selections: Record<string, PlayerSelection>) => void) | null = null
  private waitReject: ((reason: unknown) => void) | null = null
  private abortController: AbortController | null = null

  constructor(
    private playerSystem: PlayerSystem,
    private petSystem: PetSystem,
    private skillSystem: SkillSystem,
  ) {}

  // -----------------------------------------------------------------------
  // Selection storage (world.state.selections)
  // -----------------------------------------------------------------------

  setSelection(world: World, pid: string, selection: PlayerSelection): boolean {
    const selections = this.getSelections(world)
    selections[pid] = selection
    world.state.selections = selections
    this.checkAndResolve(world)
    return true
  }

  clearSelections(world: World): void {
    world.state.selections = {}
  }

  getSelection(world: World, pid: string): PlayerSelection | null {
    const selections = this.getSelections(world)
    return (selections[pid] as PlayerSelection) ?? null
  }

  private getSelections(world: World): Record<string, PlayerSelection> {
    if (!world.state.selections) {
      world.state.selections = {}
    }
    return world.state.selections as Record<string, PlayerSelection>
  }

  // -----------------------------------------------------------------------
  // Available selections (ported from v1 Player.getAvailableSelection)
  // -----------------------------------------------------------------------

  getAvailableSelections(world: World, pid: string): PlayerSelection[] {
    const phase = world.state.currentPhase as string | undefined
    const player = this.playerSystem.getOrThrow(world, pid)
    const selections: PlayerSelection[] = []
    const pId = pid as unknown as playerId

    if (phase === 'switch') {
      // Forced switch: only switch-pet and surrender
      const isForcedSwitch = (world.state.pendingForcedSwitchPlayerIds as string[] ?? []).includes(pid)
      const isFaintSwitch = world.state.pendingFaintSwitchPlayerId === pid

      if (isFaintSwitch && !isForcedSwitch) {
        // Faint switch reward: can do nothing or switch
        selections.push({ player: pId, type: 'do-nothing' })
      }

      const switchPets = this.playerSystem.getAvailableSwitchPets(world, pid)
      for (const pet of switchPets) {
        selections.push({ player: pId, type: 'switch-pet', pet: pet.id as unknown as petId })
      }

      selections.push({ player: pId, type: 'surrender' })
      return selections
    }

    if (phase === 'teamSelection') {
      const fullTeam = [...player.fullTeamPetIds]
      if (fullTeam.length === 0) {
        selections.push({ player: pId, type: 'surrender' })
        return selections
      }
      selections.push({
        player: pId,
        type: 'team-selection',
        selectedPets: fullTeam as unknown as petId[],
        starterPetId: fullTeam[0] as unknown as petId,
      })
      selections.push({ player: pId, type: 'surrender' })
      return selections
    }

    // Normal selection phase
    const activePet = this.playerSystem.getActivePet(world, pid)
    const currentRage = this.playerSystem.getRage(world, pid)

    // Available skills (filtered by rage)
    const availableSkills: UseSkillSelection[] = []
    for (const sid of activePet.skillIds) {
        const skillRage = this.skillSystem.getRage(world, sid)
        if (skillRage <= currentRage) {
          const rawTarget = this.skillSystem.getTarget(world, sid)
          const normalizedTarget =
            rawTarget === AttackTargetOpinion.self ? AttackTargetOpinion.self : AttackTargetOpinion.opponent
          availableSkills.push({
            player: pId,
            type: 'use-skill',
            skill: sid as unknown as skillId,
            target: normalizedTarget,
          })
        }
      }

    selections.push(...availableSkills)

    // Available switch pets
    const switchPets = this.playerSystem.getAvailableSwitchPets(world, pid)
    for (const pet of switchPets) {
      selections.push({ player: pId, type: 'switch-pet', pet: pet.id as unknown as petId })
    }

    // If no skills available, allow do-nothing
    if (availableSkills.length === 0) {
      selections.push({ player: pId, type: 'do-nothing' })
    }

    selections.push({ player: pId, type: 'surrender' })
    return selections
  }

  // -----------------------------------------------------------------------
  // Async waiting (ported from v1 Battle.waitForBothPlayersReady)
  // -----------------------------------------------------------------------

  waitForAllSelections(world: World, playerIds: string[]): Promise<Record<string, PlayerSelection>> {
    // Check if all already selected
    const selections = this.getSelections(world)
    const allSelected = playerIds.every(id => id in selections)
    if (allSelected) {
      const result: Record<string, PlayerSelection> = {}
      for (const id of playerIds) {
        result[id] = selections[id]
      }
      return Promise.resolve(result)
    }

    this.abortController = new AbortController()
    world.state.waitingPlayerIds = playerIds

    return new Promise<Record<string, PlayerSelection>>((resolve, reject) => {
      this.waitResolve = resolve
      this.waitReject = reject

      this.abortController!.signal.addEventListener('abort', () => {
        this.waitResolve = null
        this.waitReject = null
        reject(new Error('Selection waiting cancelled'))
      })
    })
  }

  cancelWaiting(): void {
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
    }
    this.waitResolve = null
    this.waitReject = null
  }

  private checkAndResolve(world: World): void {
    if (!this.waitResolve) return

    const playerIds = world.state.waitingPlayerIds as string[] | undefined
    if (!playerIds) return

    const selections = this.getSelections(world)
    const allSelected = playerIds.every(id => id in selections)
    if (!allSelected) return

    const result: Record<string, PlayerSelection> = {}
    for (const id of playerIds) {
      result[id] = selections[id]
    }

    const resolve = this.waitResolve
    this.waitResolve = null
    this.waitReject = null
    this.abortController = null
    world.state.waitingPlayerIds = undefined
    resolve(result)
  }
}
