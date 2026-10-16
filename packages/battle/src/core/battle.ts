import { AttackTargetOpinion, EffectTrigger, type markId } from '@arcadia-eternity/const'
import { ContentCatalog, type BattleContent, type PlayerBuild } from './content.js'
import { copyData, canonicalData, freezeData, requireNumber, type JsonObject } from './data.js'
import { EffectRegistry } from './effects.js'
import {
  Context,
  EffectContext,
  TurnContext,
  BattleLoopContext,
  AddMarkContext,
  RemoveMarkContext,
  ConsumeStackContext,
  RageContext,
  DamageContext,
  HealContext,
  type AnyEffectContext,
  type TriggerContextMap,
  type TurnContextData,
} from './context.js'
import { GameRng, type RngState } from './rng.js'
import { Player, type PlayerState } from './player.js'
import { Pet, type StageStat } from './pet.js'
import { Skill } from './skill.js'
import { Mark, type MarkState } from './mark.js'
import { STAGE_STATS } from './stat-stage.js'
import { BattleContinuation } from './continuation.js'
import {
  PhaseManager,
  BattleStartPhase,
  BattleLoopPhase,
  EffectExecutionPhase,
  DamagePhase,
  RagePhase,
  HealPhase,
  AddMarkPhase,
  RemoveMarkPhase,
  ConsumeStackPhase,
  type PhaseManagerState,
  PhaseState,
} from './phase/index.js'
import type { MarkOwner } from './entity.js'

export type BattleAction =
  | { type: 'use-skill'; player: string; skill: string; target: AttackTargetOpinion }
  | { type: 'switch-pet'; player: string; pet: string }
  | { type: 'do-nothing'; player: string }
  | { type: 'surrender'; player: string }
export interface BattleOptions {
  id: string
  seed: string | number
  players: [PlayerBuild, PlayerBuild]
  allowFaintSwitch?: boolean
}
export interface BattleEvent {
  sequence: number
  turn: number
  type: string
  data: JsonObject
}
export interface ActionLogEntry {
  sequence: number
  turn: number
  phase: 'selection' | 'switch'
  action: BattleAction
}
export interface BattleState {
  id: string
  turn: number
  status: 'unstarted' | 'active' | 'ended'
  victor: string | null
  endReason: string | null
  lastKillerId: string | null
  players: PlayerState[]
  marks: MarkState[]
  phase: ReturnType<BattleContinuation['getState']>
  turnContext: TurnContextData | null
}
export interface BattleSnapshot {
  version: 1
  contentIdentity: string
  initial: BattleOptions
  state: BattleState
  rng: RngState
  nextId: number
  phases: PhaseManagerState
  events: BattleEvent[]
  actions: ActionLogEntry[]
}
export interface ReplayFixture {
  version: 1
  initial: BattleOptions
  contentIdentity: string
  actions: ActionLogEntry[]
  expectedEvents: BattleEvent[]
  expectedState: BattleState
}
export interface ActionResult {
  accepted: boolean
  reason?: string
}

/** Owns battle state. Host IO, decision latency and authentication live outside this class. */
export class Battle extends Context<null> implements MarkOwner {
  readonly kind = 'battle'
  readonly type = 'battle'
  override get battle(): Battle {
    return this
  }
  readonly phaseManager: PhaseManager
  activeTurn: TurnContext | null = null
  readonly id: string
  readonly players: readonly [Player, Player]
  readonly content: ContentCatalog
  readonly initial: BattleOptions
  readonly registry: EffectRegistry
  phase = new BattleContinuation()
  marks: Mark[] = []
  turn = 0
  status: BattleState['status'] = 'unstarted'
  victor: string | null = null
  endReason: string | null = null
  private rng: GameRng
  private nextId = 0
  private journal: BattleEvent[] = []
  private actionLog: ActionLogEntry[] = []
  private listeners = new Set<(event: BattleEvent) => void>()
  private observerErrors: unknown[] = []
  private busy = false
  private delivering = false
  lastKillerId: string | null = null

  constructor(options: BattleOptions, content: BattleContent, registry = new EffectRegistry()) {
    super(null)
    this.phaseManager = new PhaseManager(this)
    this.initial = freezeData(copyData(options))
    this.id = options.id
    if (
      !options.id ||
      !['string', 'number'].includes(typeof options.seed) ||
      (typeof options.seed === 'number' && !Number.isFinite(options.seed))
    )
      throw new Error('Battle ID and finite seed are required')
    if (options.players.length !== 2) throw new Error('Exactly two players required')
    this.content = new ContentCatalog(content)
    this.registry = registry
    for (const item of [...this.content.data.skills, ...this.content.data.marks])
      for (const ref of item.effects) registry.resolve(ref)
    this.rng = new GameRng(options.seed)
    this.players = Object.freeze(options.players.map(p => new Player(p, this, this.content))) as readonly [
      Player,
      Player,
    ]
    const ids = [
      this.id,
      ...this.players.flatMap(p => [p.id, ...p.team.flatMap(pet => [pet.id, ...pet.skills.map(s => s.id)])]),
    ]
    if (new Set(ids).size !== ids.length || ids.some(id => id.startsWith('@mark/')))
      throw new Error('Battle instance IDs must be unique and outside @mark/')
    for (const player of this.players)
      for (const pet of player.team) for (const id of [pet.ability, pet.emblem]) if (id) this.content.mark(id)
  }
  get playerA() {
    return this.players[0]
  }
  get playerB() {
    return this.players[1]
  }
  getPlayerByID(id: string): Player {
    const p = this.players.find(p => p.id === id)
    if (!p) throw new Error(`Unknown player: ${id}`)
    return p
  }
  getPetByID(id: string): Pet {
    for (const p of this.players) {
      const pet = p.team.find(pet => pet.id === id)
      if (pet) return pet
    }
    throw new Error(`Unknown pet: ${id}`)
  }
  getSkillByID(id: string): Skill {
    for (const p of this.players)
      for (const pet of p.team) {
        const skill = pet.skills.find(s => s.id === id)
        if (skill) return skill
      }
    throw new Error(`Unknown skill: ${id}`)
  }
  getOpponent(player: Player): Player {
    return this.players[player === this.playerA ? 1 : 0]
  }
  /** The only random stream used for rules; trusted code must use this as well. */
  random(): number {
    if (!this.busy) throw new Error('RNG is only available during an operation')
    return this.rng.next()
  }
  randomInt(min: number, max: number) {
    return Math.floor(this.random() * (max - min + 1)) + min
  }
  events(listener: (event: BattleEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  takeObserverErrors(): unknown[] {
    const result = this.observerErrors
    this.observerErrors = []
    return result
  }
  getEvents(afterSequence = 0): BattleEvent[] {
    return copyData(this.journal.filter(e => e.sequence > afterSequence))
  }
  getActionLog(): ActionLogEntry[] {
    return copyData(this.actionLog)
  }
  emitEvent(type: string, data: JsonObject) {
    this.journal.push(freezeData(copyData({ sequence: this.journal.length + 1, turn: this.turn, type, data })))
  }
  private operation<T>(fn: () => T): T {
    if (this.busy || this.delivering) throw new Error('Reentrant battle operation')
    // Trusted code failures must not leave an accepted half-turn or consumed RNG.
    const rollback = this.snapshot()
    const from = this.journal.length
    this.busy = true
    let result: T
    try {
      result = fn()
    } catch (error) {
      this.load(rollback)
      throw error
    } finally {
      this.busy = false
    }
    this.delivering = true
    try {
      for (const event of this.journal.slice(from))
        for (const listener of [...this.listeners]) {
          try {
            listener(copyData(event))
          } catch (error) {
            this.observerErrors.push(error)
          }
        }
    } finally {
      this.delivering = false
    }
    return result
  }
  /** Synchronous rule execution; await this result in an asynchronous host if desired. */
  start(): void {
    this.operation(() => this.phaseManager.executeSync(new BattleStartPhase(this)))
  }
  getAvailableActions(playerId: string): BattleAction[] {
    const player = this.getPlayerByID(playerId)
    if (this.status !== 'active' || this.phase.pending.some(a => a.player === playerId)) return []
    if (this.phase.kind === 'switch') {
      if (this.phase.forced.includes(playerId)) return player.getAvailableSwitch()
      if (this.phase.reward === playerId)
        return [{ type: 'do-nothing', player: playerId }, ...player.getAvailableSwitch()]
      return []
    }
    if (this.phase.kind !== 'selection') return []
    const skills = player.getAvailableSkills()
    return [
      ...skills,
      ...player.getAvailableSwitch(),
      ...(skills.length ? [] : [{ type: 'do-nothing', player: playerId } as const]),
      { type: 'surrender', player: playerId },
    ]
  }
  /** With autoAdvance=false the host can save after either submission or each atomic phase. */
  submitAction(action: BattleAction, autoAdvance = true): ActionResult {
    return this.operation(() => {
      const clean = copyData(action)
      const valid = this.getAvailableActions(clean.player).some(a => canonicalData(a) === canonicalData(clean))
      if (!valid) return { accepted: false, reason: 'Action unavailable in current phase' }
      this.actionLog.push({
        sequence: this.actionLog.length + 1,
        turn: this.turn,
        phase: this.phase.kind as 'selection' | 'switch',
        action: clean,
      })
      this.phase.pending.push(clean)
      if (clean.type === 'surrender') {
        this.finish(this.getOpponent(this.getPlayerByID(clean.player)).id, 'surrender')
        return { accepted: true }
      }
      if (autoAdvance) this.runUntilWaiting()
      return { accepted: true }
    })
  }
  advance(): boolean {
    return this.operation(() => this.step())
  }
  private runUntilWaiting() {
    while (this.step()) {
      /* synchronous rule phases only */
    }
  }
  private step(): boolean {
    if (this.phase.kind === 'created' || this.phase.kind === 'ended') return false
    if (this.phase.kind === 'selection' && this.phase.pending.length !== 2) return false
    if (this.phase.kind === 'switch') {
      const required = [...this.phase.forced, ...(this.phase.reward ? [this.phase.reward] : [])]
      if (!required.every(id => this.phase.pending.some(action => action.player === id))) return false
    }
    this.phaseManager.executeSync(new BattleLoopPhase(new BattleLoopContext(this)))
    return true
  }
  finish(victor: string | null, reason: string) {
    this.status = 'ended'
    this.victor = victor
    this.endReason = reason
    this.phase = new BattleContinuation('ended')
    this.lastKillerId = null
    this.activeTurn = null
    this.emitEvent('battleEnd', { winner: victor, reason })
  }
  applyEffects<T extends EffectTrigger>(context: TriggerContextMap[NoInfer<T>], trigger: T, only?: readonly Mark[]) {
    this.phaseManager.executeSync(new EffectExecutionPhase(context, trigger, only))
  }
  getActiveMarks(): Mark[] {
    return [...this.marks, ...this.players.flatMap(player => player.activePet.marks)].filter(mark => mark.isActive)
  }
  assertInOperation() {
    if (!this.busy) throw new Error('Rule mutations require a battle operation')
  }
  allocateMarkId() {
    this.assertInOperation()
    return `@mark/${this.nextId++}` as markId
  }
  private effectParent(): AnyEffectContext {
    const context = this.phaseManager.currentContext
    if (!(context instanceof EffectContext))
      throw new Error('Convenience rule operations require an EffectContext; otherwise supply a typed context')
    // The dispatch phase constructs one concrete member of this mapped union.
    return context as AnyEffectContext
  }
  changeRage(context: RageContext): void
  changeRage(player: Player, amount: number, direction: RageContext['direction'], reason: string): void
  changeRage(context: RageContext | Player, amount?: number, direction?: RageContext['direction'], reason?: string) {
    const operation =
      context instanceof RageContext
        ? context
        : new RageContext(this.effectParent(), context, amount!, direction!, reason!)
    this.phaseManager.executeSync(new RagePhase(operation))
  }
  addStatStage(pet: Pet, stat: StageStat, amount: number) {
    if (!STAGE_STATS.includes(stat) || !Number.isInteger(amount)) throw new Error('Invalid stage change')
    const context = new AddMarkContext(
      this.effectParent(),
      pet,
      this.content.mark(`stat_stage_${stat}_${amount > 0 ? 'up' : 'down'}`),
      Math.max(1, Math.abs(amount)),
    )
    context.statStage = { stat, level: amount }
    this.addMark(context)
  }
  addMark(context: AddMarkContext): Mark | null
  addMark(owner: MarkOwner, baseId: string, stack?: number, creatorId?: string | null): Mark | null
  addMark(
    context: AddMarkContext | MarkOwner,
    baseId?: string,
    stack = 1,
    creatorId: string | null = null,
  ): Mark | null {
    const operation =
      context instanceof AddMarkContext
        ? context
        : new AddMarkContext(this.effectParent(), context, this.content.mark(baseId!), stack, creatorId)
    return this.phaseManager.executeSync(new AddMarkPhase(operation))
  }
  removeMark(context: RemoveMarkContext): void
  removeMark(mark: Mark, force?: boolean): void
  removeMark(context: RemoveMarkContext | Mark, force = false) {
    const operation =
      context instanceof RemoveMarkContext ? context : new RemoveMarkContext(this.effectParent(), context, force)
    this.phaseManager.executeSync(new RemoveMarkPhase(operation))
  }
  consumeMarkStacks(context: ConsumeStackContext): number
  consumeMarkStacks(mark: Mark, amount: number): number
  consumeMarkStacks(context: ConsumeStackContext | Mark, amount?: number): number {
    const operation =
      context instanceof ConsumeStackContext ? context : new ConsumeStackContext(this.effectParent(), context, amount!)
    return this.phaseManager.executeSync(new ConsumeStackPhase(operation))
  }
  damage(context: DamageContext): number {
    return this.phaseManager.executeSync(new DamagePhase(context))
  }
  heal(context: HealContext): number
  heal(source: Pet, target: Pet, amount: number): number
  heal(context: HealContext | Pet, target?: Pet, amount?: number): number {
    const operation =
      context instanceof HealContext ? context : new HealContext(this.effectParent(), context, target!, amount!)
    return this.phaseManager.executeSync(new HealPhase(operation))
  }
  getState(): BattleState {
    return copyData({
      id: this.id,
      turn: this.turn,
      status: this.status,
      victor: this.victor,
      endReason: this.endReason,
      lastKillerId: this.lastKillerId,
      players: this.players.map(p => p.getState()),
      marks: this.marks.map(m => m.getState()),
      phase: this.phase.getState(),
      turnContext: this.activeTurn ? copyData(this.activeTurn.data) : null,
    })
  }
  snapshot(): BattleSnapshot {
    if (this.busy) throw new Error('Snapshot requires an atomic phase boundary')
    return copyData({
      version: 1,
      contentIdentity: this.content.identity,
      initial: this.initial,
      state: this.getState(),
      rng: this.rng.getState(),
      nextId: this.nextId,
      phases: this.phaseManager.snapshot(),
      events: this.journal,
      actions: this.actionLog,
    })
  }
  exportReplay(): ReplayFixture {
    if (
      this.busy ||
      (this.phase.kind !== 'ended' && !this.players.some(p => this.getAvailableActions(p.id).length > 0))
    )
      throw new Error('Replay export requires a decision or ended boundary; use snapshot for mid-turn state')
    return {
      version: 1,
      initial: copyData(this.initial),
      contentIdentity: this.content.identity,
      actions: this.getActionLog(),
      expectedEvents: this.getEvents(),
      expectedState: this.getState(),
    }
  }
  /** Internal rehydration, also used to roll back a failed trusted callback. */
  private load(snapshot: BattleSnapshot) {
    const state = snapshot.state
    this.turn = state.turn
    this.status = state.status
    this.victor = state.victor
    this.endReason = state.endReason
    this.phase = new BattleContinuation(
      state.phase.kind,
      copyData(state.phase.queue),
      copyData(state.phase.pending),
      [...state.phase.forced],
      state.phase.reward,
    )
    this.activeTurn = state.turnContext ? new TurnContext(this, copyData(state.turnContext)) : null
    this.phaseManager.restore(snapshot.phases)
    this.rng = GameRng.fromState(snapshot.rng)
    this.nextId = snapshot.nextId
    this.journal = copyData(snapshot.events)
    this.actionLog = copyData(snapshot.actions)
    this.lastKillerId = state.lastKillerId
    const restoreMarks = (states: MarkState[], owner: Pet | Battle) =>
      states.map(s => {
        const mark = new Mark(s.id as markId, this.content.mark(s.baseId), owner, s.stack, s.creatorId, s.config)
        mark.duration = s.duration
        mark.isActive = s.isActive
        mark.config = copyData(s.config)
        return mark
      })
    this.marks = restoreMarks(state.marks, this)
    for (const saved of state.players) {
      const player = this.getPlayerByID(saved.id)
      player.currentRage = saved.currentRage
      player.maxRage = saved.maxRage
      player.activePet = this.getPetByID(saved.activePetId)
      for (const savedPet of saved.team) {
        const pet = this.getPetByID(savedPet.build.id)
        pet.species = this.content.species(savedPet.speciesId)
        pet.currentHp = savedPet.currentHp
        pet.appeared = savedPet.appeared
        pet.gender = savedPet.gender
        pet.lastSkill = savedPet.lastSkillId ? this.getSkillByID(savedPet.lastSkillId) : null
        pet.lastSkillUsedTimes = savedPet.lastSkillUsedTimes
        pet.skillHistory = [...savedPet.skillHistory]
        pet.marks = restoreMarks(savedPet.marks, pet)
        for (const s of savedPet.skills) {
          const skill = this.getSkillByID(s.id)
          skill.power = s.power
          skill.accuracy = s.accuracy
          skill.rage = s.rage
          skill.priority = s.priority
          skill.appeared = s.appeared
        }
      }
    }
  }
  static restore(snapshot: BattleSnapshot, content: BattleContent, registry = new EffectRegistry()): Battle {
    const clean = copyData(snapshot)
    if (clean.version !== 1) throw new Error('Unsupported snapshot version')
    const battle = new Battle(clean.initial, content, registry)
    if (battle.content.identity !== clean.contentIdentity) throw new Error('Content identity mismatch')
    battle.validateSnapshot(clean)
    battle.load(clean)
    battle.validateContinuation()
    if (canonicalData(battle.snapshot()) !== canonicalData(clean))
      throw new Error('Snapshot contains inconsistent or unknown data')
    return battle
  }
  private validateContinuation() {
    if (this.lastKillerId !== null) this.getPetByID(this.lastKillerId)
    if (['action', 'turn-end'].includes(this.phase.kind) !== (this.activeTurn !== null))
      throw new Error('Invalid saved TurnContext')
    const phase = this.phase
    if (new Set(phase.forced).size !== phase.forced.length) throw new Error('Duplicate forced switches')
    for (const id of phase.forced)
      if (this.getPlayerByID(id).activePet.isAlive) throw new Error('Forced switch has a living active pet')
    if (phase.reward && (phase.forced.includes(phase.reward) || !this.getPlayerByID(phase.reward).activePet.isAlive))
      throw new Error('Invalid reward switch')
    if (phase.kind !== 'switch' && (phase.forced.length || phase.reward)) throw new Error('Unexpected switch state')
    if (phase.kind === 'switch' && !phase.forced.length) throw new Error('Empty forced switch')
    if (!['turn-start', 'action', 'turn-end'].includes(phase.kind) && phase.queue.length)
      throw new Error('Unexpected action queue')
    if (!['selection', 'switch'].includes(phase.kind) && phase.pending.length)
      throw new Error('Unexpected pending action')
    const pending = phase.pending
    phase.pending = []
    try {
      for (const action of pending)
        if (!this.getAvailableActions(action.player).some(a => canonicalData(a) === canonicalData(action)))
          throw new Error('Invalid pending action')
    } finally {
      phase.pending = pending
    }
    for (const item of phase.queue) {
      const player = this.getPlayerByID(item.action.player),
        pet = this.getPetByID(item.actorPetId)
      if (pet.owner !== player) throw new Error('Invalid queued player')
      switch (item.action.type) {
        case 'use-skill':
          if (
            phase.kind === 'action' &&
            (!item.skillPlan ||
              this.getSkillByID(item.skillPlan.skillId).owner !== pet ||
              !Object.values(AttackTargetOpinion).includes(item.skillPlan.selectTarget))
          )
            throw new Error('Invalid saved skill context plan')
          if (
            this.getSkillByID(item.action.skill).owner !== pet ||
            item.action.target !== this.getSkillByID(item.action.skill).target
          )
            throw new Error('Invalid queued skill')
          break
        case 'switch-pet':
          if (this.getPetByID(item.action.pet).owner !== player) throw new Error('Invalid queued switch')
          break
        case 'do-nothing':
          break
        default:
          throw new Error('Invalid queued action')
      }
    }
  }
  private validateSnapshot(snapshot: BattleSnapshot) {
    const { state, rng } = snapshot
    if (!Number.isSafeInteger(snapshot.phases.nextId) || snapshot.phases.nextId < 0)
      throw new Error('Invalid phase counter')
    for (const row of snapshot.phases.history) {
      const validId = (id: string) => /^@phase\/\d+$/.test(id) && Number(id.slice(7)) < snapshot.phases.nextId
      if (
        !validId(row.id) ||
        (row.parentId !== null && !validId(row.parentId)) ||
        !Object.values(PhaseState).includes(row.state) ||
        row.turn < 0 ||
        row.turn > state.turn
      )
        throw new Error('Invalid saved phase history')
    }
    if (state.turnContext) {
      if (state.turnContext.number !== state.turn) throw new Error('Invalid saved turn number')
      for (const id of [
        ...Object.keys(state.turnContext.petData),
        ...state.turnContext.plannedPetIds,
        ...state.turnContext.executedPetIds,
      ])
        this.getPetByID(id)
    }
    if (
      state.id !== this.id ||
      !Number.isSafeInteger(state.turn) ||
      state.turn < 0 ||
      !Number.isSafeInteger(snapshot.nextId) ||
      snapshot.nextId < 0
    )
      throw new Error('Invalid snapshot counters')
    if (
      !['created', 'selection', 'turn-start', 'action', 'turn-end', 'switch', 'ended'].includes(state.phase.kind) ||
      !['unstarted', 'active', 'ended'].includes(state.status)
    )
      throw new Error('Invalid phase/status')
    if (
      (state.status === 'ended') !== (state.phase.kind === 'ended') ||
      (state.status === 'unstarted') !== (state.phase.kind === 'created')
    )
      throw new Error('Inconsistent phase/status')
    if (state.victor !== null) this.getPlayerByID(state.victor)
    if (
      rng.seed !== this.initial.seed ||
      ![rng.a, rng.b, rng.c, rng.d].every(n => Number.isInteger(n) && n >= -2147483648 && n <= 4294967295)
    )
      throw new Error('Invalid RNG state')
    if (state.players.length !== 2) throw new Error('Invalid saved players')
    const markIds = new Set<string>()
    const validateMarks = (marks: MarkState[], owner: Pet | Battle) => {
      for (const mark of marks) {
        this.content.mark(mark.baseId)
        if (
          mark.ownerId !== owner.id ||
          markIds.has(mark.id) ||
          !/^@mark\/\d+$/.test(mark.id) ||
          Number(mark.id.slice(6)) >= snapshot.nextId ||
          !mark.isActive
        )
          throw new Error('Invalid saved mark identity')
        markIds.add(mark.id)
        requireNumber(mark.stack, 'saved stack', 1)
        if (!Number.isInteger(mark.duration) || mark.duration < -1 || mark.stack > mark.config.maxStacks)
          throw new Error('Invalid saved mark')
      }
    }
    validateMarks(state.marks, this)
    for (let index = 0; index < 2; index++) {
      const saved = state.players[index],
        player = this.players[index]
      if (
        saved.id !== player.id ||
        saved.name !== player.name ||
        saved.team.length !== player.team.length ||
        !player.team.some(p => p.id === saved.activePetId)
      )
        throw new Error('Invalid saved team')
      requireNumber(saved.currentRage, 'saved rage')
      requireNumber(saved.maxRage, 'saved max rage')
      if (saved.currentRage > saved.maxRage) throw new Error('Invalid saved rage')
      for (let i = 0; i < saved.team.length; i++) {
        const pet = player.team[i],
          s = saved.team[i]
        if (canonicalData(pet.build) !== canonicalData(s.build) || s.skills.length !== pet.skills.length)
          throw new Error('Saved build mismatch')
        requireNumber(s.currentHp, 'saved HP')
        requireNumber(s.lastSkillUsedTimes, 'saved skill count')
        for (const stage of Object.values(s.stages))
          if (!Number.isInteger(stage) || Math.abs(stage) > 6) throw new Error('Invalid saved stage')
        for (let j = 0; j < s.skills.length; j++) {
          const skill = s.skills[j]
          if (skill.id !== pet.skills[j].id || skill.baseId !== pet.skills[j].base.id)
            throw new Error('Invalid saved skill')
          for (const v of [skill.power, skill.accuracy, skill.rage]) requireNumber(v, 'saved skill value')
        }
        if (s.lastSkillId !== null && !pet.skills.some(skill => skill.id === s.lastSkillId))
          throw new Error('Invalid last skill')
        validateMarks(s.marks, pet)
      }
    }
    for (const [i, event] of snapshot.events.entries())
      if (event.sequence !== i + 1 || event.turn > state.turn) throw new Error('Invalid event order')
    for (const [i, entry] of snapshot.actions.entries()) {
      if (entry.sequence !== i + 1 || entry.turn > state.turn || !['selection', 'switch'].includes(entry.phase))
        throw new Error('Invalid action order')
      this.getPlayerByID(entry.action.player)
    }
    const participants = new Set<string>()
    for (const action of state.phase.pending) {
      this.getPlayerByID(action.player)
      if (participants.has(action.player)) throw new Error('Duplicate pending player')
      participants.add(action.player)
    }
    for (const item of state.phase.queue) {
      const pet = this.getPetByID(item.actorPetId)
      if (pet.owner.id !== item.action.player) throw new Error('Invalid queued actor')
    }
  }
}
export function createBattle(options: BattleOptions, content: BattleContent, registry?: EffectRegistry) {
  return new Battle(options, content, registry)
}
export function restoreBattle(snapshot: BattleSnapshot, content: BattleContent, registry?: EffectRegistry) {
  return Battle.restore(snapshot, content, registry)
}
export function replayBattle(fixture: ReplayFixture, content: BattleContent, registry?: EffectRegistry): Battle {
  const data = copyData(fixture)
  if (data.version !== 1) throw new Error('Unsupported replay version')
  const battle = createBattle(data.initial, content, registry)
  if (battle.content.identity !== data.contentIdentity) throw new Error('Replay content mismatch')
  battle.start()
  for (const entry of data.actions) {
    if (
      entry.turn !== battle.turn ||
      entry.phase !== battle.phase.kind ||
      entry.sequence !== battle.getActionLog().length + 1
    )
      throw new Error('Replay action order mismatch')
    if (!battle.submitAction(entry.action).accepted) throw new Error('Replay action rejected')
  }
  if (
    canonicalData(battle.getEvents()) !== canonicalData(data.expectedEvents) ||
    canonicalData(battle.getState()) !== canonicalData(data.expectedState)
  )
    throw new Error('Replay event/state mismatch')
  return battle
}
