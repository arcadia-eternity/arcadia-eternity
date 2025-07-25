import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import path from 'node:path'
import yaml from 'yaml'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'

// https://vite.dev/config/
export default defineConfig({
  define: {
    // eslint-disable-next-line node/prefer-global/process
    'import.meta.env.VITE_IS_TAURI': `${process.env.VITE_IS_TAURI === 'true'}`,
    // 注入构建时间和commit hash
    'import.meta.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString()),
    'import.meta.env.VITE_COMMIT_HASH': JSON.stringify(
      process.env.GITHUB_SHA || process.env.COMMIT_HASH || String(execSync('git rev-parse --short HEAD')) || 'dev',
    ),
    // 下载源配置
    'import.meta.env.VITE_DOWNLOAD_SOURCES': JSON.stringify(process.env.VITE_DOWNLOAD_SOURCES || 'github'),
    'import.meta.env.VITE_CDN_BASE_URL': JSON.stringify(process.env.VITE_CDN_BASE_URL || ''),
    // 应用版本
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.npm_package_version || '1.0.0'),
  },
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
  optimizeDeps: {
    exclude: ['seer2-pet-animator', '@tauri-apps/api/http', '@tauri-apps/api/tauri'],
  },
  build: {
    assetsInlineLimit: (filePath, content) => {
      // 对于SWF文件，永远不内联
      if (filePath.endsWith('.swf')) {
        return false
      }
      // 对于来自seer2-pet-animator的资源，不内联
      if (filePath.includes('seer2-pet-animator')) {
        return false
      }
      // 其他文件使用默认的4KB阈值
      return content.length < 4096
    },
  },
  assetsInclude: ['**/*.swf'], // 确保SWF文件被识别为资源
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: tag => ['pet-render'].includes(tag),
        },
      },
    }),
    vueDevTools(),
    tailwindcss(),
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
        ...['data', 'resource', 'locales'].map(dir => {
          const baseDir = `../../${dir}`
          return {
            src: `${baseDir}/**/*.yaml`,
            dest: dir,
            rename: (name: any, extension: any, fullPath: string) => {
              const relativePath = path.relative(path.resolve(__dirname, baseDir), fullPath)
              return relativePath.replace(/\.yaml$/, '.json').replace(/\\/g, '/')
            },
            transform: (content: string) =>
              JSON.stringify(
                yaml.parse(content, {
                  merge: true,
                }),
                null,
              ),
          }
        }),
        // 复制脚本文件（优先复制JavaScript文件）
        {
          src: '../../scripts/**/*.{js,mjs}',
          dest: 'scripts',
          rename: (name: any, extension: any, fullPath: string) => {
            const relativePath = path.relative(path.resolve(__dirname, '../../scripts'), fullPath)
            return relativePath.replace(/\\/g, '/')
          },
        },
        // 复制 @ruffle-rs/ruffle 包的所有文件到 ruffle 文件夹
        {
          src: 'node_modules/@ruffle-rs/ruffle/*',
          dest: 'ruffle',
        },
      ],
      // 忽略找不到文件的错误，继续处理其他目标
      silent: true,
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
      // 解决 Tauri API 子路径导入问题
      '@tauri-apps/api/http': path.resolve(__dirname, './node_modules/@tauri-apps/api/http'),
      '@tauri-apps/api/tauri': path.resolve(__dirname, './node_modules/@tauri-apps/api/tauri'),
      '@tauri-apps/api': path.resolve(__dirname, './node_modules/@tauri-apps/api'),
    },
  },
})
