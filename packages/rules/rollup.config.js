import resolve from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'

export default {
  input: 'src/index.ts',
  output: {
    file: 'dist/index.js',
    format: 'esm',
    sourcemap: true,
  },
  plugins: [
    resolve({
      preferBuiltins: false,
    }),
    typescript({
      tsconfig: './tsconfig.json',
    }),
  ],
  external: [
    '@arcadia-eternity/const',
    '@arcadia-eternity/battle',
    '@arcadia-eternity/schema',
    'nanoid',
    'rxjs',
    'rxjs/operators',
  ],
}
