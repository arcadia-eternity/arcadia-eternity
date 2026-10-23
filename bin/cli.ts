#!/usr/bin/env node
import { runCli } from '../packages/cli/src/main'

process.exitCode = await runCli(process.argv.slice(2), async () => {
  await import('./legacy-cli')
})
