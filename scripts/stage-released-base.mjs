// A client release commit can already contain edits waiting for the next data release PR.
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync('.release-please-manifest.json', 'utf8'))
const version = manifest['packs/base']
// Last joint release before independent data-pack tags were introduced.
const bootstrapTag = 'arcadia-eternity-v4.11.1'
if (version !== undefined && (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)))
  throw new Error('Invalid released base pack version')
const tag = version ? 'data-pack-base-v' + version : bootstrapTag
const ref = 'refs/tags/' + tag
const pkg = JSON.parse(execFileSync('git', ['show', ref + ':packs/base/package.json'], { encoding: 'utf8' }))
if (pkg.name !== '@arcadia-eternity/data-pack-base' || pkg.version !== (version ?? '4.11.1'))
  throw new Error('The base pack manifest does not match ' + tag)
execFileSync('git', ['restore', '--source=' + ref, '--worktree', '--', 'packs/base'], { stdio: 'inherit' })
console.log('Bundling official base pack from ' + tag)
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, 'Bundled base pack: `' + tag + '`\n')
