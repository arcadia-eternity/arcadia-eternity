import { nodeResolve } from '@rollup/plugin-node-resolve'
import { swc } from 'rollup-plugin-swc3'
import nodeExternals from 'rollup-plugin-node-externals'

export default {
  input: 'src/index.ts',
  output: {
    dir: 'dist',
    format: 'es',
    preserveModules: true,
    preserveModulesRoot: 'src',
  },
  plugins: [
    nodeExternals(),
    nodeResolve(),
    swc({
      tsconfig: './tsconfig.json',
    }),
  ],
}
