import type { Battle } from '../battle.js'
import {
  UseSkillContext,
  DamageContext,
  HealContext,
  RageContext,
  AddMarkContext,
  RemoveMarkContext,
  StackContext,
  ConsumeStackContext,
  MarkTransferContext,
  SwitchPetContext,
  EffectContext,
  TransformContext,
  type ContextNode,
} from '../context.js'
import { BattlePhaseBase, SynchronousPhase, PhaseState, type PhaseResult } from './base.js'
import { copyData } from '../data.js'

export interface PhaseTrace {
  id: string
  parentId: string | null
  kind: string
  state: PhaseState
  turn: number
}
export interface PhaseManagerState {
  nextId: number
  history: PhaseTrace[]
}
export class PhaseManager {
  private nextId = 0
  private history: PhaseTrace[] = []
  private stack: BattlePhaseBase<ContextNode, unknown>[] = []
  private observers = new Set<(phase: BattlePhaseBase<ContextNode, unknown>) => void>()
  constructor(readonly battle: Battle) {}
  get currentContext(): ContextNode {
    return this.stack.at(-1)?.context ?? this.battle
  }
  onExecutionEvent(observer: (phase: BattlePhaseBase<ContextNode, unknown>) => void): () => void {
    this.observers.add(observer)
    return () => this.observers.delete(observer)
  }
  execute<C extends ContextNode, R>(phase: BattlePhaseBase<C, R>): PhaseResult<R> {
    this.battle.assertInOperation()
    if (phase.battle !== this.battle) throw new Error('Phase context belongs to another battle')
    this.assertContext(phase.context)
    if (phase.id === null) {
      phase.id = `@phase/${this.nextId++}`
      phase.parentPhaseId = this.stack.at(-1)?.id ?? null
    }
    this.stack.push(phase)
    try {
      if (phase.state === PhaseState.Pending) phase.initialize()
      return phase.execute()
    } finally {
      this.history.push({
        id: phase.id,
        parentId: phase.parentPhaseId,
        kind: phase.kind,
        state: phase.state,
        turn: this.battle.turn,
      })
      try {
        for (const observer of this.observers) observer(phase)
      } finally {
        this.stack.pop()
        phase.cleanup()
      }
    }
  }
  assertContext(context: ContextNode) {
    const owned = (...entities: { readonly battle: Battle }[]) => {
      for (const entity of entities)
        if (entity.battle !== this.battle) throw new Error('Operation participant belongs to another battle')
    }
    if (context instanceof UseSkillContext) {
      owned(context.player, context.pet, context.skill, context.target)
      if (context.pet.owner !== context.player || context.skill.owner !== context.pet)
        throw new Error('Invalid skill ownership')
    } else if (context instanceof DamageContext || context instanceof HealContext) owned(context.source, context.target)
    else if (context instanceof RageContext) owned(context.player)
    else if (context instanceof AddMarkContext) owned(context.target)
    else if (context instanceof RemoveMarkContext || context instanceof ConsumeStackContext) owned(context.mark)
    else if (context instanceof StackContext) owned(context.existingMark)
    else if (context instanceof MarkTransferContext) owned(context.mark, context.target)
    else if (context instanceof SwitchPetContext) {
      owned(context.player, context.incoming, context.outgoing)
      if (context.incoming.owner !== context.player || context.outgoing.owner !== context.player)
        throw new Error('Invalid switch ownership')
    } else if (context instanceof EffectContext) owned(context.source)
    else if (context instanceof TransformContext) owned(context.target)
  }
  executeSync<C extends ContextNode, R>(phase: SynchronousPhase<C, R>): R {
    const result = this.execute(phase)
    if (result.state !== PhaseState.Completed) throw new Error('Synchronous phase cannot wait')
    return result.value
  }
  snapshot(): PhaseManagerState {
    return copyData({ nextId: this.nextId, history: this.history })
  }
  restore(state: PhaseManagerState) {
    this.nextId = state.nextId
    this.history = copyData(state.history)
  }
}
