import { nativeBuildIdentity } from '@arcadia-eternity/data-pack-base/build'
import { LocalBattleSystemV4, type NativeBattleHostOptions } from '@arcadia-eternity/battle/v4/host'
import { GameRng, type BattleOptions } from '@arcadia-eternity/battle/v4'
import { NativePackLoader, cloneJson, type NativeWorkSelection } from '@arcadia-eternity/pack-loader/native'
import type { PetSchemaType } from '@arcadia-eternity/schema'
import { SpeciesSchema, SkillSchema, MarkSchema, parseWithErrors } from '@arcadia-eternity/schema'
import type { ContentPrototypeData } from '@arcadia-eternity/battle/v4'
import type { ServerEnvironmentContent } from '@arcadia-eternity/protocol'
import { nanoid } from 'nanoid'
import { toRaw } from 'vue'
import { createOfficialContent, officialTemplateDefinitions } from '@arcadia-eternity/data-pack-base/native'

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
    works?: NativeWorkSelection
    ai?: { enabled?: boolean; players?: readonly ('playerA' | 'playerB')[] }
  }

/** Shared local/P2P construction. Metadata comes from the current store; effects come from compiled TS. */
export async function createNativeWebBattleSystem(
  first: NativeWebPlayer,
  second: NativeWebPlayer,
  dataStore: NativeGameDataStoreLike,
  config: NativeWebBattleConfig = {},
): Promise<LocalBattleSystemV4> {
  return (await createNativeWebBattleSession(first, second, dataStore, config)).system
}

/** Load once so local battle rules and display describe the same fixed content. */
export async function createNativeWebBattleSession(
  first: NativeWebPlayer,
  second: NativeWebPlayer,
  dataStore: NativeGameDataStoreLike,
  config: NativeWebBattleConfig = {},
): Promise<{ system: LocalBattleSystemV4; data: ContentPrototypeData }> {
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(toRaw(value))) as T
  const teams = [first, second].map(player => ({
    ...copy(player),
    id: player.id ?? nanoid(),
    team: player.team.map(pet => ({ ...copy(pet), id: nanoid() })),
  }))
  if (teams[0].id === teams[1].id) throw new Error('Battle players must have distinct identities')
  const { works, ...battleConfig } = toRaw(config)
  const options = { ...structuredClone(battleConfig), ...(works ? { works: cloneJson(works) } : {}) }
  if (options.rngSeed !== undefined) new GameRng(options.rngSeed)
  const records = (kind: keyof NativeGameDataStoreLike) =>
      dataStore[kind].allIds.map(id => copy(dataStore[kind].byId[id])),
    loader = new NativePackLoader(nativeBuildIdentity, createOfficialContent, {
      templates: officialTemplateDefinitions,
    }),
    metadata = { marks: records('marks'), skills: records('skills'), species: records('species') },
    loaded = options.works
      ? await loader.fromWorks(options.works.base, options.works.selected, options.works.installed)
      : await loader.fromMetadata(metadata),
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
      data: 'data' in loaded ? loaded.data : metadata,
    }
  } catch (error) {
    await battle.cleanup()
    throw error
  }
}

/** Presentation only; executable effects stay in the captured native content. */
export function localBattleDisplayContent(data: ContentPrototypeData): ServerEnvironmentContent {
  const text = (raw: unknown) => {
    const record = raw as Record<string, unknown>
    return {
      ...(typeof record.name === 'string' ? { name: record.name } : {}),
      ...(typeof record.description === 'string' ? { description: record.description } : {}),
    }
  }
  return {
    species: data.species.map(raw => ({ ...parseWithErrors(SpeciesSchema, raw), ...text(raw) })),
    skills: data.skills.map(raw => ({ ...parseWithErrors(SkillSchema, raw), ...text(raw) })),
    marks: data.marks.map(raw => ({ ...parseWithErrors(MarkSchema, raw), ...text(raw) })),
  }
}
