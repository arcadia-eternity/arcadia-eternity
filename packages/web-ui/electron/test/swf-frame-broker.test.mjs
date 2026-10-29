import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createFrameBroker, validFrameSize, nonzeroBounds } from '../swf-frame-broker.mjs'
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
function image(width = 80, height = 60, identity = 1) {
  return {
    getSize: () => ({ width, height }),
    crop: rect => ({ toPNG: () => Buffer.from([identity, rect.width, rect.height]) }),
  }
}
test('frame size limits bound allocation and encoded dimensions', () => {
  assert.equal(validFrameSize(1600, 900), true)
  for (const pair of [
    [2049, 1],
    [2048, 2048],
    [0, 80],
    [80.5, 60],
    [Infinity, 1],
  ])
    assert.equal(validFrameSize(...pair), false)
})
test('broker gates readiness, sends full initial frame, coalesces latest dirty union behind one ACK', async () => {
  const frames = [],
    failures = []
  const broker = createFrameBroker({ instance: 'pet', send: f => frames.push(f), fail: m => failures.push(m) })
  broker.resize(80, 60)
  broker.reset(1)
  broker.paint({ x: 1, y: 2, width: 3, height: 4 }, image())
  assert.equal(frames.length, 0)
  broker.ready()
  broker.paint({ x: 1, y: 2, width: 3, height: 4 }, image())
  assert.deepEqual(
    { ...frames[0], png: null },
    {
      v: 1,
      instance: 'pet',
      task: 1,
      frame: 1,
      canvasWidth: 80,
      canvasHeight: 60,
      x: 0,
      y: 0,
      width: 80,
      height: 60,
      png: null,
    },
  )
  broker.paint({ x: 2, y: 3, width: 4, height: 5 }, image(80, 60, 2))
  broker.paint({ x: 20, y: 30, width: 4, height: 5 }, image(80, 60, 3))
  await wait(50)
  broker.ack({ instance: 'attacker', task: 1, frame: 1 })
  broker.ack({ instance: 'pet', task: 2, frame: 1 })
  assert.equal(frames.length, 1)
  assert.equal(broker.inspect().pending, 1)
  assert.equal(broker.inspect().queued, 1)
  broker.ack({ instance: 'pet', task: 1, frame: 1 })
  assert.equal(frames.length, 2)
  assert.equal(frames[1].png[0], 3)
  assert.deepEqual([frames[1].x, frames[1].y, frames[1].width, frames[1].height], [2, 3, 22, 32])
  broker.reset(2)
  broker.ack({ instance: 'pet', task: 1, frame: 2 })
  broker.paint({ x: 0, y: 0, width: 80, height: 60 }, image())
  assert.equal(frames.length, 2)
  broker.ready()
  broker.paint({ x: 0, y: 0, width: 80, height: 60 }, image())
  await wait(50)
  assert.equal(frames[2].task, 2)
  assert.equal(frames[2].width, 80)
  broker.dispose()
  broker.ack({ instance: 'pet', task: 2, frame: 3 })
  broker.paint({ x: 0, y: 0, width: 80, height: 60 }, image())
  assert.equal(frames.length, 3)
  assert.deepEqual(failures, [])
})

test('transparent trim is channel-order independent and falls back on unexpected buffers', () => {
  const bitmap = Buffer.alloc(6 * 5 * 4)
  bitmap[(1 * 6 + 2) * 4] = 255
  bitmap[(3 * 6 + 4) * 4 + 3] = 255
  assert.deepEqual(nonzeroBounds(bitmap, 6, 5), { x: 2, y: 1, width: 3, height: 3 })
  assert.equal(nonzeroBounds(Buffer.alloc(6 * 5 * 4), 6, 5), undefined)
  assert.deepEqual(nonzeroBounds(Buffer.alloc(7), 6, 5), { x: 0, y: 0, width: 6, height: 5 })
})

test('trim clears last displayed position and resize preserves one in-flight ACK fence', async () => {
  const frames = []
  const broker = createFrameBroker({ instance: 'pet', send: f => frames.push(f), fail: assert.fail })
  const painted = (width, height, x, y) => {
    const bitmap = Buffer.alloc(width * height * 4)
    bitmap[(y * width + x) * 4 + 3] = 255
    return { ...image(width, height), toBitmap: () => bitmap }
  }
  broker.resize(80, 60)
  broker.reset(1)
  broker.ready()
  const dirty = { x: 0, y: 0, width: 80, height: 60 }
  broker.paint(dirty, painted(80, 60, 2, 3))
  broker.paint(dirty, painted(80, 60, 10, 10)) // never displayed
  broker.paint(dirty, painted(80, 60, 50, 40))
  await wait(50)
  broker.ack({ instance: 'pet', task: 1, frame: 1 })
  assert.deepEqual([frames[1].x, frames[1].y, frames[1].width, frames[1].height], [2, 3, 49, 38])
  broker.resize(100, 80)
  broker.paint({ x: 0, y: 0, width: 100, height: 80 }, painted(100, 80, 70, 50))
  await wait(50)
  assert.equal(frames.length, 2)
  broker.ack({ instance: 'pet', task: 1, frame: 2 })
  assert.deepEqual([frames[2].x, frames[2].y, frames[2].width, frames[2].height], [0, 0, 100, 80])
  broker.dispose()
})

test('a missing frame ACK fails once after five seconds and cleanup cancels the deadline', () => {
  const scheduled = new Map(),
    frames = [],
    failures = []
  let id = 0
  const broker = createFrameBroker({
    instance: 'pet',
    send: f => frames.push(f),
    fail: m => failures.push(m),
    setTimer: (callback, delay) => {
      scheduled.set(++id, { callback, delay })
      return id
    },
    clearTimer: timer => scheduled.delete(timer),
  })
  broker.resize(80, 60)
  broker.reset(1)
  broker.ready()
  broker.paint({ x: 0, y: 0, width: 80, height: 60 }, image())
  const [timer, deadline] = [...scheduled][0]
  assert.equal(deadline.delay, 5000)
  broker.resize(100, 80)
  assert.ok(scheduled.has(timer), 'resize keeps the original in-flight deadline')
  deadline.callback()
  assert.deepEqual(failures, ['SWF frame acknowledgment timed out'])
  assert.equal(broker.inspect().pending, 0)
  assert.equal(broker.inspect().queued, 0)
  broker.ack({ instance: 'pet', task: 1, frame: 1 })
  deadline.callback()
  broker.paint({ x: 0, y: 0, width: 100, height: 80 }, image(100, 80))
  assert.equal(frames.length, 1)
  assert.equal(failures.length, 1)
})

test('valid ACK, task reset, and disposal clear frame deadlines', () => {
  const scheduled = new Map()
  let id = 0,
    clock = 10000
  const broker = createFrameBroker({
    instance: 'pet',
    send: () => {},
    fail: assert.fail,
    now: () => clock,
    setTimer: (callback, delay) => {
      scheduled.set(++id, { callback, delay })
      return id
    },
    clearTimer: timer => scheduled.delete(timer),
  })
  const publish = task => {
    clock += 100
    broker.reset(task)
    broker.ready()
    broker.paint({ x: 0, y: 0, width: 80, height: 60 }, image())
  }
  broker.resize(80, 60)
  publish(1)
  assert.equal(scheduled.size, 1)
  broker.ack({ instance: 'pet', task: 1, frame: 1 })
  assert.equal(scheduled.size, 0)
  publish(2)
  assert.equal(scheduled.size, 1)
  broker.reset(3)
  assert.equal(scheduled.size, 0)
  publish(3)
  assert.equal(scheduled.size, 1)
  broker.dispose()
  assert.equal(scheduled.size, 0)
})
