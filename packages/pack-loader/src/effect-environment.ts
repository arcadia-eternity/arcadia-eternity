import type { ContentPrototypeData } from '@arcadia-eternity/battle/engine'
import type { SandboxEnvironment } from '@arcadia-eternity/battle/sandbox/effects'
import { digestJson, freeze } from './works/model'

const environments = new WeakMap<object, SandboxEnvironment>()

export function sandboxEnvironmentFor(content: object): SandboxEnvironment | undefined {
  return environments.get(content)
}

/** Associate a read-only content index with the immutable recipe used by each battle Worker. */
export async function bindEffectEnvironment(
  content: object,
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
