import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const require = createRequire(import.meta.url)

test(
  'bundled preview protocol reopens scratch sessions and isolates candidates',
  {
    timeout: 30000,
    skip: process.env.ARCADIA_AUTHOR_GUI_TEST !== '1',
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'arcadia-debug-session-'))
    const modulePath = new URL('../author-preview-sessions.mjs', import.meta.url).href
    await writeFile(join(root, 'index.html'), '<!doctype html><title>Scratch session</title>')
    await writeFile(
      join(root, 'entry.mjs'),
      `
    import {app, BrowserWindow} from 'electron';
    import {createAuthorPreviewSessions} from ${JSON.stringify(modulePath)};
    app.setPath('userData', ${JSON.stringify(join(root, 'data'))});
    app.whenReady().then(async () => {
    const sessions = createAuthorPreviewSessions({directory:${JSON.stringify(root)}, development:false});
    globalThis.clearCandidates = async () => {
      for (const win of BrowserWindow.getAllWindows()) win.destroy();
      await sessions.clear();
    };
    globalThis.openCandidate = async key => {
      const win = new BrowserWindow({show:false,webPreferences:{session:sessions(key),sandbox:true,contextIsolation:true}});
      await win.loadURL('arcadia-client://app/content/preview');
      return win.id;
    };
    app.on('window-all-closed', () => {});
    await globalThis.openCandidate('first');
    });
  `,
    )
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.NODE_TEST_CONTEXT
    let app
    try {
      app = await require('playwright')._electron.launch({
        executablePath: require('electron'),
        args: [join(root, 'entry.mjs')],
        env,
        timeout: 10000,
      })
      const first = await app.firstWindow({ timeout: 10000 })
      await first.evaluate(() => localStorage.setItem('test-teams', 'scratch-only'))
      await first.close()
      const reopened = app.waitForEvent('window')
      await app.evaluate(() => globalThis.openCandidate('first'))
      const same = await reopened
      assert.equal(await same.evaluate(() => localStorage.getItem('test-teams')), 'scratch-only')
      const another = app.waitForEvent('window')
      await app.evaluate(() => globalThis.openCandidate('second'))
      assert.equal(await (await another).evaluate(() => localStorage.getItem('test-teams')), null)
      await app.evaluate(() => globalThis.clearCandidates())
      const replaced = app.waitForEvent('window')
      await app.evaluate(() => globalThis.openCandidate('first'))
      assert.equal(await (await replaced).evaluate(() => localStorage.getItem('test-teams')), null)
    } finally {
      if (app) {
        await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
        await app.close().catch(() => {})
      }
      await rm(root, { recursive: true, force: true })
    }
  },
)
