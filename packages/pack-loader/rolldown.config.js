import { defineConfig } from 'rolldown'
import { isExternalDependency } from '../../scripts/rollup-external.mjs'

export default defineConfig({
  input: {
    index: 'index.ts',
    native: 'native.ts',
    node: 'node.ts',
    'generate-pack-lockfile': 'src/generate-pack-lockfile.ts',
  },
  output: { format: 'esm', dir: 'dist' },
  tsconfig: true,
  external: isExternalDependency,
})
