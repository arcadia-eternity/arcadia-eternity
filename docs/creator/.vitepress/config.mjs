import { readFileSync } from 'node:fs'
import { defineConfig } from 'vitepress'

const navigation = JSON.parse(readFileSync(new URL('../generated/navigation.json', import.meta.url), 'utf8'))

export default defineConfig({
  lang: 'zh-CN',
  title: 'Arcadia 创作者文档',
  description: 'Arcadia Eternity 内容包创作教程、战斗 SDK 与 MCP 工具参考',
  srcDir: 'generated',
  cleanUrls: true,
  themeConfig: {
    logo: '/frostling.png',
    nav: [
      { text: '创作教程', link: '/tutorials/', activeMatch: '^/(tutorials/|frost-strike|start/|make/|test/|publish/)' },
      { text: 'SDK API', link: '/sdk/', activeMatch: '^/sdk/' },
      { text: '内容格式与工具', link: '/api/', activeMatch: '^/api/' },
      { text: 'SDK ' + navigation.version, link: 'https://github.com/arcadia-eternity/arcadia-eternity' },
    ],
    sidebar: navigation.sidebar,
    outline: { label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    sidebarMenuLabel: '目录',
    returnToTopLabel: '回到顶部',
    search: {
      provider: 'local',
      options: {
        miniSearch: {
          options: {
            tokenize(text) {
              const words = new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(text)
              return Array.from(words).flatMap(word =>
                word.isWordLike ? (word.segment.match(/[\p{L}\p{N}_]+/gu) ?? []) : [],
              )
            },
          },
        },
        locales: {
          root: {
            translations: {
              button: { buttonText: '搜索文档', buttonAriaLabel: '搜索文档' },
              modal: {
                noResultsText: '没有找到相关条目',
                resetButtonTitle: '清除查询',
                backButtonTitle: '返回',
                displayDetails: '显示详情',
                footer: { selectText: '打开', navigateText: '选择', closeText: '关闭' },
              },
            },
          },
        },
      },
    },
  },
})
