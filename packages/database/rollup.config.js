import { nodeResolve } from '@rollup/plugin-node-resolve'
import { swc } from 'rollup-plugin-swc3'
import nodeExternals from 'rollup-plugin-node-externals'

export default {
  input: 'index.ts',
  output: {
    dir: 'dist',
    format: 'esm',
    preserveModules: false,
  },
  plugins: [
    nodeExternals(),
    nodeResolve(),
    swc({
      tsconfig: 'tsconfig.json',
    }),
  ],
}
