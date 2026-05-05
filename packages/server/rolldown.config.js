import { defineConfig } from 'rolldown'
import copy from 'rollup-plugin-copy'

export default defineConfig({
  input: 'index.ts',
  output: { format: 'esm', dir: 'dist' },
  tsconfig: true,
  external: id => !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0'),
  plugins: [
    copy({
      targets: [
        {
          src: 'src/templates/**/*',
          dest: 'dist/src/templates',
        },
      ],
    }),
  ],
})
