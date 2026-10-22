import { defineConfig } from 'rolldown'
export default defineConfig({
  input: {
    index: 'index.ts',
    node: 'node.ts',
    pack: 'pack.ts',
    v4: 'v4.ts',
    'v4-legacy': 'v4-legacy.ts',
    'v4-host': 'v4-host.ts',
  },
  output: { format: 'esm', dir: 'dist' },
  tsconfig: true,
  external: id => !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\0'),
})
