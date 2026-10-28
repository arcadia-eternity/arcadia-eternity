import { cp, mkdir, rm, chmod } from 'node:fs/promises'
const output = new URL('./dist/', import.meta.url)
await rm(output, { recursive: true, force: true })
await mkdir(output)
await cp(new URL('./src/', import.meta.url), output, { recursive: true })
await chmod(new URL('./dist/cli.mjs', import.meta.url), 0o755)
