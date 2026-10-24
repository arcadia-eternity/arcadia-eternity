#!/usr/bin/env node
import { runCli } from '../packages/cli/src/main'

const args = process.argv.slice(2)
if (args[0] === 'server') {
  const { runServerCli } = await import('./server-cli')
  process.exitCode = await runServerCli(args.slice(1))
} else {
  process.exitCode = await runCli(args, async () => {
    await import('./legacy-cli')
  })
}
