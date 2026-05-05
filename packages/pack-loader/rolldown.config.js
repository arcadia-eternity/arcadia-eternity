import { defineConfig } from 'rolldown'

export default defineConfig({
  input: {
    index: 'index.ts',
    'generate-pack-lockfile': 'src/generate-pack-lockfile.ts',
  },
  output: { format: 'esm', dir: 'dist' },
  tsconfig: true,
  external: id => !id.startsWith('.') && !id.startsWith('\0'),
})
