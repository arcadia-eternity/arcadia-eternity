import type { playerId } from '@arcadia-eternity/const'
import type { OwnedEntity } from './entity.js'
import { MAX_RAGE } from '@arcadia-eternity/const'
import type { ContentCatalog, PlayerBuild } from './content.js'
import { Pet, type PetState } from './pet.js'
import type { Battle, BattleAction } from './battle.js'

export interface PlayerState {
  id: string
  name: string
  currentRage: number
  maxRage: number
  activePetId: string
  team: PetState[]
}
/** A battle seat; id is not a server authentication credential or a global Account. */
export class Player implements OwnedEntity<Battle> {
  readonly id: playerId
  readonly name: string
  readonly team: readonly Pet[]
  readonly battle: Battle
  activePet: Pet
  currentRage = 20
  maxRage = MAX_RAGE
  constructor(build: PlayerBuild, battle: Battle, content: ContentCatalog) {
    if (!build.id || !build.name || build.team.length < 1 || build.team.length > 6)
      throw new Error('Invalid player build')
    this.id = build.id as playerId
    this.name = build.name
    this.battle = battle
    this.team = Object.freeze(build.team.map(p => new Pet(p, this, content)))
    this.activePet = this.team[0]
    this.activePet.appeared = true
  }
  get owner() {
    return this.battle
  }
  setOwner(owner: Battle) {
    if (owner !== this.battle) throw new Error('Player battle ownership is fixed')
  }
  getAvailableSelection(): BattleAction[] {
    return this.battle.getAvailableActions(this.id)
  }
  getAvailableSkills(): BattleAction[] {
    return this.activePet.skills
      .filter(s => s.rage <= this.currentRage)
      .map(s => ({ type: 'use-skill', player: this.id, skill: s.id, target: s.target }))
  }
  getAvailableSwitch(): BattleAction[] {
    return this.team
      .filter(p => p !== this.activePet && p.isAlive)
      .map(p => ({ type: 'switch-pet', player: this.id, pet: p.id }))
  }
  settingRage(value: number) {
    this.currentRage = Math.max(0, Math.min(this.maxRage, value))
  }
  getState(): PlayerState {
    return {
      id: this.id,
      name: this.name,
      currentRage: this.currentRage,
      maxRage: this.maxRage,
      activePetId: this.activePet.id,
      team: this.team.map(p => p.getState()),
    }
  }
}
