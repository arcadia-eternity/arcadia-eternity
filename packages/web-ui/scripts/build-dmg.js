#!/usr/bin/env node

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * 构建 DMG 安装包
 */
async function buildDMG() {
  console.log('🚀 开始构建 DMG 安装包...')

  try {
    // 检查是否在 macOS 上
    if (process.platform !== 'darwin') {
      throw new Error('DMG 只能在 macOS 上构建')
    }

    // 1. 构建 Tauri 应用
    console.log('📦 构建应用...')
    execSync('pnpm tauri build', {
      stdio: 'inherit',
      cwd: process.cwd(),
      env: { ...process.env, CI: 'true' },
    })

    // 2. 查找生成的 DMG 文件
    const bundleDir = path.join(process.cwd(), 'src-tauri', 'target', 'release', 'bundle', 'dmg')

    if (!fs.existsSync(bundleDir)) {
      throw new Error(`找不到 DMG 目录: ${bundleDir}`)
    }

    const dmgFiles = fs.readdirSync(bundleDir).filter(file => file.endsWith('.dmg'))

    if (dmgFiles.length === 0) {
      throw new Error('没有找到生成的 DMG 文件')
    }

    // 3. 显示结果
    console.log('✅ DMG 安装包构建完成!')

    dmgFiles.forEach(dmgFile => {
      const dmgPath = path.join(bundleDir, dmgFile)
      const stats = fs.statSync(dmgPath)
      const sizeInMB = (stats.size / (1024 * 1024)).toFixed(2)

      console.log(`📁 文件位置: ${dmgPath}`)
      console.log(`📏 文件大小: ${sizeInMB} MB`)
    })

    console.log('')
    console.log('🎉 使用说明:')
    console.log('1. 双击 DMG 文件打开')
    console.log('2. 将应用拖拽到 Applications 文件夹')
    console.log('3. 从 Launchpad 或 Applications 文件夹启动应用')
  } catch (error) {
    console.error('❌ 构建失败:', error.message)
    process.exit(1)
  }
}

// 运行构建
buildDMG()
