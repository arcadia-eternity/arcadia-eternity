import { nativeBuildIdentity } from '@arcadia-eternity/data-pack-base/build'
import { LocalBattleSystemV4, type NativeBattleHostOptions } from '@arcadia-eternity/battle/v4/host'
import { GameRng, type BattleOptions } from '@arcadia-eternity/battle/v4'
import { NativePackLoader } from '@arcadia-eternity/pack-loader/native'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import { nanoid } from 'nanoid'
import { toRaw } from 'vue'
import { createOfficialContent } from '@arcadia-eternity/data-pack-base/native'

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
  }

/** Shared local/P2P construction. Metadata comes from the current store; effects come from compiled TS. */
export async function createNativeWebBattleSystem(
  first: NativeWebPlayer,
  second: NativeWebPlayer,
  dataStore: NativeGameDataStoreLike,
  config: NativeWebBattleConfig = {},
): Promise<LocalBattleSystemV4> {
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(toRaw(value))) as T
  const teams = [first, second].map(player => ({
    ...copy(player),
    id: player.id ?? nanoid(),
    team: player.team.map(pet => ({ ...copy(pet), id: nanoid() })),
  }))
  if (teams[0].id === teams[1].id) throw new Error('Battle players must have distinct identities')
  const options = structuredClone(toRaw(config))
  if (options.rngSeed !== undefined) new GameRng(options.rngSeed)
  const records = (kind: keyof NativeGameDataStoreLike) =>
      dataStore[kind].allIds.map(id => copy(dataStore[kind].byId[id])),
    loaded = await new NativePackLoader(nativeBuildIdentity, createOfficialContent).fromMetadata({
      marks: records('marks'),
      skills: records('skills'),
      species: records('species'),
    }),
    aiSlots = new Set(options.ai?.enabled ? (options.ai.players ?? ['playerB']) : []),
    [a, b] = loaded.content.parsePlayers(teams, {
      aiPlayerIds: teams
        .filter((_, index) => aiSlots.has(index === 0 ? 'playerA' : 'playerB'))
        .map(player => player.id),
    }),
    battle = loaded.content.createBattle(a, b, {
      rngSeed: options.rngSeed,
      allowFaintSwitch: options.allowFaintSwitch,
      showHidden: options.showHidden,
      timerConfig: options.timerConfig,
    })
  try {
    return new LocalBattleSystemV4(battle, loaded.content, { teamSelection: options.teamSelection })
  } catch (error) {
    await battle.cleanup()
    throw error
  }
}
