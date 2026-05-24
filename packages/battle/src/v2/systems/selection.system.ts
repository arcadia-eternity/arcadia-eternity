// battle/src/v2/systems/selection.system.ts
// SelectionSystem — manages player selections during battle.

import { asPlayerId, asPetId, asSkillId, AttackTargetOpinion } from '@arcadia-eternity/const'
import type { PlayerSelection, UseSkillSelection, petId } from '@arcadia-eternity/const'
import type { BattleWorld } from '../types/battle-world.js'
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

  setSelection(world: BattleWorld, pid: string, selection: PlayerSelection): boolean {
    const selections = this.getSelections(world)
    selections[pid] = selection
    world.state.selections = selections
    this.checkAndResolve(world)
    return true
  }

  clearSelections(world: BattleWorld): void {
    world.state.selections = {}
  }

  getSelection(world: BattleWorld, pid: string): PlayerSelection | null {
    const selections = this.getSelections(world)
    return selections[pid] ?? null
  }

  private getSelections(world: BattleWorld): Record<string, PlayerSelection> {
    if (!world.state.selections) {
      world.state.selections = {}
    }
    return world.state.selections
  }

  // -----------------------------------------------------------------------
  // Available selections (ported from v1 Player.getAvailableSelection)
  // -----------------------------------------------------------------------

  getAvailableSelections(world: BattleWorld, pid: string): PlayerSelection[] {
    const phase = world.state.currentPhase
    const player = this.playerSystem.getOrThrow(world, pid)
    const selections: PlayerSelection[] = []
    const pId = asPlayerId(pid)

    if (phase === 'switch') {
      // Forced switch: only switch-pet and surrender
      const isForcedSwitch = (world.state.pendingForcedSwitchPlayerIds ?? []).includes(pid)
      const isFaintSwitch = world.state.pendingFaintSwitchPlayerId === pid

      if (isFaintSwitch && !isForcedSwitch) {
        // Faint switch reward: can do nothing or switch
        selections.push({ player: pId, type: 'do-nothing' })
      }

      const switchPets = this.playerSystem.getAvailableSwitchPets(world, pid)
      for (const pet of switchPets) {
        selections.push({ player: pId, type: 'switch-pet', pet: asPetId(pet.id) })
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
        starterPetId: asPetId(fullTeam[0]),
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
          skill: asSkillId(sid),
          target: normalizedTarget,
        })
      }
    }

    selections.push(...availableSkills)

    // Available switch pets
    const switchPets = this.playerSystem.getAvailableSwitchPets(world, pid)
    for (const pet of switchPets) {
      selections.push({ player: pId, type: 'switch-pet', pet: asPetId(pet.id) })
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

  waitForAllSelections(world: BattleWorld, playerIds: string[]): Promise<Record<string, PlayerSelection>> {
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

  private checkAndResolve(world: BattleWorld): void {
    if (!this.waitResolve) return

    const playerIds = world.state.waitingPlayerIds
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
