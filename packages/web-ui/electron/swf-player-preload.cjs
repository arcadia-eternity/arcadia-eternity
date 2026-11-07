const { contextBridge, ipcRenderer } = require('electron')
// This preload belongs only to the untrusted player. Never import the desktop preload.
let attached = false,
  windowStart = 0,
  count = 0
contextBridge.exposeInMainWorld('arcadiaSwfPlayer', {
  onCommand(callback) {
    if (attached || typeof callback !== 'function') return () => {}
    attached = true
    const listener = (_event, command) => callback(command)
    ipcRenderer.on('swf:player-command', listener)
    return () => {
      ipcRenderer.removeListener('swf:player-command', listener)
      attached = false
    }
  },
  emit(event) {
    // Copy bounded primitives before crossing native IPC; never serialize page objects/bytes.
    const now = Date.now()
    if (now - windowStart >= 1000) {
      windowStart = now
      count = 0
    }
    if (++count > 120 || !event || typeof event !== 'object') return
    const { v, instance, task, seq, type } = event
    if (
      v !== 1 ||
      typeof instance !== 'string' ||
      instance.length > 80 ||
      !Number.isSafeInteger(task) ||
      !Number.isSafeInteger(seq)
    )
      return
    const result = { v, instance, task, seq, type }
    if (
      type === 'ready' &&
      Array.isArray(event.states) &&
      event.states.length <= 15 &&
      event.states.every(s => typeof s === 'string' && s.length <= 20)
    )
      result.states = event.states.slice()
    else if (type === 'error' && typeof event.message === 'string' && event.message.length <= 240)
      result.message = event.message
    else if (
      (type === 'hit' || type === 'complete') &&
      typeof event.state === 'string' &&
      event.state.length <= 20 &&
      (event.duration === undefined || Number.isFinite(event.duration))
    ) {
      result.state = event.state
      if (event.duration !== undefined) result.duration = event.duration
    } else return
    ipcRenderer.send('swf:player-event', result)
  },
})
setInterval(() => ipcRenderer.send('swf:heartbeat'), 1000)
