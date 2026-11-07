import type { LocalBattleSystemV4, NativeBattleHostOptions } from '@arcadia-eternity/battle/v4/host'
import { GameRng, type BattleOptions } from '@arcadia-eternity/battle/v4'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import type { ContentPrototypeData } from '@arcadia-eternity/battle/v4'
import { nanoid } from 'nanoid'
import { toRaw } from 'vue'
import { readPreparedWebRuntime } from './preparedWebEnvironment'
import type { IBattleSystem } from '@arcadia-eternity/interface'
import type { SandboxEnvironment } from '@arcadia-eternity/battle/v4/sandbox'
import { getBattleWorkers } from './sandboxBattleWorkers'

export interface NativeGameDataStoreLike {
  marks: { allIds: string[]; byId: Record<string, unknown> }
  skills: { allIds: string[]; byId: Record<string, unknown> }
  species: { allIds: string[]; byId: Record<string, unknown> }
}
export interface NativeWebPlayer {
  id?: string
  name: string
  team: readonly PetSchemaType[]
}
export type NativeWebBattleConfig = Pick<
  NonNullable<BattleOptions>,
  'rngSeed' | 'allowFaintSwitch' | 'showHidden' | 'timerConfig'
> &
  NativeBattleHostOptions & {
    ai?: { enabled?: boolean; players?: readonly ('playerA' | 'playerB')[] }
    environment?: SandboxEnvironment
  }

export type WebBattleHost = IBattleSystem &
  Pick<
    LocalBattleSystemV4,
    | 'BattleEvent'
    | 'createRuntimeSnapshot'
    | 'restoreRuntimeSnapshot'
    | 'waitForPendingDecision'
    | 'startReconnectGraceTimer'
    | 'cancelReconnectGraceTimer'
  >

/** Product local/P2P path. Worker creation failure is terminal; no native execution fallback. */
export async function createSandboxWebBattleSession(
  first: NativeWebPlayer,
  second: NativeWebPlayer,
  _dataStore: NativeGameDataStoreLike,
  config: NativeWebBattleConfig = {},
  signal?: AbortSignal,
): Promise<{ system: WebBattleHost; data: ContentPrototypeData }> {
  signal?.throwIfAborted()
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(toRaw(value))) as T
  const teams = [first, second].map(player => ({
    ...copy(player),
    id: player.id ?? nanoid(),
    team: player.team.map(pet => ({ ...copy(pet), id: nanoid() })),
  }))
  if (teams[0].id === teams[1].id) throw Error('Battle players must have distinct identities')
  const options = structuredClone(toRaw(config))
  if (options.rngSeed !== undefined) new GameRng(options.rngSeed)
  const ai = new Set(options.ai?.enabled ? (options.ai.players ?? ['playerB']) : [])
  const environment = options.environment ?? (await readPreparedWebRuntime(signal))
  const data = environment.data
  const system = await getBattleWorkers().create(
    {
      environment,
      players: teams,
      aiPlayerIds: teams.filter((_, index) => ai.has(index === 0 ? 'playerA' : 'playerB')).map(player => player.id),
      options: {
        rngSeed: options.rngSeed,
        allowFaintSwitch: options.allowFaintSwitch,
        showHidden: options.showHidden,
        timerConfig: options.timerConfig,
      },
      hostOptions: { teamSelection: options.teamSelection },
    },
    signal,
  )
  return { system, data }
}
