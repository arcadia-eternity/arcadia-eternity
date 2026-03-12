// battle/src/v2/systems/message-bridge.ts
// MessageBridge — maps v2 EventBus events to v1 BattleMessage format.

import type { World, EventBus, GameEvent } from '@arcadia-eternity/engine'
import {
  AttackTargetOpinion,
  BattleMessageType,
  type BattleMessage,
  type BattleState,
  type MarkMessage,
  type playerId,
} from '@arcadia-eternity/const'
import { create as createDiffPatcher, type DiffPatcher } from 'jsondiffpatch'
import { worldToBattleState, type StateSerializerSystems } from './state-serializer.js'
import type { MarkData } from '../schemas/mark.schema.js'

export interface MessageViewOptions {
  viewerId?: playerId
  showHidden?: boolean
  showAll?: boolean
}

interface Subscriber {
  callback: (msg: BattleMessage) => void
  options?: MessageViewOptions
  lastState?: BattleState
}

export class MessageBridge {
  private subscribers: Subscriber[] = []
  private unsubscribers: Array<() => void> = []
  private diffPatcher: DiffPatcher
  private sequenceId = 0
  private battleId: string

  constructor(
    private world: World,
    private bus: EventBus,
    private systems: StateSerializerSystems,
    private defaultShowHidden = false,
    battleId?: string,
  ) {
    this.battleId = battleId ?? 'v2-battle'
    this.diffPatcher = createDiffPatcher({
      objectHash: (obj: unknown) => {
        if (obj && typeof obj === 'object' && 'id' in obj) {
          const id = (obj as { id?: unknown }).id
          if (typeof id === 'string') return id
        }
        return JSON.stringify(obj)
      },
    })
    this.setupListeners()
  }

  subscribe(callback: (msg: BattleMessage) => void, options?: MessageViewOptions): () => void {
    this.subscribers.push({
      callback,
      options,
    })
    return () => {
      const idx = this.subscribers.findIndex(s => s.callback === callback)
      if (idx !== -1) this.subscribers.splice(idx, 1)
    }
  }

  setWorld(world: World): void {
    this.world = world
  }

  cleanup(): void {
    for (const unsub of this.unsubscribers) unsub()
    this.unsubscribers = []
    this.subscribers = []
  }

  private emitMessage(type: BattleMessageType, data: Record<string, unknown>): void {
    this.sequenceId++
    for (const subscriber of this.subscribers) {
      const newState = this.getStateByOptions(subscriber.options)
      const baseState = subscriber.lastState ?? {}
      const stateDelta = this.diffPatcher.diff(baseState, newState)
      subscriber.lastState = newState

      const msg = {
        type,
        sequenceId: this.sequenceId,
        battleId: this.battleId,
        data,
        stateDelta: stateDelta ?? {},
      } as unknown as BattleMessage
      subscriber.callback(msg)
    }
  }

  private getStateByOptions(options?: MessageViewOptions): BattleState {
    if (options?.showAll) {
      return worldToBattleState(this.world, this.systems, undefined, true)
    }
    if (options?.viewerId) {
      return worldToBattleState(this.world, this.systems, options.viewerId, options.showHidden ?? false)
    }
    if (options?.showHidden !== undefined) {
      return worldToBattleState(this.world, this.systems, undefined, options.showHidden)
    }
    // v1-compatible default: no viewer + no showHidden means hidden perspective.
    return worldToBattleState(this.world, this.systems, '' as playerId, this.defaultShowHidden)
  }

  private on(eventType: string, handler: (data: Record<string, unknown>) => void): void {
    this.unsubscribers.push(this.bus.on(eventType, (event: GameEvent) => {
      handler(event.data)
    }))
  }

  private toMarkMessage(mark: MarkData): MarkMessage {
    return {
      id: mark.id as MarkMessage['id'],
      baseId: mark.baseMarkId as MarkMessage['baseId'],
      stack: this.systems.markSystem.getStack(this.world, mark.id),
      duration: this.systems.markSystem.getDuration(this.world, mark.id),
      isActive: this.systems.markSystem.isActive(this.world, mark.id),
      config: this.systems.markSystem.getConfig(this.world, mark.id) as MarkMessage['config'],
    }
  }

  private setupListeners(): void {
    this.on('battleStart', () => {
      this.emitMessage(BattleMessageType.BattleStart, {})
    })

    this.on('turnStart', (data) => {
      this.emitMessage(BattleMessageType.TurnStart, { turn: data.turn })
    })

    this.on('turnEnd', (data) => {
      this.emitMessage(BattleMessageType.TurnEnd, { turn: data.turn })
    })

    this.on('battleEnd', (data) => {
      const rawReason = String(data.reason ?? 'all_pet_fainted')
      const reason = rawReason === 'timeout'
        ? 'total_time_timeout'
        : (rawReason === 'allFainted' ? 'all_pet_fainted' : rawReason)
      this.emitMessage(BattleMessageType.BattleEnd, {
        winner: data.winner ?? null,
        reason,
      })
    })

    this.on('skillUse', (data) => {
      const skillId = String(data.skillId)
      const skill = this.systems.skillSystem.get(this.world, skillId)
      const target =
        typeof data.target === 'string' && Object.values(AttackTargetOpinion).includes(data.target as AttackTargetOpinion)
          ? (data.target as AttackTargetOpinion)
          : AttackTargetOpinion.opponent
      this.emitMessage(BattleMessageType.SkillUse, {
        user: data.petId,
        target,
        skill: data.skillId,
        baseSkill: skill?.baseSkillId ?? data.baseSkillId ?? data.skillId,
        rage: typeof data.rage === 'number' ? data.rage : 0,
      })
    })

    this.on('skillFail', (data) => {
      const reasonMap: Record<string, string> = {
        noRage: 'no_rage',
        noTarget: 'invalid_target',
        disabled: 'disabled',
        faint: 'faint',
      }
      const rawReason = String(data.reason ?? '')
      this.emitMessage(BattleMessageType.SkillUseFail, {
        user: data.petId,
        skill: data.skillId,
        reason: reasonMap[rawReason] ?? 'disabled',
      })
    })

    this.on('skillMiss', (data) => {
      this.emitMessage(BattleMessageType.SkillMiss, {
        user: data.petId,
        target: data.targetId,
        skill: data.skillId,
        reason: 'accuracy',
      })
    })

    this.on('skillUseEnd', (data) => {
      this.emitMessage(BattleMessageType.SkillUseEnd, { user: data.petId })
    })

    this.on('damage', (data) => {
      this.emitMessage(BattleMessageType.Damage, {
        source: data.sourceId,
        target: data.targetId,
        damage: data.damage,
        isCrit: data.isCrit,
        effectiveness: data.effectiveness,
        damageType: data.damageType,
        currentHp: data.currentHp,
        maxHp: data.maxHp,
      })
    })

    this.on('damageFail', (data) => {
      this.emitMessage(BattleMessageType.DamageFail, {
        source: data.sourceId,
        target: data.targetId,
        reason: data.reason,
      })
    })

    this.on('heal', (data) => {
      this.emitMessage(BattleMessageType.Heal, {
        target: data.targetId,
        amount: data.heal,
        source: 'effect',
      })
    })

    this.on('switchIn', (data) => {
      this.emitMessage(BattleMessageType.PetSwitch, {
        player: data.playerId,
        fromPet: data.fromPetId ?? data.petId,
        toPet: data.petId,
        currentHp: typeof data.currentHp === 'number' ? data.currentHp : 0,
      })
    })

    this.on('petDefeated', (data) => {
      this.emitMessage(BattleMessageType.PetDefeated, {
        pet: data.petId,
        killer: data.killerId,
      })
    })

    this.on('rageChange', (data) => {
      const playerId = String(data.playerId)
      const player = this.systems.playerSystem.get(this.world, playerId)
      const after = typeof data.newRage === 'number' ? data.newRage : this.systems.playerSystem.getRage(this.world, playerId)
      const before = typeof data.before === 'number' ? data.before : after
      const reason = String(data.reason ?? 'effect')
      const rageReason = ['turn', 'damage', 'skill', 'skillHit', 'switch', 'effect'].includes(reason)
        ? reason
        : 'effect'
      this.emitMessage(BattleMessageType.RageChange, {
        player: data.playerId,
        pet: player?.activePetId ?? '',
        before,
        after,
        reason: rageReason,
      })
    })

    this.on('hpChange', (data) => {
      this.emitMessage(BattleMessageType.HpChange, {
        pet: data.pet,
        before: data.before,
        after: data.after,
        maxHp: data.maxHp,
        reason: data.reason ?? 'effect',
      })
    })

    this.on('markAdd', (data) => {
      const markId = String(data.markId)
      const mark = this.systems.markSystem.get(this.world, markId)
      if (!mark) return
      this.emitMessage(BattleMessageType.MarkApply, {
        baseMarkId: data.baseMarkId,
        target: data.targetId,
        mark: this.toMarkMessage(mark),
      })
    })

    this.on('markStack', (data) => {
      const markId = String(data.markId)
      const mark = this.systems.markSystem.get(this.world, markId)
      if (!mark) return
      this.emitMessage(BattleMessageType.MarkUpdate, {
        mark: this.toMarkMessage(mark),
        target: data.targetId ?? mark.ownerId ?? 'battle',
      })
    })

    this.on('markUpdate', (data) => {
      const markId = String(data.markId)
      const mark = this.systems.markSystem.get(this.world, markId)
      if (!mark) return
      this.emitMessage(BattleMessageType.MarkUpdate, {
        mark: this.toMarkMessage(mark),
        target: data.ownerId ?? mark.ownerId ?? 'battle',
      })
    })

    this.on('markRemove', (data) => {
      this.emitMessage(BattleMessageType.MarkDestroy, {
        mark: String(data.markId),
        baseMarkId: data.baseMarkId,
        target: data.ownerId ?? 'battle',
      })
    })

    this.on('markExpire', (data) => {
      this.emitMessage(BattleMessageType.MarkExpire, {
        mark: data.markId,
        target: data.ownerId ?? 'battle',
      })
    })

    this.on('forcedSwitch', (data) => {
      this.emitMessage(BattleMessageType.ForcedSwitch, {
        player: data.playerIds,
      })
    })

    this.on('faintSwitch', (data) => {
      this.emitMessage(BattleMessageType.FaintSwitch, {
        player: data.playerId,
      })
    })

    this.on('turnAction', (data) => {
      this.emitMessage(BattleMessageType.TurnAction, {
        player: data.playerIds,
      })
    })

    this.on('teamSelectionStart', (data) => {
      this.emitMessage(BattleMessageType.TeamSelectionStart, {
        config: data.config,
        playerATeam: data.playerATeam ?? null,
        playerBTeam: data.playerBTeam ?? null,
      })
    })

    this.on('teamSelectionComplete', (data) => {
      this.emitMessage(BattleMessageType.TeamSelectionComplete, {
        playerASelection: data.playerASelection,
        playerBSelection: data.playerBSelection,
      })
    })

    this.on('statStageChange', (data) => {
      this.emitMessage(BattleMessageType.StatChange, {
        pet: data.entityId,
        stat: data.stat,
        stage: data.newStage,
        reason: 'effect',
      })
    })

    this.on('info', (data) => {
      this.emitMessage(BattleMessageType.Info, {
        message: data.message ?? 'info',
      })
    })
  }
}
