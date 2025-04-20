import { nodeResolve } from '@rollup/plugin-node-resolve'
import nodeExternals from 'rollup-plugin-node-externals'
import typescript from '@rollup/plugin-typescript'
import json from '@rollup/plugin-json'

export default {
  input: 'index.ts',
  output: {
    dir: 'dist',
    format: 'esm',
    preserveModules: false,
  },
  plugins: [
    json(),
    nodeExternals(),
    nodeResolve(),
    typescript({
      module: 'ESNext',
      tsconfig: 'tsconfig.json',
    }),
  ],
}
