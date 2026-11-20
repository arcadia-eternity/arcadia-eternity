// SDK 4.6 requests "npm pack" in the scenario directory. Give npm the verified
// archive as its explicit input. All installs and dependency packs still use npm.
import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const filename = process.env.ARCADIA_TEST_RELEASE_ARCHIVE
if (
  args[0] === 'pack' &&
  args[1] === '--json' &&
  filename &&
  /^[a-z0-9][a-z0-9._-]*\.tgz$/.test(filename) &&
  realpathSync(process.cwd()) === realpathSync(process.env.ARCADIA_TEST_RELEASE_ROOT)
)
  args.splice(1, 0, join(process.cwd(), filename))
if (process.env.ARCADIA_TEST_BASE_NPM) process.env.ARCADIA_NPM_CLI = process.env.ARCADIA_TEST_BASE_NPM
else delete process.env.ARCADIA_NPM_CLI
const require = createRequire(import.meta.url)
const sdk = createRequire(require.resolve('@arcadia-eternity/content-sdk'))
const { resolveNpmInvocation } = await import(pathToFileURL(sdk.resolve('@arcadia-eternity/pack-loader/node')).href)
const command = await resolveNpmInvocation(args)
const result = spawnSync(command.file, command.args, { stdio: 'inherit', windowsHide: true })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
