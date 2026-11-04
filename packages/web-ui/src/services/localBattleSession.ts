import { toRaw } from 'vue'
import { isNavigationFailure, type NavigationFailure } from 'vue-router'
import type { IBattleSystem } from '@arcadia-eternity/interface'
import type { useBattleStore } from '@/stores/battle'
import type { useGameDataStore } from '@/stores/gameData'
import { createSandboxWebBattleSession, type NativeWebPlayer, type NativeWebBattleConfig } from './nativeBattleFactory'

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
type Prepared = Awaited<ReturnType<typeof createSandboxWebBattleSession>>
interface Attempt {
  native: Prepared['system']
  system: IBattleSystem
  stopped?: Promise<void>
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
/** Owns one configuration → battle handoff and every temporary object it creates.
 * Failed launches can retry while the configuration is open. Disposal is terminal.
 */
export class LocalBattleSession {
  #state: SessionState = 'configuring'
  #configurationGone = false
  #preparing?: Promise<Attempt>
  #attempt?: Attempt
  #battle?: BattleStore
  #disposing?: Promise<void>
  constructor(private readonly create = createSandboxWebBattleSession) {}
  get state() {
    return this.#state
  }

  async start(
    first: NativeWebPlayer,
    second: NativeWebPlayer,
    config: NativeWebBattleConfig,
    target: Destination,
  ): Promise<boolean> {
    if (this.#state !== 'configuring') throw new Error('当前对战会话无法重复启动，请重新准备对战')
    this.#state = 'starting'
    let attempt: Attempt | undefined
    let activated = false
    try {
      const options = structuredClone(toRaw(config))
      this.#preparing = this.create(copy(first), copy(second), target.data, options).then(prepared =>
        this.#manage(prepared),
      )
      attempt = await this.#preparing
      this.#preparing = undefined
      if (this.state === 'disposed') return false
      this.#attempt = attempt
      this.#battle = target.battle
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
    attempt.stopped = Promise.resolve().then(() => attempt.native.cleanup())
    return attempt.stopped
  }
  #manage(prepared: Prepared): Attempt {
    const native = prepared.system
    const attempt: Attempt = {
      native,
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
