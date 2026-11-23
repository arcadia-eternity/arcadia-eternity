import { copyFile, mkdir, writeFile, rm } from 'node:fs/promises'
import {
  creatorSections,
  creatorPages,
  creatorSdkVersion,
  readCreatorPage,
} from '../../packages/content-dev/src/creator-docs.ts'

const output = new URL('./generated/', import.meta.url)
await rm(output, { recursive: true, force: true })
await mkdir(new URL('public/', output), { recursive: true })
const template = new URL('../../packages/content-dev/template/', import.meta.url)
await copyFile(new URL('assets/pets/frostling-portrait.png', template), new URL('public/frostling.png', output))

for (const page of creatorPages) {
  for (const base of [output, new URL('public/reference/', output)])
    await mkdir(new URL('.', new URL(page.path, base)), { recursive: true })
  const body = await readCreatorPage(page)
  await writeFile(new URL('public/reference/' + page.path + '.md', output), body)
  const lookup = { topic: page.topic, symbol: page.symbols[0] }
  const query = [
    '## 在本机 SDK 查询',
    '',
    '用 `author_reference` 读取此页：',
    '',
    '```json',
    JSON.stringify(lookup),
    '```',
  ].join('\n')
  await writeFile(new URL(page.path + '.md', output), body + '\n' + query + '\n')
}

const origin = 'https://arcadia-creator-docs.pages.dev'
const index = creatorSections.flatMap(section => [
  '## ' + section.title,
  '',
  ...section.pages.map(page => `- [${page.title}](${origin}/reference/${page.path}.md) — ${page.symbols.join(', ')}`),
  '',
])
await writeFile(
  new URL('public/llms.txt', output),
  [`# Arcadia 创作者文档 · SDK ${creatorSdkVersion}`, '', ...index].join('\n'),
)
const apiIndex = creatorSections
  .filter(section => section.reference)
  .flatMap(section => [
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
    '按文件字段、战斗符号或工具名查询。每页末尾附有读取本机 SDK 版本的 MCP 调用。',
    '',
    ...apiIndex,
  ].join('\n'),
)
await copyFile(new URL('./home.md', import.meta.url), new URL('index.md', output))
await writeFile(
  new URL('navigation.json', output),
  JSON.stringify({
    version: creatorSdkVersion,
    sidebar: creatorSections.map(section => ({
      text: section.title,
      items: section.pages.map(page => ({ text: page.title, link: '/' + page.path })),
    })),
  }),
)
