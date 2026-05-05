import { defineConfig } from 'rolldown'

export default defineConfig({
  input: 'src/index.ts',
  output: {
    file: 'dist/index.js',
    format: 'esm',
    sourcemap: true,
  },
  tsconfig: true,
  external: [
    '@arcadia-eternity/const',
    '@arcadia-eternity/battle',
    '@arcadia-eternity/schema',
    'nanoid',
    'rxjs',
    'rxjs/operators',
  ],
})
