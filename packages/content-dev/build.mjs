import { execFileSync } from 'node:child_process'
import { cp, mkdir, readFile, readdir, rm, chmod, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const output = new URL('./dist/', import.meta.url)

async function rewriteDeclarationImports(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directory)
    if (entry.isDirectory()) {
      await rewriteDeclarationImports(path)
      continue
    }
    if (!entry.name.endsWith('.d.ts')) continue
    const source = await readFile(path, 'utf8')
    const rewritten = source.replace(
      /(\b(?:from|import)\s*\(?\s*)(['"])(\.{1,2}\/[^'"]+)\.ts\2/g,
      (_match, prefix, quote, specifier) => `${prefix}${quote}${specifier}.js${quote}`,
    )
    if (rewritten !== source) await writeFile(path, rewritten)
  }
}

await rm(output, { recursive: true, force: true })
await mkdir(output)
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'], {
  cwd: import.meta.dirname,
  stdio: 'inherit',
})
await rewriteDeclarationImports(output)
await cp(new URL('./template/', import.meta.url), new URL('./dist/template/', import.meta.url), { recursive: true })
await cp(
  new URL('../../docs/guides/ugc-authoring-agent/', import.meta.url),
  new URL('./dist/template/skills/arcadia-content-authoring/', import.meta.url),
  { recursive: true },
)
await chmod(new URL('./dist/cli.js', import.meta.url), 0o755)
await cp(
  new URL('../../docs/guides/seer2-recreate-pet/', import.meta.url),
  new URL('./dist/template/skills/seer2-recreate-pet/', import.meta.url),
  { recursive: true },
)
await chmod(new URL('./dist/mcp.js', import.meta.url), 0o755)
