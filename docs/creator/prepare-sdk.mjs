import ts from 'typescript'
import { mkdir, writeFile } from 'node:fs/promises'
import { generateSdkReference } from '../../packages/content-dev/generate-sdk-reference.mjs'
import { sdkCatalog, sdkGroups, sdkPath } from '../../packages/content-dev/src/sdk-reference.ts'

export async function prepareSdk(output, version) {
  const catalog = sdkCatalog(generateSdkReference(ts, import.meta.filename))
  const json = { sdkVersion: version, symbols: catalog.records.map(item => ({ ...item, path: sdkPath(item) })) }
  await writeFile(new URL('public/sdk-index.json', output), JSON.stringify(json))
  const groups = []
  for (const [group, title] of Object.entries(sdkGroups)) {
    const folder = new URL('sdk/' + group + '/', output)
    await mkdir(folder, { recursive: true })
    const pages = catalog.records.filter(item => item.group === group && (!item.owner || group === 'triggers'))
    const lines = ['# ' + title, '']
    for (const item of pages) {
      lines.push('- ' + catalog.link(item.symbol) + (item.parent ? ' · ' + catalog.link(item.parent) : ''))
      const page = [catalog.markdown(item)]
      const children = catalog.children.get(item.symbol) ?? []
      if (children.length) page.push('## 成员', '', children.map(child => catalog.link(child.symbol)).join('、'), '')
      for (const child of children) {
        if (child.group === 'triggers') continue
        page.push(
          '### ' + child.symbol + ' {#member-' + child.symbol.slice(item.symbol.length + 1) + '}',
          '',
          catalog.body(child),
          '',
        )
      }
      page.push('## MCP 查询', '', '```json', JSON.stringify({ symbol: item.symbol }), '```', '')
      const path = sdkPath(item).slice(1)
      await writeFile(new URL(path + '.md', output), page.join('\n'))
    }
    await writeFile(new URL('index.md', folder), lines.join('\n') + '\n')
    groups.push({ text: title, link: '/sdk/' + group + '/' })
  }
  return groups
}
