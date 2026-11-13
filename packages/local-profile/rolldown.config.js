import { defineConfig } from 'rolldown'
import { isExternalDependency } from '../../scripts/rollup-external.mjs'
export default defineConfig({
  input: { index: 'src/index.ts', node: 'src/node.ts', browser: 'src/browser.ts' },
  output: { dir: 'dist', format: 'esm' },
  external: isExternalDependency,
})
