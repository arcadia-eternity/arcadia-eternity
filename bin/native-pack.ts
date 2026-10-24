import type { ContentPrototypeData } from '@arcadia-eternity/battle/v4'
import { SpeciesSchema, parseWithErrors } from '@arcadia-eternity/schema'

/** Validate metadata against the same compiled content used by local and server battles. */
export async function loadNativeCliPack(packRef = 'builtin:workspace') {
  const [{ NativePackLoader }, { nativeBuildIdentity }, { createOfficialContent }] = await Promise.all([
    import('@arcadia-eternity/pack-loader/native'),
    import('@arcadia-eternity/data-pack-base/build'),
    import('@arcadia-eternity/data-pack-base/native'),
  ])
  return new NativePackLoader(nativeBuildIdentity, createOfficialContent).load(packRef)
}

/** Rules query editable species metadata, including learnsets absent from runtime prototypes. */
export function createRuleSpeciesRepository(data: ContentPrototypeData) {
  const species = data.species.map(raw => parseWithErrors(SpeciesSchema, raw))
  const byId = new Map(species.map(value => [value.id, value]))
  return {
    getSpeciesById: (id: string) => byId.get(id),
    getAllSpecies: () => species,
  }
}
