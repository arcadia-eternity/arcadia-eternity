import type { ContentCatalog } from '@arcadia-eternity/battle/engine'
import * as resolver from '@arcadia-eternity/battle/pack'
import { NativePackLoader } from './src/native-loader'
export { readNpmAdmission } from './src/npm/admission'
export { resolveNpmInvocation } from './src/npm/runner'
export { parseNpmPackOutput, type NpmPackEntry, type NpmPackFile } from './src/npm/pack-output'
export { inspectNpmProject, type NpmProjectInspection, type NpmContentManifest } from './src/npm/inspect'
export {
  prepareNpmProject,
  prepareShippedEnvironment,
  emptyNpmContentHost,
  type NpmContentHost,
  type PreparedNpmEnvironment,
} from './src/npm/prepare'
export { stageCatalogProject, withShippedCatalogArchive, withShippedEnvironmentProject } from './src/npm/official-host'
export { compileEffectModule } from './src/npm/effect-artifact'
export { sandboxEnvironmentFor } from './src/effect-environment'

/** Static Node resolver boundary; HTTP/browser consumers keep the native-only entry. */
export class NativeNodePackLoader<Content extends object = ContentCatalog> extends NativePackLoader<Content> {
  protected override async importNodePackResolver() {
    return resolver
  }
}

export type { PreparedPresentation } from './src/npm/resources'

export { effectDiscoveryPlugin } from './src/npm/effect-discovery'
