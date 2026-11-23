import { prepareSdk } from './prepare-sdk.mjs'
import { copyFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { creatorSections, creatorSdkVersion, readCreatorPage } from '../../packages/content-dev/src/creator-docs.ts'

const output = new URL('./generated/', import.meta.url)
await rm(output, { recursive: true, force: true })
await mkdir(new URL('public/', output), { recursive: true })
const template = new URL('../../packages/content-dev/template/', import.meta.url)
await copyFile(new URL('assets/pets/frostling-portrait.png', template), new URL('public/frostling.png', output))

const lessons = creatorSections.filter(section => !section.reference)
const references = creatorSections.filter(section => section.reference)
const navItem = page => ({ text: page.title, link: '/' + page.path })
const sectionNav = section => ({ text: section.title, collapsed: true, items: section.pages.map(navItem) })

for (const section of creatorSections) {
  for (const [i, page] of section.pages.entries()) {
    for (const base of [output, new URL('public/reference/', output)])
      await mkdir(new URL('.', new URL(page.path, base)), { recursive: true })
    const body = await readCreatorPage(page)
    await writeFile(new URL('public/reference/' + page.path + '.md', output), body)
    const previous = section.pages[i - 1]
    const next = section.pages[i + 1]
    const frontmatter = {
      prev: !section.reference && previous ? navItem(previous) : false,
      next: !section.reference && next ? navItem(next) : false,
    }
    const query = [
      '::: details MCP 查询',
      '```json',
      JSON.stringify({ topic: page.topic, symbol: page.symbols[0] }),
      '```',
      ':::',
    ]
    await writeFile(
      new URL(page.path + '.md', output),
      [
        '---',
        ...Object.entries(frontmatter).map(([key, value]) => key + ': ' + JSON.stringify(value)),
        '---',
        '',
        body,
        ...query,
        '',
      ].join('\n'),
    )
  }
}

const sdkSidebar = await prepareSdk(output, creatorSdkVersion)
await writeFile(
  new URL('tutorials/index.md', output),
  [
    '# 创作教程',
    '',
    ...lessons.flatMap(section => [
      '## ' + section.title,
      '',
      section.outcome,
      '',
      ...section.pages.map(page => '- [' + page.title + '](/' + page.path + ')'),
      '',
    ]),
  ].join('\n'),
)
const origin = 'https://arcadia-creator-docs.pages.dev'
const index = creatorSections.flatMap(section => [
  '## ' + section.title,
  '',
  ...section.pages.map(page => `- [${page.title}](${origin}/reference/${page.path}.md) — ${page.symbols.join(', ')}`),
  '',
])
await writeFile(
  new URL('public/llms.txt', output),
  [
    `# Arcadia 创作者文档 · SDK ${creatorSdkVersion}`,
    '',
    '[SDK 符号索引（JSON）](' + origin + '/sdk-index.json)',
    '',
    ...index,
  ].join('\n'),
)
const apiIndex = references.flatMap(section => [
  '## ' + section.title,
  '',
  ...section.pages.map(
    page => '- [' + page.title + '](/' + page.path + ')　' + page.symbols.map(s => '`' + s + '`').join('、'),
  ),
  '',
])
await writeFile(
  new URL('api/index.md', output),
  [
    '# API 参考',
    '',
    '## SDK 符号',
    '',
    '从[霜击的命中事件](/sdk/triggers/OnHit)开始，可以查到回调收到的上下文、目标精灵的方法和模板代码。AI 可下载[版本化符号索引](/sdk-index.json)，或通过本机 MCP 调用 `author_reference({"symbol":"EffectTrigger.OnHit"})`。',
    '',
    '[浏览战斗 SDK API](/sdk/) · [触发器](/sdk/triggers/) · [战斗对象与上下文](/sdk/objects/)',
    '',
    ...apiIndex,
  ].join('\n'),
)
await copyFile(new URL('./home.md', import.meta.url), new URL('index.md', output))
await writeFile(
  new URL('navigation.json', output),
  JSON.stringify({
    version: creatorSdkVersion,
    sidebar: {
      '/': [{ text: '创作教程', link: '/tutorials/' }, ...lessons.map(sectionNav)],
      '/api/': [{ text: 'API 与工具', link: '/api/' }, ...references.map(sectionNav)],
      ...sdkSidebar,
    },
  }),
)
