import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'vite'
const require = createRequire(import.meta.url)
const { expect } = require('playwright/test')
const base = fileURLToPath(new URL('../', import.meta.url))

test(
  'native sprite follows ancestor visibility, modal controls, and owner zoom',
  {
    skip: process.env.ARCADIA_DESKTOP_GUI_TEST !== '1',
    timeout: 60000,
  },
  async () => {
    const directory = await mkdtemp(join(base, 'swf-layout-qa-'))
    let application, server
    try {
      // Load the production adapter through Vite, without the rest of the game.
      server = await createServer({
        configFile: false,
        publicDir: false,
        optimizeDeps: { noDiscovery: true, entries: [] },
        root: join(base, '..'),
        server: { host: '127.0.0.1', port: 0 },
        appType: 'custom',
      })
      server.middlewares.use('/fixture', (_req, res) => {
        res.setHeader('Content-Type', 'text/html')
        res.end(`<!doctype html><style>body{margin:0}#ancestor{position:absolute;left:80px;top:100px;width:180px;height:160px}#sprite{width:100%;height:100%}.el-overlay{position:fixed;inset:0;background:#ddd}button{position:absolute;left:90px;top:110px;width:150px;height:100px}</style>
        <div id="ancestor" style="opacity:0"><div id="sprite"></div></div><script type="module">
        import {createSwfPlayer} from '/src/services/swf/adapter.ts';
        window.events=[];window.player=createSwfPlayer(document.querySelector('#sprite'),e=>events.push(e));
        const data=new Uint8Array([70,87,83,9,8,0,0,0]).buffer;
        window.ready=false;player.load({container:data,movie:data}).then(()=>window.ready=true);
        </script>`)
      })
      await server.listen()
      const url = `http://127.0.0.1:${server.httpServer.address().port}/fixture`
      await writeFile(
        join(directory, 'player.html'),
        `<!doctype html><body style="margin:0;background:red"><script>window.arcadiaSwfPlayer.onCommand(c=>{if(c.type==='load')requestAnimationFrame(()=>window.arcadiaSwfPlayer.emit({...c,seq:1,type:'ready',states:['待机']}))})</script>`,
      )
      await writeFile(
        join(directory, 'controller.cjs'),
        `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('arcadiaSwf',{create:x=>ipcRenderer.invoke('swf:create',x),send:x=>ipcRenderer.invoke('swf:send',x),bounds:x=>ipcRenderer.invoke('swf:bounds',x),dispose:x=>ipcRenderer.invoke('swf:dispose',x),onEvent:cb=>{const fn=(_e,x)=>cb(x);ipcRenderer.on('swf:event',fn);return ()=>ipcRenderer.removeListener('swf:event',fn)}})`,
      )
      const entry = join(directory, 'entry.mjs')
      await writeFile(
        entry,
        `import {app,BrowserWindow,ipcMain} from 'electron';import {createSwfHost} from ${JSON.stringify(pathToFileURL(join(base, 'swf-host.mjs')).href)};
      app.setPath('userData',${JSON.stringify(join(directory, 'user-data'))});app.whenReady().then(async()=>{
      globalThis.owner=new BrowserWindow({width:800,height:600,show:true,webPreferences:{preload:${JSON.stringify(join(directory, 'controller.cjs'))},sandbox:true,contextIsolation:true,nodeIntegration:false}});
      globalThis.host=createSwfHost({isTrustedController:e=>e.sender===owner.webContents,playerPath:${JSON.stringify(join(directory, 'player.html'))},runtimeDirectory:${JSON.stringify(join(base, '../node_modules/@ruffle-rs/ruffle'))}});host.registerIpc(ipcMain);await owner.loadURL(${JSON.stringify(url)});});`,
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      application = await require('playwright')._electron.launch({
        executablePath: require('electron'),
        args: [entry],
        env,
        timeout: 15000,
      })
      const page = await application.firstWindow()
      await page.waitForFunction(() => window.ready === true)
      const inspect = () => application.evaluate(() => host.inspect())
      assert.equal((await inspect())[0].visible, false, 'hidden ancestors still allow player readiness')
      await page.evaluate(() => (document.querySelector('#ancestor').style.opacity = '1'))
      await expect.poll(async () => (await inspect())[0].visible).toBe(true)
      const original = (await inspect())[0].bounds
      assert.deepEqual(original, { x: 80, y: 100, width: 180, height: 160 })
      // A normal overlapping battle HUD must not suppress the sprite.
      await page.evaluate(() => {
        const hud = document.createElement('div')
        hud.id = 'hud'
        hud.style = 'position:fixed;inset:0'
        document.body.append(hud)
      })
      await page.waitForTimeout(100)
      assert.equal((await inspect())[0].visible, true)
      await page.evaluate(() => {
        document.querySelector('#hud').remove()
        const modal = document.createElement('div')
        modal.className = 'el-overlay'
        modal.innerHTML = '<section role="dialog" aria-modal="true"><button id="close">Close</button></section>'
        modal.querySelector('button').onclick = () => {
          window.clicked = true
          modal.remove()
        }
        document.body.append(modal)
      })
      await expect.poll(async () => (await inspect())[0].visible).toBe(false)
      // Deliver a real owner-window mouse event at the covered sprite coordinates.
      await application.evaluate(() => {
        owner.webContents.sendInputEvent({ type: 'mouseDown', x: 140, y: 150, button: 'left', clickCount: 1 })
        owner.webContents.sendInputEvent({ type: 'mouseUp', x: 140, y: 150, button: 'left', clickCount: 1 })
      })
      await page.waitForFunction(() => window.clicked === true)
      await expect.poll(async () => (await inspect())[0].visible).toBe(true)
      await page.evaluate(() => {
        const backdrop = document.createElement('div')
        backdrop.id = 'result'
        backdrop.style = 'position:fixed;inset:0'
        backdrop.innerHTML = '<div class="battle-result" style="position:absolute;left:400px">Result</div>'
        document.body.append(backdrop)
      })
      await expect.poll(async () => (await inspect())[0].visible).toBe(false)
      await page.evaluate(() => document.querySelector('#result').remove())
      for (const zoom of [1.25, 0.8]) {
        await application.evaluate((_electron, zoom) => owner.webContents.setZoomFactor(zoom), zoom)
        await expect
          .poll(async () => (await inspect())[0].bounds)
          .toEqual({
            x: Math.round(80 * zoom),
            y: Math.round(100 * zoom),
            width: Math.round(180 * zoom),
            height: Math.round(160 * zoom),
          })
        assert.equal((await inspect())[0].zoomFactor, zoom)
        assert.equal((await inspect())[0].visible, true)
      }
      await page.evaluate(() => window.player.dispose())
      await expect.poll(async () => (await inspect()).length).toBe(0)
    } finally {
      if (application) await application.close()
      if (server) await server.close()
      await rm(directory, { recursive: true, force: true })
    }
  },
)
