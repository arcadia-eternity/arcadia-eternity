import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// The JSON catalog is consumed offline by assistants. VitePress checks page links,
// but a missing HTML fragment otherwise silently opens the top of the right page.
const dist = new URL('./.vitepress/dist/', import.meta.url)
const { symbols } = JSON.parse(await readFile(new URL('sdk-index.json', dist), 'utf8'))
const anchors = new Map()
async function check(path) {
  const [page, fragment] = path.slice(1).split('#')
  if (!anchors.has(page)) {
    const html = await readFile(new URL(page + '.html', dist), 'utf8')
    anchors.set(page, new Set(Array.from(html.matchAll(/\sid="([^"]+)"/g), match => match[1])))
  }
  if (fragment) assert.ok(anchors.get(page).has(fragment), 'Missing SDK anchor ' + path)
}
for (const item of symbols) {
  await check(item.path)
  if (item.owner && item.group !== 'triggers')
    await check('/sdk/' + item.group + '/' + item.owner + '#member-' + item.symbol.slice(item.owner.length + 1))
}
console.log('Verified SDK routes and member bookmarks for ' + symbols.length + ' symbols.')
