import { nodeResolve } from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
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
    typescript({
      tsconfig: './tsconfig.json',
      declaration: false, // 由 tsc 单独处理
      declarationMap: false,
    }),
  ],
}
