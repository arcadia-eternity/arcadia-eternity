import { assertSkillSlots } from '@arcadia-eternity/const'
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
  assertEnvironmentTeam,
  assertNatureChoice,
  learningIssues,
  type validateEnvironmentRules,
} from '@arcadia-eternity/content-sdk/environment-rules'
import { nanoid } from 'nanoid'

export interface ServerRuntime {
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
  const { content, species } = runtime ?? (await loadOfficialContent())
  assertEnvironmentTeam(rules, parsed)
  for (const pet of parsed) {
    // Keep admission aligned with the native runtime's bounds, which are stricter
    // than the shared draft schema.
    if (pet.level > 100) throw new Error('Pet level must not exceed 100')
    if (Object.values(pet.evs).reduce((sum, value) => sum + value, 0) > 510)
      throw new Error('Pet total EVs must not exceed 510')
    content.getSpecies(pet.species as Parameters<ContentCatalog['getSpecies']>[0])
    for (const skill of pet.skills) content.getSkill(skill as Parameters<ContentCatalog['getSkill']>[0])
    if (pet.ability) content.getMark(pet.ability as Parameters<ContentCatalog['getMark']>[0])
    if (pet.emblem) content.getMark(pet.emblem as Parameters<ContentCatalog['getMark']>[0])
    const definition = species.get(pet.species)!
    if (pet.inheritedSkill) content.getSkill(pet.inheritedSkill as Parameters<ContentCatalog['getSkill']>[0])
    if (pet.enhancement) content.getEnhancement(pet.enhancement)
    assertNatureChoice(rules, pet.nature, content.getNature, () => definition)
    assertSkillSlots(rules?.mechanics?.skillSlots, pet.skills, id =>
      content.getSkill(id as Parameters<ContentCatalog['getSkill']>[0]),
    )
    const issues = learningIssues(rules, definition, pet)
    if (issues.length) throw new Error(issues.join('、'))
    if (pet.ability && !definition.ability.includes(pet.ability))
      throw new Error(`Ability ${pet.ability} is not allowed for ${pet.species}`)
    if (pet.emblem && !definition.emblem.includes(pet.emblem))
      throw new Error(`Emblem ${pet.emblem} is not allowed for ${pet.species}`)
  }
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
    enhancementActive: rules?.mechanics?.enhancement?.mode === 'active',
    allowFaintSwitch: rules?.mechanics?.allowFaintSwitch ?? options?.allowFaintSwitch ?? true,
    timerConfig: options?.timerConfig && { ...options.timerConfig },
  }
  if (runtime.sandbox)
    return workers.create({ environment: runtime.sandbox, players: teams, options: capturedOptions }, signal)
  if (!('parsePlayers' in content)) throw new Error('Battle environment has no executable recipe')
  const native = await content.withSkillParameters(rules?.skillParameters)
  const [a, b] = native.parsePlayers(teams)
  return new LocalBattleSystem(native.createBattle(a, b, capturedOptions), native)
}
