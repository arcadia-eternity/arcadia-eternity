import { nativeBuildIdentity } from '@arcadia-eternity/data-pack-base/build'
import { LocalBattleSystemV4, type NativeBattleHostOptions } from '@arcadia-eternity/battle/v4/host'
import { GameRng, type BattleOptions } from '@arcadia-eternity/battle/v4'
import { NativePackLoader, digestJson } from '@arcadia-eternity/pack-loader/native'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import type { ContentPrototypeData } from '@arcadia-eternity/battle/v4'
import { nanoid } from 'nanoid'
import { toRaw } from 'vue'
import { createOfficialContent, officialTemplateDefinitions } from '@arcadia-eternity/data-pack-base/effects'
import officialEffectArtifact from '@arcadia-eternity/data-pack-base/effects?effect-module'
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
  dataStore: NativeGameDataStoreLike,
  config: NativeWebBattleConfig = {},
): Promise<{ system: WebBattleHost; data: ContentPrototypeData }> {
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(toRaw(value))) as T
  const teams = [first, second].map(player => ({
    ...copy(player),
    id: player.id ?? nanoid(),
    team: player.team.map(pet => ({ ...copy(pet), id: nanoid() })),
  }))
  if (teams[0].id === teams[1].id) throw Error('Battle players must have distinct identities')
  const options = structuredClone(toRaw(config))
  if (options.rngSeed !== undefined) new GameRng(options.rngSeed)
  const records = (kind: keyof NativeGameDataStoreLike) =>
    dataStore[kind].allIds.map(id => copy(dataStore[kind].byId[id]))
  const data: ContentPrototypeData = options.environment?.data ?? {
    marks: records('marks'),
    skills: records('skills'),
    species: records('species'),
  }
  const ai = new Set(options.ai?.enabled ? (options.ai.players ?? ['playerB']) : [])
  const environment = options.environment ?? {
    revision: `arcadia.sandbox-content/1:${await digestJson({ build: nativeBuildIdentity, data, templates: officialTemplateDefinitions, artifact: officialEffectArtifact })}`,
    data: { ...data, behaviors: officialTemplateDefinitions },
    modules: [{ artifact: officialEffectArtifact, namespace: '', role: 'catalog' as const }],
  }
  const system = await getBattleWorkers().create({
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
  })
  return { system, data }
}

/** Shared local/P2P construction. Metadata comes from the current store; effects come from compiled TS. */
export async function createNativeWebBattleSystem(
  first: NativeWebPlayer,
  second: NativeWebPlayer,
  dataStore: NativeGameDataStoreLike,
  config: NativeWebBattleConfig = {},
): Promise<LocalBattleSystemV4> {
  if (config.environment) throw Error('Custom environments require the sandbox battle factory')
  return (await createNativeWebBattleSession(first, second, dataStore, config)).system
}

/** Load once so local battle rules and display describe the same fixed content. */
export async function createNativeWebBattleSession(
  first: NativeWebPlayer,
  second: NativeWebPlayer,
  dataStore: NativeGameDataStoreLike,
  config: NativeWebBattleConfig = {},
): Promise<{ system: LocalBattleSystemV4; data: ContentPrototypeData }> {
  if (config.environment) throw Error('Custom environments require the sandbox battle factory')
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
    loader = new NativePackLoader(nativeBuildIdentity, createOfficialContent, {
      templates: officialTemplateDefinitions,
    }),
    metadata = { marks: records('marks'), skills: records('skills'), species: records('species') },
    loaded = await loader.fromMetadata(metadata),
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
    return {
      system: new LocalBattleSystemV4(battle, loaded.content, { teamSelection: options.teamSelection }),
      data: metadata,
    }
  } catch (error) {
    await battle.cleanup()
    throw error
  }
}
