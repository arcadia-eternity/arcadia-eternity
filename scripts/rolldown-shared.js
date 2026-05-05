import { defineConfig } from 'rolldown'

/**
 * Creates a standard rolldown config for a package.
 * Replaces: rollup-plugin-node-externals + @rollup/plugin-node-resolve + rollup-plugin-swc3
 */
export function createPackageConfig(options = {}) {
  const { input = 'index.ts', external, output = {}, plugins = [] } = options

  return defineConfig({
    input,
    output: {
      format: 'esm',
      dir: 'dist',
      ...output,
    },
    tsconfig: true,
    // Auto-externalize node_modules (replaces rollup-plugin-node-externals)
    external: external ?? (id => !id.startsWith('.') && !id.startsWith('\0')),
    plugins,
  })
}
