import { toRaw } from 'vue'
import { isNavigationFailure, type NavigationFailure } from 'vue-router'
import type { IBattleSystem } from '@arcadia-eternity/interface'
import type { NativeWorkSelection } from '@arcadia-eternity/pack-loader/native'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import type { useBattleStore } from '@/stores/battle'
import type { useGameDataStore } from '@/stores/gameData'
import {
  createNativeWebBattleSession,
  localBattleDisplayContent,
  type NativeWebPlayer,
  type NativeWebBattleConfig,
} from './nativeBattleFactory'

export interface CreatorTrialInput {
  selection: NativeWorkSelection
  teams: [{ name: string; pets: PetSchemaType[] }, { name: string; pets: PetSchemaType[] }]
}
type SessionState = 'configuring' | 'starting' | 'routing' | 'active' | 'disposed'
type BattleStore = Pick<
  ReturnType<typeof useBattleStore>,
  'battleInterface' | 'initBattle' | 'resetBattleWithoutSurrender'
>
interface Destination {
  data: ReturnType<typeof useGameDataStore>
  battle: BattleStore
  navigate(): Promise<void | NavigationFailure>
}
type Prepared = Awaited<ReturnType<typeof createNativeWebBattleSession>>
interface Attempt {
  native: Prepared['system']
  data?: Prepared['data']
  system: IBattleSystem
  restore?: () => void
  stopped?: Promise<void>
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value)) freeze(child)
  }
  return value
}

/** Owns one configuration → battle handoff and every temporary object it creates.
 * Failed launches can retry while the configuration is open. Disposal is terminal.
 */
export class LocalBattleSession {
  #state: SessionState = 'configuring'
  #input?: CreatorTrialInput
  #view?: { title: string; teams: CreatorTrialInput['teams'] }
  #configurationGone = false
  #preparing?: Promise<Attempt>
  #attempt?: Attempt
  #battle?: BattleStore
  #disposing?: Promise<void>
  constructor(
    input?: CreatorTrialInput,
    private readonly create = createNativeWebBattleSession,
  ) {
    if (input) {
      this.#input = freeze(copy(input))
      this.#view = Object.freeze({
        title: this.#input.selection.selected[0]?.project.title ?? 'UGC',
        teams: this.#input.teams,
      })
    }
  }
  get state() {
    return this.#state
  }
  get trial() {
    return this.#view
  }

  async start(
    first: NativeWebPlayer,
    second: NativeWebPlayer,
    config: NativeWebBattleConfig,
    target: Destination,
  ): Promise<boolean> {
    if (this.#state !== 'configuring') throw new Error('当前试战会话无法重复启动，请重新准备试战')
    this.#state = 'starting'
    let attempt: Attempt | undefined
    let activated = false
    try {
      const options = structuredClone(toRaw(config))
      if (this.#input) {
        options.works = this.#input.selection
        options.rngSeed ??= 'creator-preview'
      }
      this.#preparing = this.create(copy(first), copy(second), target.data, options).then(prepared =>
        this.#manage(prepared),
      )
      attempt = await this.#preparing
      this.#preparing = undefined
      if (this.state === 'disposed') return false
      this.#attempt = attempt
      this.#battle = target.battle
      if (this.#input) attempt.restore = target.data.useLocalBattleContent(localBattleDisplayContent(attempt.data!))
      attempt.data = undefined
      const current = () => this.#attempt === attempt && this.#state !== 'disposed'
      const initial = await attempt.system.getState(undefined, true)
      if (!current()) return false
      const player = initial.players[0]?.id
      if (!player) throw new Error('战斗初始化失败：无法解析玩家 ID')
      await target.battle.initBattle(attempt.system, player, current)
      if (!current()) return false
      this.#state = 'routing'
      const navigation = await target.navigate()
      if (isNavigationFailure(navigation)) throw new Error('未能进入战斗界面，请重试')
      if (!current()) return false
      this.#state = 'active'
      // The native runtime owns its captured content now; the authoring snapshot can be released.
      this.#input = undefined
      this.#view = undefined
      activated = true
      return true
    } finally {
      if (!activated) {
        if (this.#attempt === attempt) this.#attempt = undefined
        try {
          if (attempt) {
            try {
              await this.#stop(attempt)
            } finally {
              if (target.battle.battleInterface === attempt.system) await target.battle.resetBattleWithoutSurrender()
            }
          }
        } finally {
          this.#preparing = undefined
          if (this.state !== 'disposed') this.#state = 'configuring'
          if (this.#configurationGone) await this.dispose()
        }
      }
    }
  }

  /** Configuration unmount may be the intended transfer into /battle. */
  releaseConfiguration(): Promise<void> {
    this.#configurationGone = true
    return this.#state === 'routing' || this.#state === 'active' ? Promise.resolve() : this.dispose()
  }
  #invalidate() {
    this.#state = 'disposed'
    this.#input = undefined
    this.#view = undefined
    this.#attempt = undefined
    this.#battle = undefined
  }
  dispose(): Promise<void> {
    if (this.#disposing) return this.#disposing
    const attempt = this.#attempt,
      preparing = this.#preparing,
      battle = this.#battle
    this.#invalidate()
    this.#preparing = undefined
    const stopped = attempt ? this.#stop(attempt) : Promise.resolve()
    this.#disposing = (async () => {
      try {
        await stopped
        if (preparing)
          await preparing.then(
            value => this.#stop(value),
            () => {},
          )
      } finally {
        if (attempt && battle?.battleInterface === attempt.system) await battle.resetBattleWithoutSurrender()
      }
    })()
    return this.#disposing
  }
  #stop(attempt: Attempt): Promise<void> {
    if (attempt.stopped) return attempt.stopped
    // Restore display synchronously, before another session can acquire it.
    attempt.restore?.()
    attempt.restore = undefined
    attempt.data = undefined
    attempt.stopped = Promise.resolve().then(() => attempt.native.cleanup())
    return attempt.stopped
  }
  #manage(prepared: Prepared): Attempt {
    const native = prepared.system
    const attempt: Attempt = {
      native,
      data: prepared.data,
      system: {
        ready: native.ready.bind(native),
        getState: native.getState.bind(native),
        getAvailableSelection: native.getAvailableSelection.bind(native),
        submitAction: native.submitAction.bind(native),
        BattleEvent: native.BattleEvent.bind(native),
        isTimerEnabled: native.isTimerEnabled.bind(native),
        getPlayerTimerState: native.getPlayerTimerState.bind(native),
        getAllPlayerTimerStates: native.getAllPlayerTimerStates.bind(native),
        getTimerConfig: native.getTimerConfig.bind(native),
        startAnimation: native.startAnimation.bind(native),
        endAnimation: native.endAnimation.bind(native),
        startReconnectGraceTimer: native.startReconnectGraceTimer.bind(native),
        cancelReconnectGraceTimer: native.cancelReconnectGraceTimer.bind(native),
        onTimerEvent: native.onTimerEvent.bind(native),
        offTimerEvent: native.offTimerEvent.bind(native),
        createRuntimeSnapshot: native.createRuntimeSnapshot.bind(native),
        restoreRuntimeSnapshot: native.restoreRuntimeSnapshot.bind(native),
        cleanup: () => {
          // Battle-store cleanup ends this session without recursively resetting the store.
          if (this.#attempt === attempt) this.#invalidate()
          return this.#stop(attempt)
        },
      },
    }
    return attempt
  }
}

const pending = new Map<string, { session: LocalBattleSession; timer: ReturnType<typeof setTimeout> }>()
/** One-use navigation ticket; unclaimed snapshots expire and are actually released. */
export function createCreatorTrialLaunch(input: CreatorTrialInput): string {
  while (pending.size >= 4) void takeCreatorTrialLaunch(pending.keys().next().value!)?.dispose()
  const key = crypto.randomUUID(),
    session = new LocalBattleSession(input)
  const timer = setTimeout(
    () => {
      void takeCreatorTrialLaunch(key)?.dispose()
    },
    30 * 60 * 1000,
  )
  pending.set(key, { session, timer })
  return key
}
export function takeCreatorTrialLaunch(key: string): LocalBattleSession | null {
  const entry = pending.get(key)
  if (!entry) return null
  pending.delete(key)
  clearTimeout(entry.timer)
  return entry.session
}
