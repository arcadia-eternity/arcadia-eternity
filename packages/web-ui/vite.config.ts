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
        ...['data', 'locales'].map(dir => {
          const baseDir = `../../${dir}`
          return {
            src: `${baseDir}/**/*.yaml`,
            dest: dir,
            rename: (name: any, extension: any, fullPath: string) => {
              const relativePath = path.relative(path.resolve(__dirname, baseDir), fullPath)
              return relativePath.replace(/\.yaml$/, '.json').replace(/\\/g, '/')
            },
            transform: (content: string) => JSON.stringify(yaml.parse(content), null, 2),
          }
        }),
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
