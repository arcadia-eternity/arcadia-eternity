import { copyFile, mkdir, writeFile, rm } from 'node:fs/promises'
import { creatorPages, creatorSdkVersion, readCreatorPage } from '../../packages/content-dev/src/creator-docs.ts'

const output = new URL('./generated/', import.meta.url)
await rm(output, { recursive: true, force: true })
await mkdir(new URL('api/', output), { recursive: true })
await mkdir(new URL('public/reference/api/', output), { recursive: true })
const template = new URL('../../packages/content-dev/template/', import.meta.url)
await copyFile(new URL('assets/pets/frostling-portrait.png', template), new URL('public/frostling.png', output))

for (const page of creatorPages) {
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
const index = creatorPages.map(
  page => `- [${page.title}](${origin}/reference/${page.path}.md) — ${page.symbols.join(', ')}`,
)
await writeFile(
  new URL('public/llms.txt', output),
  [`# Arcadia 创作者文档 · SDK ${creatorSdkVersion}`, '', ...index, ''].join('\n'),
)
const tutorial = creatorPages[0]
const api = creatorPages.filter(page => page.topic !== 'tutorials')
const apiIndex = ['# API 参考', '', ...api.map(page => '- [' + page.title + '](/' + page.path + ')'), ''].join('\n')
await writeFile(new URL('api/index.md', output), apiIndex)
await copyFile(new URL('./home.md', import.meta.url), new URL('index.md', output))
await writeFile(
  new URL('navigation.json', output),
  JSON.stringify({
    version: creatorSdkVersion,
    sidebar: [
      { text: '创作教程', items: [{ text: tutorial.title, link: '/' + tutorial.path }] },
      { text: 'API 参考', items: api.map(page => ({ text: page.title, link: '/' + page.path })) },
    ],
  }),
)
