import { app, BrowserWindow, ipcMain, shell } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { validateSkill } from '@/schema/skill'
import { validateSpecies } from '@/schema/species'
import { validateMark } from '@/schema/mark'
const isDev = process.env.NODE_ENV === 'development'

async function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.ts'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (isDev) {
    await win.loadURL('http://localhost:5173/#/editor')
    win.webContents.openDevTools()
  } else {
    await win.loadFile(path.join(__dirname, '../../dist/index.html'))
  }

  // 打开外部链接用默认浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

// 数据验证映射
const validators = {
  mark: validateMark,
  skill: validateSkill,
  species: validateSpecies,
}

// 带校验的数据写入
ipcMain.handle('write-data', async (_, type: keyof typeof validators, content: string) => {
  const targetPath = path.join(__dirname, '../../src/data', `${type}.json`)
  const backupPath = `${targetPath}.bak-${Date.now()}`

  // 校验数据结构
  const data = JSON.parse(content)
  const result = validators[type].Parse(data)
  if (!result.success) {
    throw new Error(`数据校验失败: ${result.error.message}`)
  }

  // 备份并写入
  await fs.copyFile(targetPath, backupPath)
  await fs.writeFile(targetPath, JSON.stringify(result.data, null, 2))
  return { success: true }
})

// 读取原始数据
ipcMain.handle('read-data', async (_, type: 'mark' | 'skill' | 'species') => {
  const dataPath = path.join(__dirname, '../../src/data', `${type}.json`)
  return fs.readFile(dataPath, 'utf-8')
})

app.whenReady().then(createWindow)
