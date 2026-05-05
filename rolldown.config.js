import { defineConfig } from 'rolldown'

export default defineConfig({
  input: 'bin/cli.ts',
  output: {
    dir: 'dist',
    format: 'esm',
  },
  tsconfig: true,
  external: id => !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0'),
})
