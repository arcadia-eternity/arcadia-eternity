import { cp, mkdir, rm, chmod } from 'node:fs/promises'
const output = new URL('./dist/', import.meta.url)
await rm(output, { recursive: true, force: true })
await mkdir(output)
await cp(new URL('./src/', import.meta.url), output, { recursive: true })
await cp(new URL('./template/', import.meta.url), new URL('./dist/template/', import.meta.url), { recursive: true })
await cp(
  new URL('../../docs/v4/ugc-authoring-agent/', import.meta.url),
  new URL('./dist/template/skills/arcadia-content-authoring/', import.meta.url),
  { recursive: true },
)
await chmod(new URL('./dist/cli.mjs', import.meta.url), 0o755)
await chmod(new URL('./dist/mcp.mjs', import.meta.url), 0o755)
