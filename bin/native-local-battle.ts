import { nativeBuildIdentity } from '@arcadia-eternity/data-pack-base/build'
import { GameRng, type BattleOptions } from '@arcadia-eternity/battle/v4'
import { LocalBattleSystemV4 } from '@arcadia-eternity/battle/v4/host'
import { NativePackLoader } from '@arcadia-eternity/pack-loader/native'
import type { PlayerSchemaType } from '@arcadia-eternity/schema'
import { randomBytes } from 'node:crypto'
import { createOfficialContent } from '@arcadia-eternity/data-pack-base/native'

const freshId = () => randomBytes(16).toString('base64url').slice(0, 21)

/** CLI drafts describe teams; each new session owns fresh actor/pet identities. */
export async function createNativeLocalBattle(
  drafts: readonly [PlayerSchemaType, PlayerSchemaType],
  options: { packRef?: string; aiPlayers?: readonly string[]; battle?: NonNullable<BattleOptions> } = {},
) {
  const teams = drafts.map(draft => ({
    ...structuredClone(draft),
    id: freshId(),
    team: draft.team.map(pet => ({ ...structuredClone(pet), id: freshId() })),
  }))
  const config = structuredClone(options.battle ?? {})
  if (config.rngSeed !== undefined) new GameRng(config.rngSeed)
  const ai = new Set(options.aiPlayers?.map(slot => slot.toLowerCase().trim()))
  const loaded = await new NativePackLoader(nativeBuildIdentity, createOfficialContent).load(
    options.packRef ?? 'builtin:workspace',
    {
      source: 'node-fs',
      enforceLockfile: true,
    },
  )
  const [a, b] = loaded.content.parsePlayers(teams, {
    aiPlayerIds: teams.filter((_, index) => ai.has(`player${index + 1}`)).map(team => team.id),
  })
  const battle = loaded.content.createBattle(a, b, config)
  return {
    system: new LocalBattleSystemV4(battle, loaded.content),
    playerIds: [a.id, b.id] as const,
    humanIds: [a, b].filter((_, index) => !ai.has(`player${index + 1}`)).map(player => player.id),
    effectCount: loaded.content.effects.length,
    revision: loaded.revision,
  }
}
