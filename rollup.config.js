import nodeExternals from 'rollup-plugin-node-externals'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import { swc } from 'rollup-plugin-swc3'

export default {
  input: 'bin/cli.ts',
  output: {
    dir: './dist',
    format: 'esm',
    preserveModules: false,
  },
  plugins: [
    nodeResolve(),
    nodeExternals(),
    swc({
      tsconfig: './tsconfig.json',
    }),
  ],
}
