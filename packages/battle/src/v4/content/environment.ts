import type { Battle } from '../battle'
import { SnapshotCatalog, snapshotBattle, restoreBattle } from '../snapshot'
import { compileContentPack, type ContentPackResult } from './content-pack'
import { markParameterContract } from './mark-parameters'
import { ParameterCatalog } from './parameters'
import { freezeContent } from './immutable'

/** Supplied by the trusted host build, never selected by a received content pack. */
export interface EnvironmentBuildIdentity {
  readonly formatVersion: 1
  readonly coreBuildId: string
  readonly registryBuildId: string
}
export const contentEnvironmentPolicy = Object.freeze({
  formatVersion: 1,
  maxPacks: 32,
  maxPackBytes: 1048576,
  maxTotalBytes: 4194304,
  capabilities: 'builtin-only',
  references: 'pack-local',
} as const)
export interface ContentEnvironmentManifest {
  readonly formatVersion: 1
  readonly coreBuildId: string
  readonly registryBuildId: string
  readonly policyDigest: string
  readonly packs: readonly { readonly packId: string; readonly contentDigest: string }[]
  readonly environmentDigest: string
}
type CompiledPack = Extract<ContentPackResult, { ok: true }>
const installed = new WeakMap<Battle, object>()
const digestPattern = /^[a-f0-9]{64}$/
function canonical(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize)
    if (item && typeof item === 'object')
      return Object.fromEntries(
        Object.entries(item)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, child]) => [key, normalize(child)]),
      )
    return item
  }
  return JSON.stringify(normalize(value))
}
async function sha256(text: string): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/** Compile received data independently, then publish one immutable, locally executable environment.
 * Current packs are closed: cross-pack references and user code are not admitted by this compiler.
 */
export async function lockContentEnvironment(
  packTexts: readonly string[],
  hostBuild: EnvironmentBuildIdentity,
  expectedEnvironmentDigest?: string,
) {
  // Copy trusted identity before any async boundary; callers cannot change it during hashing.
  const build = {
    formatVersion: hostBuild.formatVersion,
    coreBuildId: hostBuild.coreBuildId,
    registryBuildId: hostBuild.registryBuildId,
  }
  if (build.formatVersion !== 1 || !digestPattern.test(build.coreBuildId) || !digestPattern.test(build.registryBuildId))
    throw new Error('Invalid trusted environment build identity')
  if (expectedEnvironmentDigest !== undefined && !digestPattern.test(expectedEnvironmentDigest))
    throw new Error('Invalid expected environment digest')
  if (!Array.isArray(packTexts) || packTexts.length === 0 || packTexts.length > contentEnvironmentPolicy.maxPacks)
    throw new Error('Environment pack count exceeds policy')
  const texts = [...packTexts]
  let total = 0
  for (const text of texts) {
    if (typeof text !== 'string') throw new Error('Environment pack must be JSON text')
    const bytes = new TextEncoder().encode(text).byteLength
    total += bytes
    if (bytes > contentEnvironmentPolicy.maxPackBytes || total > contentEnvironmentPolicy.maxTotalBytes)
      throw new Error('Environment transport size exceeds policy')
  }
  // Do all compilation and collision checks before publishing any object or mutating any Battle.
  const packs: CompiledPack[] = []
  const packIds = new Set<string>(),
    effectIds = new Set<string>(),
    markIds = new Set<string>(),
    actionIds = new Set<string>()
  const claim = (set: Set<string>, id: string, kind: string) => {
    if (set.has(id)) throw new Error(`Duplicate environment ${kind}: ${id}`)
    set.add(id)
  }
  for (const text of texts) {
    const pack = compileContentPack(JSON.parse(text))
    if (!pack.ok) throw new Error(`Invalid environment pack: ${JSON.stringify(pack.diagnostics)}`)
    claim(packIds, pack.data.id, 'pack')
    for (const rule of pack.rules) claim(effectIds, rule.effect.id, 'effect')
    for (const mark of pack.marks) claim(markIds, mark.id, 'mark')
    for (const action of pack.data.markActions) claim(actionIds, action.id, 'action')
    packs.push(pack)
  }
  const entries = await Promise.all(
    packs.map(async (pack, index) => ({
      pack,
      contentDigest: await sha256(canonical(pack.data)),
      transportDigest: await sha256(texts[index]),
    })),
  )
  entries.sort((a, b) => (a.pack.data.id < b.pack.data.id ? -1 : a.pack.data.id > b.pack.data.id ? 1 : 0))
  const identity = {
    ...build,
    policyDigest: await sha256(canonical(contentEnvironmentPolicy)),
    packs: entries.map(entry => ({ packId: entry.pack.data.id, contentDigest: entry.contentDigest })),
  }
  const environmentDigest = await sha256(canonical(identity))
  if (expectedEnvironmentDigest !== undefined && expectedEnvironmentDigest !== environmentDigest)
    throw new Error('Environment digest mismatch')
  const manifest: ContentEnvironmentManifest = freezeContent({ ...identity, environmentDigest })
  const parameters = new ParameterCatalog(
    packs.flatMap(pack => [
      ...pack.rules.flatMap(rule => rule.parameterDefinitions),
      ...pack.marks.flatMap(mark => markParameterContract(mark)?.parameterDefinitions ?? []),
    ]),
  )
  const catalog = new SnapshotCatalog(environmentDigest)
  for (const pack of packs) {
    for (const rule of pack.rules) catalog.registerEffect(rule.effect.id, rule.effect)
    for (const mark of pack.marks) catalog.registerContent(mark.id, mark)
  }
  catalog.seal()
  const token = Object.freeze({})
  return Object.freeze({
    manifest,
    packs: Object.freeze(entries.map(entry => entry.pack)),
    transport: freezeContent(
      entries.map(entry => ({ packId: entry.pack.data.id, transportDigest: entry.transportDigest })),
    ),
    parameters,
    install(battle: Battle): void {
      if (installed.has(battle)) throw new Error('Battle already has a content environment')
      parameters.install(battle.configSystem)
      installed.set(battle, token)
    },
    snapshot(battle: Battle) {
      if (installed.get(battle) !== token) throw new Error('Battle belongs to a different content environment')
      return snapshotBattle(battle, catalog)
    },
    restore(data: unknown): Battle {
      const battle = restoreBattle(data, catalog)
      // Snapshot already includes scoped configuration and captured parameters; do not reinstall them.
      installed.set(battle, token)
      return battle
    },
  })
}
export type ContentEnvironment = Awaited<ReturnType<typeof lockContentEnvironment>>
