import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import path from 'node:path'
import yamlplugin from '@rollup/plugin-yaml'
import yaml from 'yaml'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// https://vite.dev/config/
export default defineConfig({
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8102',
        changeOrigin: true,
        ws: true,
        secure: false,
      },
    },
  },
  plugins: [
    vue(),
    vueDevTools(),
    yamlplugin(),
    AutoImport({
      eslintrc: {
        enabled: true,
      },
      dts: true,
      resolvers: [ElementPlusResolver()],
    }),
    Components({
      resolvers: [ElementPlusResolver()],
    }),
    viteStaticCopy({
      targets: [
        {
          src: '../../data/**/*.yaml',
          dest: 'data',
          rename: (name, extension, fullPath) => {
            const relativePath = path.relative(path.resolve(__dirname, '../../locales'), fullPath)

            const newPath = relativePath.replace(/\.yaml$/, '.json').replace(/\\/g, '/')

            return newPath
          },
          transform: content => {
            const data = yaml.parse(content)
            return JSON.stringify(data, null, 2)
          },
        },
        {
          src: '../../locales/**/*.yaml',
          dest: 'locales',
          rename: (name, extension, fullPath) => {
            const relativePath = path.relative(path.resolve(__dirname, '../../locales'), fullPath)

            const newPath = relativePath.replace(/\.yaml$/, '.json').replace(/\\/g, '/')

            return newPath
          },
          transform: content => {
            const data = yaml.parse(content)
            return JSON.stringify(data, null, 2)
          },
        },
      ],
      watch: {
        // 开发模式监听文件变化
        reloadPageOnChange: true,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@data': path.resolve(__dirname, '../../data'),
      '@locales': path.resolve(__dirname, '../../locales'),
    },
  },
})
