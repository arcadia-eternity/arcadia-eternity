import nodeExternals from 'rollup-plugin-node-externals'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

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
    typescript({
      module: 'ESNext',
      tsconfig: 'tsconfig.json',
    }),
  ],
}
