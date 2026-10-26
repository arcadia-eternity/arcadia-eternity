import * as resolver from '@arcadia-eternity/battle/pack'
import { NativePackLoader } from './src/native-loader'
export { NodeWorkStorage } from './src/node-work-storage'

/** Static Node resolver boundary; HTTP/browser consumers keep the native-only entry. */
export class NativeNodePackLoader extends NativePackLoader {
  protected override async importNodePackResolver() {
    return resolver
  }
}
