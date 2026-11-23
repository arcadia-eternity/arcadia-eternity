import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

export interface CreatorPage {
  path: string
  title: string
  topic: string
  symbols: string[]
}

export const creatorPages: CreatorPage[] = [
  { path: 'frost-strike', title: '把霜击的减速延长到三回合', topic: 'tutorials', symbols: ['frost-strike'] },
  {
    path: 'api/skill-behaviors',
    title: '技能绑定 · behaviors',
    topic: 'skills',
    symbols: ['behaviors', 'behaviors[].definitionId'],
  },
  {
    path: 'api/on-hit',
    title: '命中后施加印记 · OnHit',
    topic: 'effects',
    symbols: ['EffectTrigger.OnHit', 'Pet.addMark', 'AddMarkContext'],
  },
  {
    path: 'api/mark-duration',
    title: '印记持续与刷新 · duration',
    topic: 'marks',
    symbols: ['config.duration', 'config.stackStrategy', 'config.maxStacks'],
  },
  {
    path: 'api/bind-attribute',
    title: '绑定速度 · bindAttribute',
    topic: 'effects',
    symbols: ['ops.bindAttribute', 'EffectTrigger.OnMarkCreated'],
  },
  { path: 'api/author-reference', title: '按符号查询 · author_reference', topic: 'mcp', symbols: ['author_reference'] },
  {
    path: 'api/battle-test',
    title: '测试与试战 · battle_create',
    topic: 'mcp',
    symbols: [
      'test_start',
      'job_get',
      'preview_start',
      'battle_create',
      'battle_read',
      'battle_action',
      'battle_events',
      'battle_close',
    ],
  },
]

const fromSource = import.meta.url.endsWith('.ts')
const pagesRoot = new URL(fromSource ? '../../../docs/creator/pages/' : './creator-pages/', import.meta.url)
const templateRoot = new URL(fromSource ? '../template/' : './template/', import.meta.url)
export const creatorSdkVersion: string = createRequire(import.meta.url)('../package.json').version

/** Resolve trusted page includes against the shipped frost-strike template. */
export async function readCreatorPage(page: CreatorPage) {
  let markdown = await readFile(new URL(page.path + '.md', pagesRoot), 'utf8')
  for (const match of markdown.matchAll(/^<<< ([\w./-]+)(?:#([\w-]+))?$/gm)) {
    const [, file, region] = match
    let code = await readFile(new URL(file, templateRoot), 'utf8')
    if (region) {
      const marker = '// #region ' + region + '\n'
      const start = code.indexOf(marker)
      const end = code.indexOf('// #endregion', start + marker.length)
      if (start < 0 || end < 0) throw new Error('Missing template region: ' + file + '#' + region)
      code = code.slice(start + marker.length, end)
    }
    const language = file.endsWith('.ts') ? 'typescript' : 'yaml'
    markdown = markdown.replace(match[0], () => ['```' + language, code.trimEnd(), '```'].join('\n'))
  }
  return '# ' + page.title + '\n\n' + markdown.trim() + '\n'
}
