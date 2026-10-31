import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
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
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

// Auto-imported styles are injected after Vite's initial dependency scan.
const elementPlusComponents = new URL('./components/', import.meta.resolve('element-plus'))
const elementPlusStyles = readdirSync(elementPlusComponents, { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(new URL(`${entry.name}/style/css.mjs`, elementPlusComponents)))
  .map(entry => `element-plus/es/components/${entry.name}/style/css`)

function buildCommitHash(): string {
  const configured = process.env.GITHUB_SHA || process.env.COMMIT_HASH
  if (configured) return configured
  try {
    return String(execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })).trim()
  } catch {
    // Source archives and Docker contexts intentionally omit Git metadata.
    return 'unknown'
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const backendOrigin = process.env.VITE_BACKEND_ORIGIN ?? loadEnv(mode, process.cwd()).VITE_BACKEND_ORIGIN ?? '/'
  if (backendOrigin !== '/') {
    const origin = new URL(backendOrigin)
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== backendOrigin)
      throw new Error('VITE_BACKEND_ORIGIN must be / or an exact HTTP(S) origin')
  }
  const deploymentConfig = JSON.stringify({ schemaVersion: 1, backendOrigin })
  return {
    base: process.env.VITE_STATIC_MODE === '1' ? './' : '/',
    define: {
      // 注入构建时间和commit hash
      'import.meta.env.VITE_BUILD_TIME': JSON.stringify(new Date().toISOString()),
      'import.meta.env.VITE_COMMIT_HASH': JSON.stringify(buildCommitHash()),
      // 下载源配置
      'import.meta.env.VITE_DOWNLOAD_SOURCES': JSON.stringify(process.env.VITE_DOWNLOAD_SOURCES || 'github'),
      'import.meta.env.VITE_CDN_BASE_URL': JSON.stringify(process.env.VITE_CDN_BASE_URL || ''),
      // 应用版本
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.npm_package_version || '1.0.0'),
    },
    server: {
      watch: {
        ignored: ['**/packs/**'],
      },
      proxy: {
        '/health': { target: 'http://localhost:8102' },
        '/socket.io': { target: 'http://localhost:8102', ws: true },
        '/api': {
          target: 'http://localhost:8102',
          changeOrigin: true,
          ws: true,
          secure: false,
        },
      },
    },
    optimizeDeps: {
      include: ['element-plus/es', ...elementPlusStyles],
      exclude: ['seer2-pet-animator'],
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
      {
        name: 'arcadia-deployment-config',
        configureServer(server) {
          server.middlewares.use('/arcadia-client.json', (_req, res) => {
            res.setHeader('Content-Type', 'application/json')
            res.setHeader('Cache-Control', 'no-store')
            res.end(deploymentConfig)
          })
        },
        closeBundle() {
          const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version
          writeFileSync(new URL('./dist/arcadia-client.json', import.meta.url), deploymentConfig)
          writeFileSync(
            new URL('./dist/arcadia-web-manifest.json', import.meta.url),
            JSON.stringify({ schemaVersion: 1, protocolVersion: 1, version }),
          )
        },
      },
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
          ...[
            { srcDir: '../../packs/base/data', outDir: 'data' },
            { srcDir: '../../resource', outDir: 'resource' },
            { srcDir: '../../packs/base/locales', outDir: 'locales' },
          ].map(({ srcDir, outDir }) => {
            const baseDir = srcDir
            return {
              src: `${baseDir}/**/*.yaml`,
              dest: outDir,
              rename: (fileName: string, fileExtension: string, fullPath: string) => {
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
          {
            src: '../../packs/base/pack.json',
            dest: '.',
          },
          {
            src: '../../packs/base/pack-lock.yaml',
            dest: '.',
          },
          {
            src: '../../packs/base/dist/presentation.json',
            dest: 'dist',
          },
          // 复制脚本文件（优先复制JavaScript文件）
          {
            src: '../../scripts/**/*.{js,mjs}',
            dest: 'scripts',
            rename: (fileName: string, fileExtension: string, fullPath: string) => {
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
          reloadPageOnChange: false,
        },
      }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@data': path.resolve(__dirname, '../../packs/base/data'),
        '@locales': path.resolve(__dirname, '../../packs/base/locales'),
      },
    },
  }
})
