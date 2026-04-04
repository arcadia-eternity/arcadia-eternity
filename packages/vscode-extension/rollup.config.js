import typescript from '@rollup/plugin-typescript'
import { nodeResolve } from '@rollup/plugin-node-resolve'

const baseTsPlugin = typescript({
  tsconfig: './tsconfig.json',
  sourceMap: true,
})

export default [
  {
    input: './src/extension.node.ts',
    output: {
      file: './dist/extension.node.cjs',
      format: 'cjs',
      sourcemap: true,
    },
    external: ['vscode', 'node:path', 'node:fs/promises', 'path', 'fs/promises'],
    plugins: [nodeResolve({ preferBuiltins: true }), baseTsPlugin],
  },
  {
    input: './src/extension.browser.ts',
    output: {
      file: './dist/extension.browser.cjs',
      format: 'cjs',
      sourcemap: true,
    },
    external: ['vscode'],
    plugins: [nodeResolve({ browser: true, preferBuiltins: false }), baseTsPlugin],
  },
]
