import ts from 'typescript'
import { mkdir, writeFile } from 'node:fs/promises'
import { creatorPages } from '../../packages/content-dev/src/creator-docs.ts'
import { generateSdkReference } from '../../packages/content-dev/generate-sdk-reference.mjs'
import { sdkCatalog, sdkGroups, sdkPath } from '../../packages/content-dev/src/sdk-reference.ts'

const shortName = item => item.symbol.slice((item.owner?.length ?? -1) + 1)
const pagePath = item => sdkPath(item).split('#')[0]
const localLink = (text, path) => '[' + text + '](' + path + ')'
const symbolLink = item => localLink('`' + shortName(item) + '`', sdkPath(item))
const breadcrumb = links => links.join(' › ')
const mcp = symbol => ['::: details MCP 查询', '```json', JSON.stringify({ symbol }), '```', ':::'].join('\n')

function memberGroup(item) {
  if (item.group === 'triggers') return '触发器'
  if (item.owner === 'ops') {
    const name = shortName(item)
    if (/damage|shield|heal|kill/i.test(name)) return '伤害与治疗'
    if (/stack|mark/i.test(name)) return '印记与层数'
    if (/rage/i.test(name)) return '怒气'
    if (/attribute|parameter|statstage/i.test(name)) return '属性与参数'
    if (/skill|accuracy|hit|crit|miss|power|target/i.test(name)) return '出招与命中'
    return '通用操作'
  }
  return { 方法: '方法', 枚举值: '枚举值', 字段: '属性' }[item.kind] ?? item.kind
}

function alphabet(name) {
  const letter = name[0].toUpperCase()
  if (letter <= 'F') return 'A–F'
  if (letter <= 'M') return 'G–M'
  if (letter <= 'S') return 'N–S'
  return 'T–Z'
}

export async function prepareSdk(output, version) {
  const catalog = sdkCatalog(generateSdkReference(ts, import.meta.filename))
  const json = { sdkVersion: version, symbols: catalog.records.map(item => ({ ...item, path: sdkPath(item) })) }
  await writeFile(new URL('public/sdk-index.json', output), JSON.stringify(json))
  async function page(path, lines) {
    const file = new URL(path.slice(1) + (path.endsWith('/') ? 'index' : '') + '.md', output)
    await mkdir(new URL('.', file), { recursive: true })
    await writeFile(file, ['---', 'prev: false', 'next: false', '---', '', ...lines, ''].join('\n'))
  }

  const guides = new Map(
    creatorPages
      .filter(p => p.topic === 'effects')
      .flatMap(p => p.symbols.map(name => [name, localLink(p.title, '/' + p.path)])),
  )
  const home = localLink('SDK API', '/sdk/')
  const groups = Object.entries(sdkGroups).map(([group, text]) => ({ text, link: '/sdk/' + group + '/' }))
  const baseSidebar = [{ text: 'SDK API', link: '/sdk/', items: groups }]
  const sidebar = { '/sdk/': baseSidebar }

  for (const [group, title] of Object.entries(sdkGroups)) {
    const root = '/sdk/' + group + '/'
    const trail = [home, localLink(title, root)]
    const owners = catalog.records.filter(item => item.group === group && (!item.owner || group === 'triggers'))
    const byLetter = owners.length > 64
    const sections = Map.groupBy(owners, item => {
      if (byLetter) return alphabet(item.symbol)
      if (group === 'triggers') return item.parent
      if (group === 'objects') return item.symbol.endsWith('Context') ? '事件上下文' : '战斗对象'
      return title
    })

    const nav = []
    const overview = [home, '', '# ' + title, '']
    for (const [label, items] of sections) {
      const entries = items.map(item => ({ text: shortName(item), link: sdkPath(item) }))
      const listing = entries.map(entry => '- ' + localLink('`' + entry.text + '`', entry.link))
      if (byLetter) {
        const link = root + 'by-name/' + label.toLowerCase().replace('–', '-')
        overview.push('- ' + localLink(label, link) + '（' + entries.length + '）')
        await page(link, [breadcrumb(trail), '', '# ' + title + ' · ' + label, '', ...listing])
        nav.push({ text: label, link, collapsed: true, items: entries })
      } else {
        if (label !== title) overview.push('## ' + label, '')
        overview.push(...listing, '')
        nav.push({ text: label, collapsed: sections.size > 1, items: entries })
      }
    }
    await page(root, overview)
    sidebar[root] = [...baseSidebar, ...nav]

    for (const item of owners) {
      const path = sdkPath(item)
      const kids = catalog.children.get(item.symbol) ?? []
      const lines = [breadcrumb(trail), '', '# ' + item.symbol, '']
      // The namespace declaration can inline the signatures of every member.
      if (kids.length && item.signature.length > 500) {
        if (item.description) lines.push(item.description, '')
        lines.push('::: details 完整类型声明', '```typescript', item.signature, '```', ':::', '')
      } else lines.push(catalog.body(item), '')
      const childGroups = Map.groupBy(kids, child => {
        if (item.symbol === 'EffectSdk') return sdkGroups[catalog.byName.get(shortName(child))?.group] ?? '其他成员'
        return memberGroup(child)
      })
      if (group === 'objects' && kids.length) {
        lines.push('## 成员速查', '', '| 类别 | 成员 |', '| --- | --- |')
        for (const [label, members] of childGroups)
          lines.push('| ' + label + ' | ' + members.map(symbolLink).join('、') + ' |')
        lines.push('')
      }
      if (guides.has(item.symbol)) lines.push('用法示例　' + guides.get(item.symbol), '')
      const subpages = Map.groupBy(
        kids.filter(child => child.group !== 'triggers' && pagePath(child) !== path),
        pagePath,
      )
      for (const [detailPath, members] of subpages) {
        const primary = members.find(member => sdkPath(member) === detailPath)
        if (!primary) throw Error('Missing SDK detail page: ' + detailPath)
        const detail = [breadcrumb([...trail, catalog.link(item.symbol)]), '', catalog.markdown(primary)]
        const fields = members.filter(member => member !== primary)
        if (fields.length) detail.push('## 字段', '')
        for (const field of fields)
          detail.push('### ' + field.symbol + ' {#' + sdkPath(field).split('#')[1] + '}', '', catalog.body(field), '')
        if (guides.has(primary.symbol)) detail.push('用法示例　' + guides.get(primary.symbol), '')
        detail.push(mcp(primary.symbol))
        await page(detailPath, detail)
      }

      for (const [label, members] of childGroups) {
        lines.push('## ' + label, '')
        if (
          group === 'objects' &&
          label === '属性' &&
          members.every(m => !/[`\n]/.test(m.signature) && m.signature.length < 160)
        ) {
          lines.push('| 属性 | 类型 | 相关符号 |', '| --- | --- | --- |')
          for (const field of members) {
            const anchor = sdkPath(field).split('#')[1]
            lines.push(
              '| <span id="' +
                anchor +
                '">' +
                symbolLink(field) +
                '</span> | `' +
                field.signature.replaceAll('|', '\\|') +
                '` | ' +
                field.related.map(catalog.link).join('、') +
                ' |',
            )
          }
          lines.push('')
          for (const field of members.filter(m => m.description))
            lines.push(
              '- ' + symbolLink(field) + '　' + field.description.replace(/[<>{}]/g, c => '&#' + c.charCodeAt(0) + ';'),
            )
          lines.push('')
          continue
        }
        for (const child of members) {
          const name = shortName(child)
          const target = sdkPath(child)
          if (pagePath(child) !== path) {
            // Existing bookmarks into the owner still lead straight to the new detail.
            lines.push('<span id="member-' + name + '">' + symbolLink(child) + '</span>\n')
          } else if (item.symbol === 'EffectSdk' && catalog.byName.has(name)) {
            lines.push(
              '<span id="member-' + name + '">' + catalog.link(name) + '</span>',
              '',
              '::: details 成员签名',
              '```typescript',
              child.signature,
              '```',
              ':::',
              '',
            )
          } else {
            lines.push('### ' + child.symbol + ' {#' + target.split('#')[1] + '}', '', catalog.body(child), '')
          }
        }
      }
      if (subpages.size) {
        const direct = [...subpages.values()].flatMap(members => members.filter(m => !sdkPath(m).includes('#')))
        const items = [...Map.groupBy(direct, memberGroup)].map(([text, members]) => ({
          text,
          collapsed: true,
          items: members.map(m => ({ text: shortName(m), link: sdkPath(m) })),
        }))
        sidebar[path + '/'] = [...baseSidebar, { text: item.symbol, link: path, items }]
      }
      lines.push(mcp(item.symbol))
      await page(path, lines)
    }
  }
  await page('/sdk/', [
    '# 战斗 SDK API',
    '',
    '| 要查什么 | 从这里开始 |',
    '| --- | --- |',
    '| 技能在什么时候响应命中？ | [OnHit](/sdk/triggers/OnHit) · [所有触发器](/sdk/triggers/) |',
    '| 实际目标有哪些方法？ | [UseSkillContext](/sdk/objects/UseSkillContext#member-actualTarget) · [Pet](/sdk/objects/Pet) |',
    '| 怎样修改属性或施加印记？ | [ops](/sdk/values/ops) · [ops.bindAttribute](/sdk/values/ops/bindAttribute) |',
    '',
    '## 分类',
    '',
    ...groups.map(g => '- ' + localLink(g.text, g.link)),
    '',
    '[MCP 符号查询](/api/author-reference) · [下载 SDK 符号索引](/sdk-index.json)',
  ])
  return sidebar
}
