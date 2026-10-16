import { nextRandom, seedToState } from './rng.js'
import type {
  BattleAction,
  BattleContent,
  BattleEvent,
  BattleEventInput,
  BattleEventListener,
  BattleReplay,
  BattleSnapshot,
  BattleState,
  CreateBattleOptions,
  LoggedAction,
  Pet,
  Player,
  Seir2Species,
  Skill,
} from './model.js'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function assertJsonValue(value: unknown, path: string, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object') throw new Error(`${path} must contain only JSON data`)
  if (seen.has(value)) throw new Error(`${path} cannot contain cycles`)
  seen.add(value)
  if (Array.isArray(value)) {
    if (Reflect.ownKeys(value).length !== value.length + 1)
      throw new Error(`${path} arrays cannot contain extra properties`)
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
        throw new Error(`${path} must contain only JSON data`)
      assertJsonValue(descriptor.value, `${path}[${index}]`, seen)
    }
  } else {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) throw new Error(`${path} cannot contain host objects`)
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new Error(`${path} cannot contain symbol keys`)
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
        throw new Error(`${path} must contain only JSON data`)
      assertJsonValue(descriptor.value, `${path}.${key}`, seen)
    }
  }
  seen.delete(value)
}

interface ContentIndex {
  speciesById: Map<string, Seir2Species>
  skillsById: Map<string, Skill>
}

function validateContent(content: BattleContent): ContentIndex {
  assertJsonValue(content, 'Battle content')
  const speciesById = new Map(content.species.map(item => [item.id, item]))
  const skillsById = new Map(content.skills.map(item => [item.id, item]))
  if (speciesById.size !== content.species.length || skillsById.size !== content.skills.length)
    throw new Error('Content IDs must be unique')
  for (const item of content.species) {
    if (!item.id || !Number.isFinite(item.maxHp) || item.maxHp < 1) throw new Error(`Invalid species: ${item.id}`)
  }
  for (const skill of content.skills) {
    if (
      !skill.id ||
      !Number.isFinite(skill.power) ||
      skill.power < 0 ||
      skill.accuracy < 0 ||
      skill.accuracy > 1 ||
      skill.rageCost < 0
    ) {
      throw new Error(`Invalid skill: ${skill.id}`)
    }
  }
  return { speciesById, skillsById }
}

function validateSnapshot(snapshot: BattleSnapshot): void {
  if (snapshot.schemaVersion !== 1) throw new Error(`Unsupported battle snapshot version: ${snapshot.schemaVersion}`)
  validateContent(snapshot.content)
  if (
    !Number.isInteger(snapshot.state.rngState) ||
    snapshot.state.rngState < 0 ||
    snapshot.state.rngState > 0xffff_ffff
  ) {
    throw new Error('Snapshot has an invalid RNG state')
  }
  const playerIds = new Set(snapshot.state.players.map(player => player.id))
  if (playerIds.size !== 2 || snapshot.state.players.length !== 2)
    throw new Error('A Seir2 battle must have exactly two players')
  for (const player of snapshot.state.players) {
    if (!player.petIds.includes(player.activePetId)) throw new Error(`Active pet is not on ${player.id}'s team`)
    if (!snapshot.state.pets.some(pet => pet.id === player.activePetId))
      throw new Error(`Missing active pet for ${player.id}`)
  }
}

/** Seir2-specific, data-driven local battle. The host owns storage and UI. */
export class Battle {
  private readonly listeners = new Set<BattleEventListener>()
  private readonly speciesById: Map<string, Seir2Species>
  private readonly skillsById: Map<string, Skill>
  private state: BattleState

  private constructor(
    private readonly content: BattleContent,
    state: BattleState,
    index: ContentIndex,
  ) {
    this.state = state
    this.speciesById = index.speciesById
    this.skillsById = index.skillsById
  }

  static create(options: CreateBattleOptions): Battle {
    assertJsonValue(options.players, 'Player setup')
    assertJsonValue(options.content, 'Battle content')
    if (!Number.isFinite(options.seed)) throw new Error('Battle seed must be finite')
    if (!options.id) throw new Error('Battle ID is required')
    const content = clone(options.content)
    const index = validateContent(content)
    if (options.players[0].id === options.players[1].id) throw new Error('Player IDs must be unique')
    const pets: Pet[] = []
    const players: Player[] = options.players.map(setup => {
      if (setup.team.length === 0) throw new Error(`Player ${setup.id} must have at least one pet`)
      const ids = new Set(setup.team.map(pet => pet.id))
      if (ids.size !== setup.team.length || pets.some(pet => ids.has(pet.id)))
        throw new Error('Pet IDs must be unique within a battle')
      for (const entry of setup.team) {
        const species = index.speciesById.get(entry.speciesId)
        if (!species) throw new Error(`Unknown species: ${entry.speciesId}`)
        if (entry.skillIds.some(id => !index.skillsById.has(id))) throw new Error(`Unknown skill on pet ${entry.id}`)
        pets.push({
          id: entry.id,
          speciesId: entry.speciesId,
          skillIds: [...entry.skillIds],
          hp: species.maxHp,
          marks: [],
        })
      }
      return {
        id: setup.id,
        name: setup.name,
        petIds: setup.team.map(pet => pet.id),
        activePetId: setup.team[0].id,
        rage: 0,
      }
    })
    const seed = options.seed >>> 0
    const state: BattleState = {
      id: options.id,
      seed,
      rngState: seedToState(seed),
      turn: 1,
      phase: { type: 'selection' },
      winnerId: null,
      players,
      pets,
      pendingActions: {},
      actionLog: [],
      events: [],
    }
    const battle = new Battle(content, state, index)
    battle.emit({ type: 'battle-started', battleId: options.id })
    return battle
  }

  static restore(snapshot: BattleSnapshot): Battle {
    assertJsonValue(snapshot, 'Battle snapshot')
    validateSnapshot(snapshot)
    const content = clone(snapshot.content)
    return new Battle(content, clone(snapshot.state), validateContent(content))
  }

  getState(): Readonly<BattleState> {
    return clone(this.state)
  }

  get events(): readonly BattleEvent[] {
    return clone(this.state.events)
  }

  subscribe(listener: BattleEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  submitAction(playerId: string, action: BattleAction): void {
    assertJsonValue(action, 'Battle action')
    if (this.state.phase.type === 'ended' || this.state.phase.type === 'turn-resolution')
      throw new Error('Battle is not accepting actions')
    const player = this.player(playerId)
    if (this.state.pendingActions[playerId]) throw new Error(`${playerId} already submitted an action this turn`)
    this.validateAction(player, action)
    const frozenAction = clone(action)
    this.state.pendingActions[playerId] = frozenAction
    const logged: LoggedAction = {
      index: this.state.actionLog.length,
      turn: this.state.turn,
      playerId,
      action: frozenAction,
    }
    this.state.actionLog.push(logged)
    this.emit({ type: 'action-submitted', playerId, action: frozenAction })
    if (this.state.players.every(item => this.state.pendingActions[item.id])) this.resolveTurn()
  }

  snapshot(): BattleSnapshot {
    return { schemaVersion: 1, content: clone(this.content), state: clone(this.state) }
  }

  createReplay(): BattleReplay {
    const actions = this.state.actionLog.map(({ playerId, action }) => ({ playerId, action: clone(action) }))
    const initial = Battle.create({
      id: this.state.id,
      seed: this.state.seed,
      content: this.content,
      players: this.state.players.map(player => ({
        id: player.id,
        name: player.name,
        team: player.petIds.map(id => {
          const pet = this.pet(id)
          return { id: pet.id, speciesId: pet.speciesId, skillIds: pet.skillIds }
        }),
      })) as CreateBattleOptions['players'],
    }).snapshot()
    return { schemaVersion: 1, initial, actions, expectedEvents: [...this.events] }
  }

  private validateAction(player: Player, action: BattleAction): void {
    const active = this.pet(player.activePetId)
    if (active.hp <= 0) {
      if (action.type !== 'switch-pet' || !player.petIds.includes(action.petId) || this.pet(action.petId).hp <= 0) {
        throw new Error(`${player.id} must switch to a living pet`)
      }
      return
    }
    if (action.type === 'switch-pet') {
      if (
        !player.petIds.includes(action.petId) ||
        action.petId === player.activePetId ||
        this.pet(action.petId).hp <= 0
      ) {
        throw new Error(`Invalid switch target: ${action.petId}`)
      }
      return
    }
    if (!active.skillIds.includes(action.skillId)) throw new Error(`${action.skillId} is not available to ${active.id}`)
    const skill = this.skill(action.skillId)
    if (player.rage < skill.rageCost) throw new Error(`${player.id} does not have enough rage for ${skill.id}`)
  }

  private resolveTurn(): void {
    this.setPhase({ type: 'turn-resolution' })
    const ordered = this.state.players
      .map(player => ({ player, action: this.state.pendingActions[player.id] }))
      .sort(
        (a, b) =>
          this.actionPriority(b.action) - this.actionPriority(a.action) || this.speed(b.player) - this.speed(a.player),
      )
    for (const entry of ordered) {
      if (this.state.phase.type === 'ended') break
      const { player, action } = entry
      if (!action) continue
      if (action.type === 'switch-pet') this.switchPet(player, action.petId)
      else this.useSkill(player, action.skillId)
      this.checkBattleEnd()
    }
    if (this.state.phase.type !== 'ended') {
      for (const player of this.state.players) player.rage = Math.min(100, player.rage + 15)
      this.emit({
        type: 'turn-ended',
        rage: Object.fromEntries(this.state.players.map(player => [player.id, player.rage])),
      })
      this.state.turn += 1
      this.state.pendingActions = {}
      const playersRequiringSwitch = this.state.players
        .filter(player => this.pet(player.activePetId).hp <= 0 && player.petIds.some(id => this.pet(id).hp > 0))
        .map(player => player.id)
      this.setPhase(
        playersRequiringSwitch.length
          ? { type: 'forced-switch', playerIds: playersRequiringSwitch }
          : { type: 'selection' },
      )
    }
  }

  private switchPet(player: Player, petId: string): void {
    const outgoingId = player.activePetId
    player.activePetId = petId
    player.rage = Math.floor(player.rage * 0.8)
    this.emit({ type: 'pet-switched', playerId: player.id, fromPetId: outgoingId, toPetId: petId, rage: player.rage })
  }

  private useSkill(player: Player, skillId: string): void {
    const source = this.pet(player.activePetId)
    if (source.hp <= 0) return
    const skill = this.skill(skillId)
    if (player.rage < skill.rageCost || !source.skillIds.includes(skillId)) return
    player.rage -= skill.rageCost
    const opposingPlayer = this.state.players.find(item => item.id !== player.id)
    if (!opposingPlayer) throw new Error('Battle requires two players')
    // Resolve the target at execution time, after earlier switches in this turn.
    const target = skill.target === 'self' ? source : this.pet(opposingPlayer.activePetId)
    this.emit({ type: 'skill-used', playerId: player.id, petId: source.id, skillId, targetPetId: target.id })
    const roll = nextRandom(this.state.rngState)
    this.state.rngState = roll.state
    if (roll.value >= skill.accuracy) {
      this.emit({ type: 'skill-missed', playerId: player.id, skillId, targetPetId: target.id })
      return
    }
    const sourceSpecies = this.species(source.speciesId)
    const targetSpecies = this.species(target.speciesId)
    const amount = Math.max(1, skill.power + sourceSpecies.attack - targetSpecies.defense)
    target.hp = Math.max(0, target.hp - amount)
    this.emit({ type: 'damage', sourcePetId: source.id, targetPetId: target.id, amount, hp: target.hp })
    if (target.hp === 0) {
      const owner = this.state.players.find(item => item.petIds.includes(target.id))
      if (owner) this.emit({ type: 'pet-fainted', playerId: owner.id, petId: target.id })
    }
  }

  private checkBattleEnd(): void {
    const defeated = this.state.players.filter(player => player.petIds.every(id => this.pet(id).hp <= 0))
    if (defeated.length === 0) return
    this.setPhase({ type: 'ended' })
    this.state.winnerId = this.state.players.find(player => !defeated.includes(player))?.id ?? null
    this.emit({ type: 'battle-ended', winnerId: this.state.winnerId })
  }

  private setPhase(phase: BattleState['phase']): void {
    if (JSON.stringify(this.state.phase) === JSON.stringify(phase)) return
    this.state.phase = phase
    this.emit({ type: 'phase-changed', phase: clone(phase) })
  }

  private actionPriority(action: BattleAction | undefined): number {
    return action?.type === 'use-skill' ? (this.skill(action.skillId).priority ?? 0) : 6
  }

  private speed(player: Player): number {
    return this.species(this.pet(player.activePetId).speciesId).speed
  }

  private player(id: string): Player {
    const player = this.state.players.find(item => item.id === id)
    if (!player) throw new Error(`Unknown player: ${id}`)
    return player
  }

  private pet(id: string): Pet {
    const pet = this.state.pets.find(item => item.id === id)
    if (!pet) throw new Error(`Unknown pet: ${id}`)
    return pet
  }

  private species(id: string) {
    const species = this.speciesById.get(id)
    if (!species) throw new Error(`Unknown species: ${id}`)
    return species
  }

  private skill(id: string) {
    const skill = this.skillsById.get(id)
    if (!skill) throw new Error(`Unknown skill: ${id}`)
    return skill
  }

  private emit(event: BattleEventInput): void {
    const complete = { ...event, sequence: this.state.events.length, turn: this.state.turn } as BattleEvent
    this.state.events.push(complete)
    for (const listener of [...this.listeners]) listener(clone(complete))
  }
}

export function createBattle(options: CreateBattleOptions): Battle {
  return Battle.create(options)
}

export function restoreBattle(snapshot: BattleSnapshot): Battle {
  return Battle.restore(snapshot)
}

export function replayBattle(replay: BattleReplay): Battle {
  if (replay.schemaVersion !== 1) throw new Error(`Unsupported replay version: ${replay.schemaVersion}`)
  const battle = Battle.restore(replay.initial)
  for (const { playerId, action } of replay.actions) battle.submitAction(playerId, action)
  if (JSON.stringify(battle.events) !== JSON.stringify(replay.expectedEvents))
    throw new Error('Replay event sequence did not match its recorded events')
  return battle
}
