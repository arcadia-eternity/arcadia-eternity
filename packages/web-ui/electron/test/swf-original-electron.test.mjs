import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url),
  base = fileURLToPath(new URL('../', import.meta.url))
test(
  'original container loads approved child SWF bytes and returns cosmetic states/hit/completion',
  { skip: process.env.ARCADIA_DESKTOP_GUI_TEST !== '1' || !process.env.ARCADIA_SWF_MOVIE, timeout: 60000 },
  async () => {
    const directory = await mkdtemp(join(base, 'swf-original-qa-'))
    let application
    try {
      const playerPath = process.env.ARCADIA_SWF_PLAYER_PATH || join(base, '../public/swf-player.html')
      const runtimeDirectory = join(base, '../node_modules/@ruffle-rs/ruffle')
      const container = Array.from(
          await readFile(join(base, '../node_modules/seer2-pet-animator/dist/assets/0a23df2694577cca.swf')),
        ),
        movie = Array.from(await readFile(process.env.ARCADIA_SWF_MOVIE))
      await writeFile(
        join(directory, 'controller.cjs'),
        `const{contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('qa',{create:x=>ipcRenderer.invoke('swf:create',x),send:x=>ipcRenderer.invoke('swf:send',x),bounds:x=>ipcRenderer.invoke('swf:bounds',x),onEvent:cb=>ipcRenderer.on('swf:event',(_e,x)=>cb(x))})`,
      )
      await writeFile(
        join(directory, 'entry.mjs'),
        `import{app,BrowserWindow,ipcMain}from'electron';import{createSwfHost}from${JSON.stringify(pathToFileURL(join(base, 'swf-host.mjs')).href)};app.setPath('userData',${JSON.stringify(join(directory, 'data'))});app.whenReady().then(async()=>{globalThis.owner=new BrowserWindow({width:1100,height:700,show:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,preload:${JSON.stringify(join(directory, 'controller.cjs'))}}});globalThis.host=createSwfHost({isTrustedController:e=>e.sender===owner.webContents&&e.senderFrame===owner.webContents.mainFrame,playerPath:${JSON.stringify(playerPath)},runtimeDirectory:${JSON.stringify(runtimeDirectory)}});host.registerIpc(ipcMain);app.on('before-quit',()=>host.dispose());await owner.loadURL('data:text/html,<body style="background:rgb(0,128,0)">Original media fixture</body>')})`,
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      application = await require('playwright')._electron.launch({
        executablePath: require('electron'),
        args: [join(directory, 'entry.mjs')],
        env,
        timeout: 15000,
      })
      const owner = await application.firstWindow()
      await owner.evaluate(
        async ({ container, movie }) => {
          window.events = []
          window.qa.onEvent(x => window.events.push(x))
          await window.qa.create({ instance: 'original-1' })
          await window.qa.bounds({ instance: 'original-1', x: 0, y: 0, width: 1000, height: 600, visible: true })
          await window.qa.send({
            v: 1,
            instance: 'original-1',
            task: 1,
            seq: 1,
            type: 'load',
            runtime: { 'ruffle.js': new TextEncoder().encode('throw new Error(\"untrusted runtime\")').buffer },
            bytes: { container: new Uint8Array(container).buffer, movie: new Uint8Array(movie).buffer },
          })
        },
        { container, movie },
      )
      await owner.waitForFunction(() => window.events.some(x => x.type === 'ready' || x.type === 'error'), {
        timeout: 20000,
      })
      const ready = await owner.evaluate(() => window.events)
      assert.ok(
        ready.some(x => x.type === 'ready'),
        JSON.stringify(ready),
      )
      await owner.evaluate(() =>
        window.qa.send({ v: 1, instance: 'original-1', task: 1, seq: 2, type: 'play', state: '物理攻击' }),
      )
      await owner.waitForFunction(() => window.events.some(x => x.type === 'hit'), { timeout: 10000 })
      await owner.waitForFunction(() => window.events.some(x => x.type === 'complete'), { timeout: 10000 })
      await owner.evaluate(() =>
        window.qa.send({ v: 1, instance: 'original-1', task: 1, seq: 3, type: 'play', state: '被打' }),
      )
      await owner.waitForFunction(() => window.events.some(x => x.type === 'complete' && x.state === '被打'), {
        timeout: 10000,
      })
      const pixels = await application.evaluate(async ({ webContents }) => {
        const wc = webContents.getAllWebContents().find(w => w.getURL().startsWith('arcadia-swf:'))
        const image = await wc.capturePage(),
          bitmap = image.toBitmap()
        let transparent = 0,
          visible = 0
        for (let i = 3; i < bitmap.length; i += 4) {
          if (bitmap[i] < 255) transparent++
          if (bitmap[i] > 0) visible++
        }
        return { width: image.getSize().width, height: image.getSize().height, transparent, visible }
      })
      assert.ok(pixels.transparent > 0)
      assert.ok(pixels.visible > 0)
      await owner.evaluate(
        async ({ container, movie }) => {
          await window.qa.create({ instance: 'original-2' })
          await window.qa.bounds({ instance: 'original-2', x: 500, y: 0, width: 500, height: 600, visible: true })
          await window.qa.send({
            v: 1,
            instance: 'original-2',
            task: 1,
            seq: 1,
            type: 'load',
            bytes: { container: new Uint8Array(container).buffer, movie: new Uint8Array(movie).buffer },
          })
        },
        { container, movie },
      )
      await owner.waitForFunction(
        () => window.events.some(x => x.instance === 'original-2' && x.type === 'ready'),
        null,
        { timeout: 20000 },
      )
      const metrics = await application.evaluate(({ app }) =>
        app
          .getAppMetrics()
          .filter(x => host.inspect().some(r => r.processId === x.pid))
          .map(x => ({ pid: x.pid, cpu: x.cpu, memory: x.memory })),
      )
      assert.equal((await application.evaluate(() => host.inspect())).length, 2)
      console.log(
        JSON.stringify({
          pixels,
          metrics,
          processes: await application.evaluate(() => host.inspect()),
          events: await owner.evaluate(() => window.events),
        }),
      )
    } finally {
      if (application) await application.close()
      await rm(directory, { recursive: true, force: true })
    }
  },
)
