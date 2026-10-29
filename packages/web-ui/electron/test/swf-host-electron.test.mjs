import { createServer } from 'node:http'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const require = createRequire(import.meta.url)
const base = fileURLToPath(new URL('../', import.meta.url))
test(
  'real Electron isolated player blocks privileges and network and recovers outside renderer',
  { skip: process.env.ARCADIA_DESKTOP_GUI_TEST !== '1', timeout: 60000 },
  async () => {
    const directory = await mkdtemp(join(base, 'swf-qa-'))
    let requests = 0
    const server = createServer((_request, response) => {
      requests++
      response.end('unexpected')
    })
    server.on('upgrade', (_request, socket) => {
      requests++
      socket.destroy()
    })
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const networkUrl = `http://127.0.0.1:${server.address().port}/`
    let application
    try {
      const pagePath = join(directory, 'player.html')
      await writeFile(
        pagePath,
        `<!doctype html><html><body style="background:transparent"><script>
    window.arcadiaSwfPlayer.onCommand(c => window.arcadiaSwfPlayer.emit({...c,seq:1,type:'ready',states:['待机']}));
    </script></body></html>`,
      )
      await writeFile(
        join(directory, 'controller.cjs'),
        `const {contextBridge,ipcRenderer}=require('electron'); contextBridge.exposeInMainWorld('qa',{create:x=>ipcRenderer.invoke('swf:create',x),send:x=>ipcRenderer.invoke('swf:send',x),bounds:x=>ipcRenderer.invoke('swf:bounds',x),dispose:x=>ipcRenderer.invoke('swf:dispose',x),onEvent:callback=>ipcRenderer.on('swf:event',(_e,x)=>callback(x))});`,
      )
      const entry = join(directory, 'entry.mjs')
      await writeFile(
        entry,
        `import {app,BrowserWindow,ipcMain} from 'electron';
      import {createSwfHost} from ${JSON.stringify(pathToFileURL(join(base, 'swf-host.mjs')).href)};
      app.setPath('userData', ${JSON.stringify(join(directory, 'user-data'))}); app.whenReady().then(async()=>{
      globalThis.owner=new BrowserWindow({show:false,webPreferences:{preload:${JSON.stringify(join(directory, 'controller.cjs'))},sandbox:true,contextIsolation:true,nodeIntegration:false}});
      globalThis.host=createSwfHost({isTrustedController:e=>e.sender===owner.webContents && e.senderFrame===owner.webContents.mainFrame,playerPath:${JSON.stringify(pagePath)},runtimeDirectory:${JSON.stringify(join(base, '../node_modules/@ruffle-rs/ruffle'))},watchdogMs:2500}); host.registerIpc(ipcMain);
      await owner.loadURL('data:text/html,<h1>Trusted controller</h1>'); });`,
      )
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      application = await require('playwright')._electron.launch({
        executablePath: require('electron'),
        args: [entry],
        env,
        timeout: 15000,
      })
      const owner = await application.firstWindow()
      const baselineListeners = await application.evaluate(() => owner.listenerCount('closed'))
      const created = await owner.evaluate(() => window.qa.create({ instance: 'pet-1' }))
      assert.ok(created.processId > 0)
      assert.notEqual(created.processId, created.ownerProcessId)
      const inspection = await application.evaluate(() => host.inspect())
      assert.equal(inspection[0].partition, null)
      assert.equal(inspection[0].sandboxed, true)
      await owner.evaluate(() =>
        window.qa.bounds({ instance: 'pet-1', x: 20, y: 30, width: 120, height: 140, visible: true }),
      )
      assert.deepEqual((await application.evaluate(() => host.inspect()))[0].bounds, {
        x: 20,
        y: 30,
        width: 120,
        height: 140,
      })
      const security = await application.evaluate(async ({ webContents }, networkUrl) => {
        const view = webContents.getAllWebContents().find(w => w.getURL().startsWith('arcadia-swf:'))
        return view.executeJavaScript(
          `(async()=>({node:typeof process, desktop:typeof window.arcadiaDesktop, remote:typeof window.arcadiaRemotePlay, denied:await Promise.all(['https://example.com/','${networkUrl}','file:///etc/passwd','arcadia-swf://player/../secret'].map(url=>fetch(url).then(()=>false,()=>true))), websocketDenied:await new Promise(resolve=>{const ws=new WebSocket('${networkUrl}'.replace('http:','ws:'));ws.onopen=()=>resolve(false);ws.onerror=()=>resolve(true);setTimeout(()=>resolve(false),2000)}),deviceDenied:await navigator.mediaDevices.getUserMedia({audio:true}).then(()=>false,()=>true),popup:window.open('https://example.com')===null}))()`,
        )
      }, networkUrl)
      assert.equal(requests, 0)
      assert.equal(security.websocketDenied, true)
      assert.equal(security.deviceDenied, true)
      assert.equal(security.node, 'undefined')
      assert.equal(security.desktop, 'undefined')
      assert.equal(security.remote, 'undefined')
      assert.ok(security.denied.every(Boolean))
      assert.equal(security.popup, true)
      const forged = await application.evaluate(async ({ webContents }) => {
        const view = webContents.getAllWebContents().find(w => w.getURL().startsWith('arcadia-swf:'))
        return view.executeJavaScript(`typeof window.arcadiaSwf`)
      })
      assert.equal(forged, 'undefined')
      await assert.rejects(
        owner.evaluate(() =>
          window.qa.send({ v: 1, instance: 'pet-1', task: 1, seq: 1, type: 'install', url: 'https://example.com' }),
        ),
      )
      await owner.evaluate(async () => {
        window.events = []
        window.qa.onEvent(x => window.events.push(x))
        const bytes = new Uint8Array([70, 87, 83, 9, 8, 0, 0, 0]).buffer
        for (let task = 1; task <= 2; task++) {
          await window.qa.send({
            v: 1,
            instance: 'pet-1',
            task,
            seq: task,
            type: 'load',
            bytes: { container: bytes, movie: bytes },
          })
          await new Promise(resolve => setTimeout(resolve, 100))
        }
      })
      assert.deepEqual(
        await owner.evaluate(() => window.events.filter(x => x.type === 'ready').map(x => [x.task, x.seq])),
        [
          [1, 1],
          [2, 1],
        ],
      )
      await application.evaluate(async ({ webContents }) => {
        const view = webContents.getAllWebContents().find(w => w.getURL().startsWith('arcadia-swf:'))
        await view
          .executeJavaScript(
            `for(let seq=2;seq<100;seq++)window.arcadiaSwfPlayer.emit({v:1,instance:'pet-1',task:2,seq,type:'error',message:'fixture flood'})`,
          )
          .catch(() => {})
      })
      await new Promise(resolve => setTimeout(resolve, 200))
      assert.equal((await application.evaluate(() => host.inspect())).length, 0)
      await owner.evaluate(() => window.qa.create({ instance: 'pet-1' }))
      await application.evaluate(({ webContents }) => {
        const view = webContents.getAllWebContents().find(w => w.getURL().startsWith('arcadia-swf:'))
        void view.executeJavaScript('while(true){}').catch(() => {})
      })
      await assert.doesNotReject(owner.evaluate(() => document.body.textContent))
      await new Promise(resolve => setTimeout(resolve, 4000))
      assert.equal((await application.evaluate(() => host.inspect())).length, 0)
      const recovered = await owner.evaluate(() => window.qa.create({ instance: 'pet-2' }))
      assert.ok(recovered.processId > 0)
      await owner.evaluate(() => window.qa.dispose({ instance: 'pet-2' }))
      assert.equal(await application.evaluate(() => owner.listenerCount('closed')), baselineListeners)
      console.log(JSON.stringify({ created, security, inspection, recovered }))
    } finally {
      if (application) await application.close()
      await new Promise(resolve => server.close(resolve))
      await rm(directory, { recursive: true, force: true })
    }
  },
)
