import { fileURLToPath } from 'node:url'
import { compileEffectModule } from '@arcadia-eternity/pack-loader/node'

// Source-mode Node launcher; the host build plugin replaces this with compiled text.
export default await compileEffectModule(
  fileURLToPath(import.meta.resolve('@arcadia-eternity/data-pack-base/effects')),
  fileURLToPath(new URL('../../../../', import.meta.url)),
  '@arcadia-eternity/data-pack-base',
)
