import { spawnSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(new URL('../packages/web-ui/package.json', import.meta.url))
const manifest = require.resolve('electron/package.json')
const directory = dirname(manifest)
const { version } = JSON.parse(readFileSync(manifest, 'utf8'))
const env = { ...process.env }
delete env.ELECTRON_SKIP_BINARY_DOWNLOAD
// Use Electron's installer and the checksums shipped in the locked npm package.
// The CI workflow selects the download mirror; verification remains enabled.
const result = spawnSync(process.execPath, [join(directory, 'install.js')], {
  env,
  stdio: 'inherit',
  timeout: 300_000,
})
if (result.error) throw result.error
if (result.status !== 0) throw new Error(`Electron installation failed (${result.status})`)
const installed = readFileSync(join(directory, 'dist/version'), 'utf8').trim().replace(/^v/, '')
if (installed !== version) throw new Error(`Expected Electron ${version}, installed ${installed}`)
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `ARCADIA_ELECTRON_DIST=${join(directory, 'dist')}\n`)
console.log(`Verified Electron ${version} for ${process.platform}/${process.arch}`)
