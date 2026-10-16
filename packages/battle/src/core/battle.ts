import { AttackTargetOpinion, Category, EffectTrigger, ELEMENT_CHART } from '@arcadia-eternity/const'
import { ContentCatalog, type BattleContent, type PlayerBuild } from './content.js'
import { copyData, canonicalData, freezeData, requireNumber, type JsonObject } from './data.js'
import { EffectRegistry } from './effects.js'
import type { DamageContext, OperationContext, RageContext, SkillContext, SwitchContext } from './context.js'
import { GameRng, type RngState } from './rng.js'
import { Player, type PlayerState } from './player.js'
import { Pet, type StageStat } from './pet.js'
import { Skill } from './skill.js'
import { Mark, type MarkState } from './mark.js'
import { STAGE_STATS } from './stat-stage.js'
import { Phase, type QueuedAction, type SkillPlan } from './phase.js'

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
  phase: ReturnType<Phase['getState']>
}
export interface BattleSnapshot {
  version: 1
  contentIdentity: string
  initial: BattleOptions
  state: BattleState
  rng: RngState
  nextId: number
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
export class Battle {
  readonly id: string
  readonly players: [Player, Player]
  readonly content: ContentCatalog
  readonly initial: BattleOptions
  readonly registry: EffectRegistry
  phase = new Phase()
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
  private lastKiller: string | null = null

  constructor(options: BattleOptions, content: BattleContent, registry = new EffectRegistry()) {
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
    this.players = options.players.map(p => new Player(p, this, this.content)) as [Player, Player]
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
  private emit(type: string, data: JsonObject) {
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
    this.operation(() => {
      if (this.status !== 'unstarted') throw new Error('Battle already started')
      this.status = 'active'
      for (const player of this.players)
        for (const pet of player.team) for (const id of [pet.ability, pet.emblem]) if (id) this.addMark(pet, id)
      this.emit('battleStart', { playerAId: this.playerA.id, playerBId: this.playerB.id })
      this.fire(EffectTrigger.OnBattleStart, { kind: 'turn', battle: this })
      this.setDecisionPhase()
    })
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
    switch (this.phase.kind) {
      case 'created':
      case 'ended':
        return false
      case 'selection': {
        if (this.phase.pending.length !== 2) return false
        const queue: QueuedAction[] = this.players.map(player => ({
          action: this.phase.pending.find(a => a.player === player.id)!,
          actorPetId: player.activePet.id,
        }))
        this.phase.queue = queue
        this.phase.pending = []
        this.phase.kind = 'turn-start'
        return true
      }
      case 'turn-start': {
        this.turn++
        this.lastKiller = null
        this.emit('turnStart', { turn: this.turn })
        const queue = this.phase.queue
        // V1 applies BeforeSort before TurnStart; plans store only data for resumption.
        for (const item of queue)
          if (item.action.type === 'use-skill') {
            const ctx = this.skillContext(
              this.getPlayerByID(item.action.player),
              this.getPetByID(item.actorPetId),
              this.getSkillByID(item.action.skill),
            )
            this.fire(EffectTrigger.BeforeSort, ctx)
            item.skillPlan = {
              available: ctx.available,
              power: ctx.power,
              accuracy: ctx.accuracy,
              rage: ctx.rage,
              category: ctx.category,
              element: ctx.element,
              priority: ctx.priority,
              ignoreStageStrategy: ctx.ignoreStageStrategy,
            }
          }
        // Stable seat order breaks speed ties, as in V1; no random comparator.
        queue.sort((a, b) => {
          if (a.action.type !== b.action.type && (a.action.type === 'switch-pet' || b.action.type === 'switch-pet'))
            return a.action.type === 'switch-pet' ? -1 : 1
          if (a.action.type === 'use-skill' && b.action.type === 'use-skill')
            return (
              (b.skillPlan?.priority ?? 0) - (a.skillPlan?.priority ?? 0) ||
              this.getPetByID(b.actorPetId).stat.spe - this.getPetByID(a.actorPetId).stat.spe
            )
          return 0
        })
        this.fire(EffectTrigger.TurnStart, { kind: 'turn', battle: this })
        this.phase.kind = 'action'
        return true
      }
      case 'action': {
        const next = this.phase.queue.shift()
        if (!next) {
          this.phase.kind = 'turn-end'
          return true
        }
        const player = this.getPlayerByID(next.action.player)
        if (next.action.type === 'switch-pet') this.switchPet(player, this.getPetByID(next.action.pet))
        if (next.action.type === 'use-skill')
          this.useSkill(player, this.getPetByID(next.actorPetId), this.getSkillByID(next.action.skill), next.skillPlan)
        this.cleanupMarks()
        return true
      }
      case 'turn-end': {
        this.fire(EffectTrigger.TurnEnd, { kind: 'turn', battle: this })
        // V1 grants rage before forced replacement, including a fainted active pet (#201-03).
        for (const player of this.players) this.changeRage(player, player.activePet.stat.ragePerTurn, 'add', 'turn')
        for (const mark of this.activeMarks()) {
          if (mark.config.persistent) continue
          if (mark.duration > 0) {
            mark.duration--
            this.emit('markDuration', { markId: mark.id, duration: mark.duration })
          }
          if (mark.duration === 0) {
            this.fire(EffectTrigger.OnMarkDurationEnd, { kind: 'mark', battle: this, mark }, [mark])
            this.removeMark(mark, true)
          }
        }
        this.cleanupMarks()
        this.emit('turnEnd', { turn: this.turn })
        this.setDecisionPhase()
        return true
      }
      case 'switch': {
        const expected = [...this.phase.forced, ...(this.phase.reward ? [this.phase.reward] : [])]
        if (!expected.every(id => this.phase.pending.some(a => a.player === id))) return false
        const pending = this.phase.pending
        for (const id of expected) {
          const action = pending.find(a => a.player === id)!
          if (action.type === 'switch-pet') this.switchPet(this.getPlayerByID(id), this.getPetByID(action.pet))
        }
        this.phase.pending = []
        this.setDecisionPhase(false)
        return true
      }
    }
  }
  private setDecisionPhase(reward = true) {
    const dead = this.players.filter(p => p.team.every(pet => !pet.isAlive))
    if (dead.length) {
      this.finish(
        dead.length === 2 ? null : this.getOpponent(dead[0]).id,
        dead.length === 2 ? 'draw' : 'all_pet_fainted',
      )
      return
    }
    const forced = this.players.filter(p => !p.activePet.isAlive).map(p => p.id)
    const killer = this.lastKiller ? this.getPetByID(this.lastKiller).owner : null
    const bonus =
      reward &&
      forced.length &&
      this.initial.allowFaintSwitch &&
      killer?.activePet.isAlive &&
      !forced.includes(killer.id)
        ? killer.id
        : null
    this.phase = new Phase(forced.length ? 'switch' : 'selection', [], [], forced, bonus)
    this.lastKiller = null
    if (forced.length) this.emit('switchPrompt', { forced, reward: bonus })
    else this.emit('turnAction', { players: this.players.map(p => p.id) })
  }
  private finish(victor: string | null, reason: string) {
    this.status = 'ended'
    this.victor = victor
    this.endReason = reason
    this.phase = new Phase('ended')
    this.lastKiller = null
    this.emit('battleEnd', { winner: victor, reason })
  }
  /** The complete #205 trigger pipeline can replace this seam without changing save data. */
  private fire(trigger: EffectTrigger, context: OperationContext, only?: Mark[]) {
    this.emit('trigger', { trigger })
    const sources: (Mark | Skill)[] = only ?? [
      ...this.activeMarks(),
      ...(context.kind === 'skill' ? [context.skill] : []),
    ]
    const calls = sources
      .flatMap(source =>
        source instanceof Mark && !source.isActive && trigger !== EffectTrigger.OnMarkDestroy
          ? []
          : source.base.effects.map(ref => ({ source, ref, definition: this.registry.resolve(ref) })),
      )
      .filter(c => c.definition.triggers.includes(trigger))
      .sort((a, b) => (b.definition.priority ?? 0) - (a.definition.priority ?? 0))
    for (const call of calls) {
      if (call.source instanceof Mark && !call.source.isActive && trigger !== EffectTrigger.OnMarkDestroy) continue
      const result: unknown = call.definition.execute(context, call.source, copyData(call.ref.params))
      if (result !== undefined) throw new Error('Trusted effects must execute synchronously and return void')
    }
  }
  private activeMarks(): Mark[] {
    return [...this.marks, ...this.players.flatMap(p => p.activePet.marks)].filter(m => m.isActive)
  }
  private assertExecuting() {
    if (!this.busy) throw new Error('Rule mutations require a battle operation')
  }
  changeRage(player: Player, amount: number, direction: RageContext['direction'], reason: string) {
    this.assertExecuting()
    requireNumber(amount, 'rage amount')
    const ctx: RageContext = { kind: 'rage', battle: this, player, amount, direction, reason, available: true }
    if (direction !== 'setting')
      this.fire(direction === 'add' ? EffectTrigger.BeforeRageGain : EffectTrigger.BeforeRageLoss, ctx)
    if (!ctx.available) return
    requireNumber(ctx.amount, 'modified rage')
    const before = player.currentRage
    const value = Math.floor(ctx.amount)
    player.settingRage(direction === 'setting' ? value : before + (direction === 'add' ? value : -value))
    this.emit('rageChange', {
      playerId: player.id,
      reason,
      type: direction,
      amount: value,
      before,
      newRage: player.currentRage,
    })
    if (direction !== 'setting')
      this.fire(direction === 'add' ? EffectTrigger.OnRageGain : EffectTrigger.OnRageLoss, ctx)
  }
  addStatStage(pet: Pet, stat: StageStat, amount: number) {
    this.assertExecuting()
    if (!STAGE_STATS.includes(stat) || !Number.isInteger(amount)) throw new Error('Invalid stage change')
    const context = { kind: 'stage' as const, battle: this, pet, stat, amount }
    this.fire(EffectTrigger.OnBeforeAddMark, context)
    const before = pet.stages[stat]
    const next = Math.max(-6, Math.min(6, before + context.amount))
    for (const mark of [...pet.marks]) if (mark.base.id.startsWith(`stat_stage_${stat}_`)) this.removeMark(mark, true)
    if (next !== 0) this.addMark(pet, `stat_stage_${stat}_${next > 0 ? 'up' : 'down'}`, Math.abs(next))
    this.emit('statStageChange', { petId: pet.id, stat, before, stage: next })
  }

  addMark(owner: Pet | Battle, baseId: string, stack = 1, creatorId: string | null = null): Mark {
    this.assertExecuting()
    requireNumber(stack, 'mark stack', 1)
    const base = this.content.mark(baseId)
    const existing = owner.marks.find(m => m.base.id === baseId && m.isActive)
    if (existing) {
      this.fire(EffectTrigger.OnStackBefore, { kind: 'mark', battle: this, mark: existing }, [existing])
      existing.merge(stack)
      this.fire(EffectTrigger.OnStack, { kind: 'mark', battle: this, mark: existing }, [existing])
      this.cleanupMarks()
      return existing
    }
    for (const mark of [...owner.marks])
      if (base.config.mutexGroup && mark.config.mutexGroup === base.config.mutexGroup) this.removeMark(mark, true)
    const mark = new Mark(`@mark/${this.nextId++}`, base, owner, stack, creatorId)
    this.fire(EffectTrigger.OnBeforeAddMark, { kind: 'mark', battle: this, mark })
    owner.marks.push(mark)
    this.emit('markAdded', {
      markId: mark.id,
      baseMarkId: baseId,
      ownerId: owner.id,
      stack: mark.stack,
      duration: mark.duration,
    })
    this.fire(EffectTrigger.OnMarkCreated, { kind: 'mark', battle: this, mark }, [mark])
    this.fire(EffectTrigger.OnAnyMarkAdded, { kind: 'mark', battle: this, mark })
    return mark
  }
  removeMark(mark: Mark, force = false) {
    this.assertExecuting()
    if (!mark.isActive || (!force && !mark.config.destroyable)) return
    this.fire(EffectTrigger.OnRemoveMark, { kind: 'mark', battle: this, mark }, [mark])
    mark.isActive = false
    this.fire(EffectTrigger.OnMarkDestroy, { kind: 'mark', battle: this, mark }, [mark])
    this.emit('markRemoved', { markId: mark.id, baseMarkId: mark.base.id, ownerId: mark.owner.id })
    mark.owner.marks = mark.owner.marks.filter(m => m !== mark)
  }
  consumeMarkStacks(mark: Mark, amount: number): number {
    this.assertExecuting()
    requireNumber(amount, 'stack consumption')
    if (!mark.isActive) return 0
    this.fire(EffectTrigger.OnBeforeConsumeStack, { kind: 'mark', battle: this, mark }, [mark])
    const consumed = Math.min(mark.stack, amount)
    mark.stack -= consumed
    this.fire(EffectTrigger.OnConsumeStack, { kind: 'mark', battle: this, mark }, [mark])
    if (mark.stack <= 0) this.removeMark(mark, true)
    return consumed
  }
  private cleanupMarks() {
    for (const owner of [this, ...this.players.flatMap(p => p.team)])
      owner.marks = owner.marks.filter(m => m.isActive && m.stack > 0)
  }
  private switchPet(player: Player, incoming: Pet) {
    const outgoing = player.activePet
    if (!incoming.isAlive || incoming === outgoing || incoming.owner !== player) return
    const ctx: SwitchContext = { kind: 'switch', battle: this, player, outgoing, incoming }
    this.fire(EffectTrigger.OnSwitchOut, ctx)
    this.fire(EffectTrigger.OnOwnerSwitchOut, ctx, [...outgoing.marks])
    for (const mark of [...outgoing.marks]) {
      if (mark.config.transferOnSwitch || (!outgoing.isAlive && mark.config.inheritOnFaint)) {
        outgoing.marks = outgoing.marks.filter(m => m !== mark)
        mark.owner = incoming
        incoming.marks.push(mark)
      } else if (!mark.config.keepOnSwitchOut) this.removeMark(mark, true)
    }
    this.emit('switchOut', { playerId: player.id, petId: outgoing.id })
    player.activePet = incoming
    incoming.appeared = true
    this.emit('switchIn', { playerId: player.id, petId: incoming.id })
    this.fire(EffectTrigger.OnSwitchIn, ctx)
    this.fire(EffectTrigger.OnOwnerSwitchIn, ctx, [...incoming.marks])
    // V1 assignment rounding (#201-01), not floor(rage * .2) subtraction.
    this.changeRage(player, player.currentRage - Math.floor(player.currentRage * 0.8), 'reduce', 'switch')
  }
  private skillContext(player: Player, pet: Pet, skill: Skill): SkillContext {
    // Resolve target at execution, after switches (#201-02).
    const target = skill.target === AttackTargetOpinion.self ? pet : this.getOpponent(player).activePet
    const ctx: SkillContext = {
      kind: 'skill',
      battle: this,
      player,
      pet,
      skill,
      target,
      selectTarget: skill.target,
      priority: skill.priority,
      available: true,
      power: skill.power,
      accuracy: skill.accuracy,
      rage: skill.rage,
      category: skill.category,
      element: skill.element,
      ignoreStageStrategy: skill.base.ignoreOpponentStageStrategy,
      hit: false,
      crit: false,
      hitCount: 1,
      currentHit: 0,
    }
    return ctx
  }
  private useSkill(player: Player, pet: Pet, skill: Skill, plan?: SkillPlan) {
    const ctx = Object.assign(this.skillContext(player, pet, skill), plan)
    const target = ctx.target
    this.fire(EffectTrigger.BeforeUseSkillCheck, ctx)
    const reason = !ctx.available
      ? 'disabled'
      : !pet.isAlive || player.activePet !== pet
        ? 'faint'
        : player.currentRage < ctx.rage
          ? 'noRage'
          : !target.isAlive
            ? 'noTarget'
            : null
    if (reason) {
      this.emit('skillFail', { petId: pet.id, skillId: skill.id, reason })
      return
    }
    pet.rememberSkill(skill)
    this.emit('skillUse', {
      petId: pet.id,
      skillId: skill.id,
      baseSkillId: skill.base.id,
      target: skill.target,
      targetId: target.id,
      rage: ctx.rage,
    })
    this.changeRage(player, ctx.rage, 'reduce', 'skill')
    this.fire(EffectTrigger.AfterUseSkillCheck, ctx)
    ctx.hitCount = typeof skill.multihit === 'number' ? skill.multihit : this.rng.nextInt(...skill.multihit)
    ctx.hit =
      this.random() * 100 <
      (skill.sureHit ? 100 : ((ctx.accuracy * pet.stat.accuracy) / 100) * (1 - target.stat.evasion / 100))
    if (!ctx.hit) {
      this.emit('skillMiss', { petId: pet.id, targetId: target.id, skillId: skill.id })
      this.fire(EffectTrigger.OnMiss, ctx)
    } else {
      ctx.crit = this.random() * 100 < (skill.sureCrit ? 100 : pet.stat.critRate)
      this.fire(EffectTrigger.BeforeMultiHit, ctx)
      for (ctx.currentHit = 1; ctx.currentHit <= ctx.hitCount && target.isAlive; ctx.currentHit++) {
        this.fire(EffectTrigger.BeforeHit, ctx)
        if (ctx.category !== Category.Status) {
          const factor = 0.85 + this.random() * 0.15
          const attackStats = pet.stat
          const defenseStats = target.getEffectiveStat(ctx.ignoreStageStrategy)
          const physical =
            ctx.category === Category.Physical ||
            (ctx.category === Category.Climax && attackStats.atk > attackStats.spa)
          const effectiveness = ELEMENT_CHART[ctx.element][target.element]
          const stab = pet.element === ctx.element ? 1.5 : 1
          const base = Math.floor(
            (((2 * pet.level) / 5 + 2) * ctx.power * (physical ? attackStats.atk : attackStats.spa)) /
              (physical ? defenseStats.def : defenseStats.spd) /
              50 +
              2,
          )
          const damage = Math.floor(Math.floor(base * effectiveness * stab * (ctx.crit ? 2 : 1)) * factor)
          const damageCtx: DamageContext = {
            kind: 'damage',
            battle: this,
            source: pet,
            target,
            amount: damage,
            available: true,
            crit: ctx.crit,
            effectiveness,
            ignoreShield: skill.ignoreShield,
            damageType: physical ? 'Physical' : 'Special',
          }
          ctx.damage = damageCtx
          if (ctx.crit) this.fire(EffectTrigger.OnCritPreDamage, ctx)
          this.fire(EffectTrigger.PreDamage, ctx)
          const dealt = this.damage(damageCtx)
          const gained = Math.floor((dealt * 49) / target.stat.maxHp)
          if (gained > 0) this.changeRage(target.owner, gained, 'add', 'damage')
        }
        this.fire(EffectTrigger.OnHit, ctx)
      }
      if (ctx.category !== Category.Status) this.changeRage(player, 15, 'add', 'skillHit')
    }
    if (!target.isAlive) {
      this.lastKiller = pet.id
      this.emit('petDefeated', { petId: target.id, killerId: pet.id })
      this.fire(EffectTrigger.OnDefeat, ctx)
    }
    this.fire(EffectTrigger.SkillUseEnd, ctx)
    this.emit('skillUseEnd', { petId: pet.id })
  }
  damage(ctx: DamageContext): number {
    this.assertExecuting()
    this.fire(EffectTrigger.OnBeforeCalculateDamage, ctx)
    if (!ctx.available) {
      this.emit('damageFail', { sourceId: ctx.source.id, targetId: ctx.target.id, reason: 'disabled' })
      return 0
    }
    requireNumber(ctx.amount, 'damage')
    ctx.amount = Math.floor(ctx.amount)
    if (!ctx.ignoreShield) {
      this.fire(EffectTrigger.Shield, ctx)
      for (const mark of [...ctx.target.marks])
        if (mark.isActive && mark.config.isShield) ctx.amount -= this.consumeMarkStacks(mark, ctx.amount)
    }
    ctx.target.currentHp = Math.max(0, ctx.target.currentHp - ctx.amount)
    this.fire(EffectTrigger.OnDamage, ctx)
    this.emit('damage', {
      sourceId: ctx.source.id,
      targetId: ctx.target.id,
      damage: ctx.amount,
      isCrit: ctx.crit,
      effectiveness: ctx.effectiveness,
      damageType: ctx.damageType,
      currentHp: ctx.target.currentHp,
      maxHp: ctx.target.stat.maxHp,
    })
    this.fire(EffectTrigger.PostDamage, ctx)
    if (ctx.crit) this.fire(EffectTrigger.OnCritPostDamage, ctx)
    return ctx.amount
  }
  heal(source: Pet, target: Pet, amount: number) {
    this.assertExecuting()
    requireNumber(amount, 'heal')
    const ctx = { kind: 'heal' as const, battle: this, source, target, amount, available: true }
    this.fire(EffectTrigger.OnBeforeHeal, ctx)
    if (!ctx.available || !target.isAlive) return
    requireNumber(ctx.amount, 'modified heal')
    const before = target.currentHp
    target.currentHp = Math.min(target.stat.maxHp, before + Math.floor(ctx.amount))
    this.fire(EffectTrigger.OnHeal, ctx)
    this.emit('heal', { sourceId: source.id, targetId: target.id, amount: target.currentHp - before })
  }
  getState(): BattleState {
    return copyData({
      id: this.id,
      turn: this.turn,
      status: this.status,
      victor: this.victor,
      endReason: this.endReason,
      lastKillerId: this.lastKiller,
      players: this.players.map(p => p.getState()),
      marks: this.marks.map(m => m.getState()),
      phase: this.phase.getState(),
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
      events: this.journal,
      actions: this.actionLog,
    })
  }
  exportReplay(): ReplayFixture {
    if (!['selection', 'switch', 'ended'].includes(this.phase.kind) || this.busy)
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
    this.phase = new Phase(
      state.phase.kind,
      copyData(state.phase.queue),
      copyData(state.phase.pending),
      [...state.phase.forced],
      state.phase.reward,
    )
    this.rng = GameRng.fromState(snapshot.rng)
    this.nextId = snapshot.nextId
    this.journal = copyData(snapshot.events)
    this.actionLog = copyData(snapshot.actions)
    this.lastKiller = state.lastKillerId
    const restoreMarks = (states: MarkState[], owner: Pet | Battle) =>
      states.map(s => {
        const mark = new Mark(s.id, this.content.mark(s.baseId), owner, s.stack, s.creatorId)
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
    if (this.lastKiller !== null) this.getPetByID(this.lastKiller)
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
