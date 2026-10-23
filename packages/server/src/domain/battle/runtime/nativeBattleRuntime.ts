import { nativeBuildIdentity } from '@arcadia-eternity/data-pack-base/build'
import { LocalBattleSystemV4 } from '@arcadia-eternity/battle/v4/host'
import type { BattleOptions } from '@arcadia-eternity/battle/v4'
import { NativePackLoader } from '@arcadia-eternity/pack-loader/native'
import type { PlayerSchemaType } from '@arcadia-eternity/schema'
import { nanoid } from 'nanoid'
import { readRuntimeDescriptor, readRuntimeIdentity, type NativeRuntimeIdentity } from './runtimeIdentity'
import { createOfficialContent } from '@arcadia-eternity/data-pack-base/native'

/** Construct the native server runtime and retain its actual initial identities for journal recovery. */
export async function createNativeBattleRuntime(
  packRef: string,
  player1: PlayerSchemaType,
  player2: PlayerSchemaType,
  options: BattleOptions,
  expected?: NativeRuntimeIdentity,
) {
  if (player1.id === player2.id) throw new Error('Battle players must have distinct identities')
  if (expected) {
    const identity = readRuntimeIdentity(expected)
    if (
      identity.kind !== 'native-v4' ||
      identity.build.coreBuildId !== nativeBuildIdentity.coreBuildId ||
      identity.build.registryBuildId !== nativeBuildIdentity.registryBuildId
    )
      throw new Error('Native battle build identity mismatch')
    expected = identity
  }
  // Draft pet IDs may be shared by imported teams; battle instances receive their own IDs, as in the existing factory.
  const teams = [player1, player2].map(player => ({
    ...structuredClone(player),
    team: player.team.map(pet => ({ ...structuredClone(pet), id: nanoid() })),
  }))
  const capturedOptions = options && { ...options, timerConfig: options.timerConfig && { ...options.timerConfig } }
  const loaded = await new NativePackLoader(nativeBuildIdentity, createOfficialContent).load(packRef, {
    expectedRevision: expected?.contentRevision,
  })
  const [a, b] = loaded.content.parsePlayers(teams)
  const native = loaded.content.createBattle(a, b, capturedOptions)
  const battle = new LocalBattleSystemV4(native, loaded.content)
  try {
    const descriptor = readRuntimeDescriptor({
      runtime: { kind: 'native-v4', build: loaded.build, contentRevision: loaded.revision },
      initial: await battle.createRuntimeSnapshot(),
    })
    return { battle, descriptor }
  } catch (error) {
    await battle.cleanup()
    throw error
  }
}
