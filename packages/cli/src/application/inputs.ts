import type { BattleState, PlayerSelection, playerId, petId, skillId } from '@arcadia-eternity/const'
import type { RecordedInput } from './types'
import { CliError } from '../reporting/errors'

/** IDs are runtime identities; saved inputs address the original seat, roster slot and skill slot. */
export function inputCodec(initial: BattleState) {
  const rosters = initial.players.map(player => player.team ?? [])
  function encode(action: PlayerSelection, turn: number, phase: string): RecordedInput {
    const seat = initial.players.findIndex(player => player.id === action.player)
    if (seat < 0) throw new CliError('INPUT_PLAYER', 'Unknown input player', 3)
    const pets = rosters[seat]
    const result: RecordedInput = { turn, phase, seat, type: action.type }
    if (action.type === 'use-skill') {
      const pet = pets.findIndex(pet => (pet.skills ?? []).some(skill => skill?.id === action.skill))
      if (pet < 0) throw new CliError('INPUT_SKILL', 'Unknown runtime skill', 3)
      result.skill = { pet, slot: (pets[pet].skills ?? []).findIndex(skill => skill?.id === action.skill) }
      result.target = action.target
    } else if (action.type === 'switch-pet') result.pet = pets.findIndex(pet => pet.id === action.pet)
    else if (action.type === 'team-selection') {
      result.selectedPets = action.selectedPets.map(id => pets.findIndex(pet => pet.id === id))
      result.starterPet = pets.findIndex(pet => pet.id === action.starterPetId)
    }
    return result
  }
  function decode(input: RecordedInput): PlayerSelection {
    const player = initial.players[input.seat]?.id as playerId | undefined
    const pets = rosters[input.seat]
    if (!player || !pets) throw new CliError('INPUT_PLAYER', 'Invalid replay seat', 3)
    const pet = (slot: number | undefined) => {
      if (!Number.isSafeInteger(slot) || !pets[slot!]) throw new CliError('INPUT_PET', 'Invalid replay roster slot', 3)
      return pets[slot!].id as petId
    }
    switch (input.type) {
      case 'use-skill': {
        pet(input.skill?.pet)
        const skill = pets[input.skill!.pet].skills?.[input.skill!.slot]?.id as skillId | undefined
        if (!skill) throw new CliError('INPUT_SKILL', 'Invalid replay skill slot', 3)
        return { player, type: input.type, skill, target: input.target } as PlayerSelection
      }
      case 'switch-pet':
        return { player, type: input.type, pet: pet(input.pet) }
      case 'team-selection':
        if (!Array.isArray(input.selectedPets)) throw new CliError('INPUT_TEAM', 'Missing replay team', 3)
        return {
          player,
          type: input.type,
          selectedPets: input.selectedPets.map(pet),
          starterPetId: pet(input.starterPet),
        }
      case 'do-nothing':
      case 'surrender':
        return { player, type: input.type }
      default:
        throw new CliError('INPUT_TYPE', 'Unknown replay action', 3)
    }
  }
  return { encode, decode, rosters }
}
