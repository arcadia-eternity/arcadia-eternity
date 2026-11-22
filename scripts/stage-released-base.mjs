// A client release commit can already contain edits waiting for the next data release PR.
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync('packs/.release-please-manifest.json', 'utf8'))
const version = manifest.packs
if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version))
  throw new Error('Invalid released official content version')
const tag = 'data-pack-base-v' + version
const ref = 'refs/tags/' + tag
const directories = ['packs/base', 'packs/environment-default', 'packs/environment-training-120']
for (const directory of directories) {
  const file = directory + '/package.json'
  const pkg = JSON.parse(execFileSync('git', ['show', ref + ':' + file], { encoding: 'utf8' }))
  const name = directory === 'packs/base' ? 'data-pack-base' : directory.slice('packs/'.length)
  if (pkg.name !== '@arcadia-eternity/' + name || pkg.version !== version)
    throw new Error(file + ' does not match ' + tag)
}
execFileSync('git', ['restore', '--source=' + ref, '--worktree', '--', ...directories], { stdio: 'inherit' })
console.log('Bundling official base and environments from ' + tag)
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, 'Bundled official content: `' + tag + '`\n')
