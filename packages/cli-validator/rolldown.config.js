import { defineConfig } from 'rolldown'

export default defineConfig({
  input: 'index.ts',
  output: { format: 'esm', dir: 'dist' },
  tsconfig: true,
  external: id => !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0'),
})
