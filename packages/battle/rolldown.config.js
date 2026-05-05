import { defineConfig } from 'rolldown'
export default defineConfig({
  input: {
    index: 'index.ts',
    node: 'node.ts',
  },
  output: { format: 'esm', dir: 'dist' },
  tsconfig: true,
  external: id => !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0'),
})
