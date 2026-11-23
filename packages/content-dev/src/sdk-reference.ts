import { readFile } from 'node:fs/promises'

export const sdkGroups = {
  triggers: '触发器',
  objects: '战斗对象与上下文',
  functions: '创作函数与装饰器',
  values: 'SDK 对象与常量',
  enums: '枚举',
  types: '类型声明',
  host: '宿主专用函数',
} as const

export interface SdkSymbol {
  symbol: string
  source?: { path: string; line: number }
  dispatches?: { path: string; line: number }[]
  group: keyof typeof sdkGroups
  kind: string
  signature: string
  description: string
  owner?: string
  context?: string
  parent?: string
  fields?: string[]
  methods?: { receiver: string; symbol: string }[]
  variants?: string[]
  example?: string
  exampleSource?: string
  related: string[]
}

export function sdkPath(item: SdkSymbol) {
  if (item.group === 'triggers') return '/sdk/triggers/' + item.symbol.split('.')[1]
  const base = '/sdk/' + item.group + '/' + (item.owner ?? item.symbol)
  if (!item.owner) return base
  const name = item.symbol.slice(item.owner.length + 1)
  if (item.owner === 'ops') return base + '/' + name
  if (item.owner === 'BattleMessageData' || item.owner === 'Events') {
    const [event, ...field] = name.split('.')
    return base + '/' + event + (field.length ? '#member-' + field.join('.') : '')
  }
  return base + '#member-' + name
}

function code(text: string) {
  return ['```typescript', text, '```'].join('\n')
}

export function sdkCatalog(records: SdkSymbol[]) {
  const byName = new Map(records.map(item => [item.symbol, item]))
  const children = new Map<string, SdkSymbol[]>()
  for (const item of records) {
    if (!item.owner) continue
    const siblings = children.get(item.owner) ?? []
    siblings.push(item)
    children.set(item.owner, siblings)
  }
  const link = (name: string) => {
    const item = byName.get(name)
    return item ? '[`' + name + '`](' + sdkPath(item) + ')' : '`' + name + '`'
  }
  function body(item: SdkSymbol) {
    const lines = [item.kind, '', code(item.context ?? item.signature)]
    if (item.description)
      lines.push(
        '',
        item.description.replace(/[<>{}]/g, c => '&#' + c.charCodeAt(0) + ';'),
      )
    if (item.group === 'host') lines.push('', '此函数供宿主进程使用。')
    if (item.group === 'types' && !item.owner)
      lines.push('', 'TypeScript 声明。具体战斗实例可访问的成员见[战斗对象与上下文](/sdk/objects/)。')
    if (item.parent) {
      lines.push(
        '',
        '## 回调上下文',
        '',
        '回调接收 ' + link('EffectContext') + '。本次事件的 `ctx.parent` 类型为 ' + link(item.parent) + '。',
      )
      if (item.variants?.length)
        lines.push('', '先用 `instanceof` 判断父对象类型，再访问具体事件：' + item.variants.map(link).join('、') + '。')
      if (item.fields?.length)
        lines.push(
          '',
          '| 父上下文字段 | 类型 |',
          '| --- | --- |',
          ...item.fields.map(
            name => '| ' + link(name) + ' | `' + byName.get(name)!.signature.replaceAll('|', '\\|') + '` |',
          ),
        )
      if (item.methods?.length) {
        const receivers = Map.groupBy(item.methods, method => method.receiver)
        lines.push(
          '',
          '## 可调用的方法',
          '',
          '可选字段需先判空。伤害结算期间，修改操作还受当前伤害提案和触发阶段约束。',
          '',
          '| 调用对象 | 方法签名 |',
          '| --- | --- |',
        )
        for (const [receiver, methods] of receivers)
          lines.push('| `' + receiver + '` | ' + methods.map(method => link(method.symbol)).join('、') + ' |')
      }
    }
    if (item.example) {
      lines.push('', '## ' + (item.exampleSource ? '霜击模板示例' : '读取事件示例'), '', code(item.example))
      if (item.exampleSource)
        lines.push('', '模板文件 `' + item.exampleSource + '`。参见[霜击创作教程](/frost-strike)。')
    }
    if (item.dispatches?.length)
      lines.push('', '派发位置　' + item.dispatches.map(site => '`' + site.path + ':' + site.line + '`').join('、'))
    if (item.related.length) lines.push('', '相关符号　' + item.related.map(link).join('、'))
    return lines.join('\n')
  }
  function markdown(item: SdkSymbol) {
    return '# ' + item.symbol + '\n\n' + body(item) + '\n'
  }
  return { records, byName, children, link, body, markdown }
}

async function loadRecords(): Promise<SdkSymbol[]> {
  if (import.meta.url.endsWith('.ts')) {
    const { generateSdkReference } = await import(new URL('../generate-sdk-reference.mjs', import.meta.url).href)
    const ts = (await import('typescript')).default
    return generateSdkReference(ts, import.meta.filename)
  }
  return JSON.parse(await readFile(new URL('./sdk-reference.json', import.meta.url), 'utf8'))
}

let installed: Promise<ReturnType<typeof sdkCatalog>> | undefined
export function installedSdkCatalog() {
  return (installed ??= loadRecords().then(sdkCatalog))
}
