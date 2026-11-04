import { defineConfig } from 'rolldown'
import { isExternalDependency } from '../../scripts/rollup-external.mjs'
import { builtinEffectsPlugin } from '../../scripts/effect-module-plugin.ts'

export default defineConfig({
  input: 'index.ts',
  output: { format: 'esm', dir: 'dist' },
  tsconfig: true,
  plugins: [builtinEffectsPlugin()],
  external: id => !id.endsWith('?effect-module') && isExternalDependency(id),
})
