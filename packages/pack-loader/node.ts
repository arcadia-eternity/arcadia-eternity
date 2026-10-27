import * as resolver from '@arcadia-eternity/battle/pack'
import { NativePackLoader } from './src/native-loader'
export { NodeWorkStorage } from './src/node-work-storage'
export { readNpmAdmission } from './src/npm/admission'
export { resolveNpmInvocation } from './src/npm/runner'
export { inspectNpmProject, type NpmProjectInspection, type NpmContentManifest } from './src/npm/inspect'
export {
  prepareNpmProject,
  type NpmEffectModuleContext,
  type NpmEffectModule,
  type NpmContentHost,
  type PreparedNpmEnvironment,
} from './src/npm/prepare'

/** Static Node resolver boundary; HTTP/browser consumers keep the native-only entry. */
export class NativeNodePackLoader extends NativePackLoader {
  protected override async importNodePackResolver() {
    return resolver
  }
}
