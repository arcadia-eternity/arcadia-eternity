import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Release Please reports only the newly created tags on a retry after partially tagging a pair.
export function publishedTags(client, content, cwd = process.cwd()) {
  if (!client || !content) {
    const tag = client || content
    assert.match(tag, /^(?:arcadia-eternity|data-pack-base)-v\d+\.\d+\.\d+$/)
    const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
    const commit = 'refs/tags/' + tag + '^{commit}'
    const versions = JSON.parse(git('show', commit + ':.release-please-manifest.json'))
    const peer = client ? 'data-pack-base-v' + versions.packs : 'arcadia-eternity-v' + versions['.']
    if (git('tag', '--points-at', commit, '--list', peer) === peer) {
      if (client) content = peer
      else client = peer
    }
  }
  return { client, content }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { client, content } = publishedTags(process.env.CLIENT_TAG, process.env.CONTENT_TAG)
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `client=${client}\ncontent=${content}\nversion=${client.replace('arcadia-eternity-v', '')}\n`,
  )
}
