import { execFileSync } from 'node:child_process'
import { cp, mkdir, rm, chmod } from 'node:fs/promises'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const output = new URL('./dist/', import.meta.url)
await rm(output, { recursive: true, force: true })
await mkdir(output)
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'], {
  cwd: import.meta.dirname,
  stdio: 'inherit',
})
await cp(new URL('./src/', import.meta.url), output, {
  recursive: true,
  filter: path => !path.endsWith('.mts') || path.endsWith('.d.mts'),
})
await cp(new URL('./template/', import.meta.url), new URL('./dist/template/', import.meta.url), { recursive: true })
await cp(
  new URL('../../docs/guides/ugc-authoring-agent/', import.meta.url),
  new URL('./dist/template/skills/arcadia-content-authoring/', import.meta.url),
  { recursive: true },
)
await chmod(new URL('./dist/cli.mjs', import.meta.url), 0o755)
await cp(
  new URL('../../docs/guides/seer2-recreate-pet/', import.meta.url),
  new URL('./dist/template/skills/seer2-recreate-pet/', import.meta.url),
  { recursive: true },
)
await chmod(new URL('./dist/mcp.mjs', import.meta.url), 0o755)
