import { defineConfig } from 'rolldown'
import { isExternalDependency } from '../../scripts/rollup-external.mjs'
export default defineConfig({
  input: 'index.ts',
  output: { format: 'esm', dir: 'dist' },
  tsconfig: true,
  external: isExternalDependency,
})
