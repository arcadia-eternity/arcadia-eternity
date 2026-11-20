import { LocalBattleSystem, type BattleHost } from '@arcadia-eternity/battle/host'
import { createNodeBattleWorkerManager } from '@arcadia-eternity/battle/sandbox/node'
import type { SandboxEnvironment } from '@arcadia-eternity/battle/sandbox/effects'
import type { BattleOptions, ContentCatalog, ContentIndex } from '@arcadia-eternity/battle/engine'
import { prepareShippedEnvironment } from '@arcadia-eternity/pack-loader/node'
import type { NativePackLoadResult } from '@arcadia-eternity/pack-loader/native'
import { fileURLToPath } from 'node:url'
import type { NativeRuntimeIdentity } from '@arcadia-eternity/protocol'
import {
  PlayerSchema,
  SpeciesSchema,
  parseWithErrors,
  type PetSchemaType,
  type PlayerSchemaType,
  type SpeciesSchemaType,
} from '@arcadia-eternity/schema'
import {
  assertPlayableTeam,
  resolveEnvironmentMechanics,
  prepareEnvironmentRules,
  type validateEnvironmentRules,
} from '@arcadia-eternity/content-sdk/environment-rules'
import { nanoid } from 'nanoid'

export interface ServerRuntime {
  defaultRules?: ReturnType<typeof validateEnvironmentRules>
  sandbox?: SandboxEnvironment
  content: ContentCatalog | ContentIndex
  species: ReadonlyMap<string, SpeciesSchemaType>
  identity: NativeRuntimeIdentity
}

let officialContent: Promise<ServerRuntime> | undefined
let officialPack: ReturnType<typeof prepareShippedEnvironment> | undefined
const sandboxWorkers = createNodeBattleWorkerManager()

export function loadServerBase() {
  officialPack ??= prepareShippedEnvironment(
    fileURLToPath(new URL('.', import.meta.resolve('@arcadia-eternity/data-pack-base/package.json'))),
  ).catch(error => {
    officialPack = undefined
    throw error
  })
  return officialPack
}

export function createServerRuntime(
  loaded: Pick<NativePackLoadResult<ContentCatalog | ContentIndex>, 'content' | 'data' | 'revision' | 'build'> & {
    sandbox?: SandboxEnvironment
  },
): ServerRuntime {
  return {
    defaultRules: prepareEnvironmentRules(undefined, loaded.data.ruleSets).rules,
    content: loaded.content,
    sandbox: loaded.sandbox,
    species: new Map(
      loaded.data.species.map(raw => {
        const species = parseWithErrors(SpeciesSchema, raw)
        return [species.id, species]
      }),
    ),
    identity: {
      kind: 'native-v4' as const,
      contentRevision: loaded.revision,
      coreBuildId: loaded.build.coreBuildId,
      registryBuildId: loaded.build.registryBuildId,
    },
  }
}

function loadOfficialContent(): Promise<ServerRuntime> {
  officialContent ??= loadServerBase()
    .then(createServerRuntime)
    .catch(error => {
      officialContent = undefined
      throw error
    })
  return officialContent
}

export async function getServerRuntimeIdentity(): Promise<NativeRuntimeIdentity> {
  return { ...(await loadOfficialContent()).identity }
}

/** Check drafts without allocating players, pets, timers or attribute systems. */
export async function validateServerTeam(
  team: unknown,
  runtime?: ServerRuntime,
  rules?: ReturnType<typeof validateEnvironmentRules>,
): Promise<PetSchemaType[]> {
  // The offline runtime deliberately permits fixture HP overrides. Online rooms
  // always derive HP from official species/stats and start each pet at full health.
  // Inspect before schema cleaning, which otherwise silently drops hp/currentHp.
  if (Array.isArray(team))
    for (const pet of team)
      if (pet && typeof pet === 'object')
        for (const field of ['maxHp', 'currentHp', 'hp'])
          if (field in pet && pet[field] !== undefined) throw new Error(`Online teams cannot override ${field}`)
  const parsed = parseWithErrors(PlayerSchema, { id: nanoid(), name: 'team', team }).team
  const { content, species, defaultRules } = runtime ?? (await loadOfficialContent())
  rules ??= defaultRules
  assertPlayableTeam(
    rules,
    parsed,
    id => species.get(id),
    content.getNature,
    content.getEnhancement,
    id => content.getSkill(id as Parameters<ContentCatalog['getSkill']>[0]),
    id => content.getMark(id as Parameters<ContentCatalog['getMark']>[0]),
  )
  return parsed
}

/** Create an ephemeral battle using room-seat identities supplied by the host. */
export async function createServerBattle(
  playerA: PlayerSchemaType,
  playerB: PlayerSchemaType,
  options: BattleOptions,
  runtime?: ServerRuntime,
  workers = sandboxWorkers,
  signal?: AbortSignal,
  rules?: ReturnType<typeof validateEnvironmentRules>,
): Promise<BattleHost> {
  signal?.throwIfAborted()
  if (playerA.id === playerB.id) throw new Error('Battle players must have distinct identities')
  runtime ??= await loadOfficialContent()
  signal?.throwIfAborted()
  rules ??= runtime.defaultRules
  const { content } = runtime
  const players = await Promise.all(
    [playerA, playerB].map(async player => ({
      ...player,
      team: await validateServerTeam(player.team, runtime, rules),
    })),
  )
  signal?.throwIfAborted()
  const teams = players.map(player => ({
    ...structuredClone(player),
    team: player.team.map(pet => ({ ...structuredClone(pet), id: nanoid() })),
  }))
  const capturedOptions = {
    ...options,
    skillParameters: rules?.skillParameters,
    matchups: rules?.matchups,
    individualValueMax: resolveEnvironmentMechanics(rules).individualValues.max,
    enhancementActive: resolveEnvironmentMechanics(rules).enhancement.mode === 'active',
    allowFaintSwitch: rules?.mechanics?.allowFaintSwitch ?? options?.allowFaintSwitch ?? true,
    timerConfig: options?.timerConfig && { ...options.timerConfig },
  }
  if (runtime.sandbox)
    return workers.create({ environment: runtime.sandbox, players: teams, options: capturedOptions }, signal)
  if (!('parsePlayers' in content)) throw new Error('Battle environment has no executable recipe')
  const native = await content.withSkillParameters(rules?.skillParameters)
  const [a, b] = native.parsePlayers(teams, capturedOptions)
  return new LocalBattleSystem(native.createBattle(a, b, capturedOptions), native)
}
