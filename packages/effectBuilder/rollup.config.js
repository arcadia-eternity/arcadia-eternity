import { nodeResolve } from '@rollup/plugin-node-resolve'
import nodeExternals from 'rollup-plugin-node-externals'
import { swc } from 'rollup-plugin-swc3'
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
    swc({
      tsconfig: 'tsconfig.json',
    }),
  ],
}
