import type { ContentCatalog, ContentPrototypeData } from '@arcadia-eternity/battle/v4'
import type { SandboxEnvironment } from '@arcadia-eternity/battle/v4/sandbox/effects'
import { digestJson, freeze } from './works/model'

const environments = new WeakMap<ContentCatalog, SandboxEnvironment>()

export function sandboxEnvironmentFor(content: ContentCatalog): SandboxEnvironment | undefined {
  return environments.get(content)
}

/** Keep validation catalogs separate from the immutable recipe used by each battle Worker. */
export async function bindEffectEnvironment(
  content: ContentCatalog,
  data: ContentPrototypeData,
  revision: string,
  modules: SandboxEnvironment['modules'],
): Promise<SandboxEnvironment> {
  const environment: SandboxEnvironment = freeze(
    structuredClone({ revision: `${revision}/effects:${await digestJson(modules)}`, data, modules }),
  )
  environments.set(content, environment)
  return environment
}
