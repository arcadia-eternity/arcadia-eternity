import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { runCli } from '../src/main'

const { prepareContent } = vi.hoisted(() => ({ prepareContent: vi.fn() }))
vi.mock('@arcadia-eternity/battle/v4', () => ({ setGlobalLogger: vi.fn() }))
vi.mock('../src/application/prepare', () => ({ prepareContent, prepareRun: vi.fn() }))
vi.mock('../src/application/run', () => ({ runBattle: vi.fn() }))
vi.mock('@arcadia-eternity/console', () => ({ ConsoleUIV2: vi.fn(), initI18n: vi.fn() }))

let stdout: string
let stderr: string
const originalConsole = { log: console.log, info: console.info, debug: console.debug }
function captureWrite(collect: (text: string) => void) {
  return (
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ) => {
    collect(String(chunk))
    if (typeof encodingOrCallback === 'function') encodingOrCallback()
    else callback?.()
    return true
  }
}
beforeEach(() => {
  stdout = ''
  stderr = ''
  prepareContent.mockReset()
  vi.spyOn(process.stdout, 'write').mockImplementation(captureWrite(text => (stdout += text)))
  vi.spyOn(process.stderr, 'write').mockImplementation(captureWrite(text => (stderr += text)))
})
afterEach(() => {
  vi.restoreAllMocks()
  Object.assign(console, originalConsole)
})

it('keeps native console diagnostics out of JSON stdout and restores console methods', async () => {
  prepareContent.mockImplementation(async () => {
    console.log('native %s', 'transform')
    console.info('loaded', { count: 1 })
    console.debug('native debug')
    return { content: { effects: [], marks: [], skills: [], species: [] }, packs: [] }
  })
  expect(await runCli(['content', 'validate', '--json'])).toBe(0)
  expect(JSON.parse(stdout)).toMatchObject({ format: 'arcadia.cli.validation', valid: true })
  expect(stderr).toContain('native transform\n')
  expect(stderr).toContain('loaded { count: 1 }\n')
  expect(stderr).toContain('native debug\n')
  for (const method of ['log', 'info', 'debug'] as const) expect(console[method]).toBe(originalConsole[method])
})

it('restores native console methods after a command fails', async () => {
  prepareContent.mockImplementation(async () => {
    console.log('native diagnostic before failure')
    throw new Error('fixture failure')
  })
  expect(await runCli(['validate', '--format=json'])).toBe(1)
  expect(JSON.parse(stdout)).toMatchObject({ format: 'arcadia.cli.error' })
  expect(stderr).toContain('native diagnostic before failure\n')
  expect(stderr).toContain('fixture failure\n')
  for (const method of ['log', 'info', 'debug'] as const) expect(console[method]).toBe(originalConsole[method])
})

it('keeps Commander help on stdout', async () => {
  expect(await runCli(['content', 'validate', '--help'])).toBe(0)
  expect(stdout).toContain('Usage: arcadia content validate')
  expect(stderr).toBe('')
  expect(prepareContent).not.toHaveBeenCalled()
})

it.each([['local'], ['battle', 'local']])('preserves console output for local command %s', async (...command) => {
  prepareContent.mockImplementation(async () => {
    for (const method of ['log', 'info', 'debug'] as const) expect(console[method]).toBe(originalConsole[method])
    throw new Error('stop before allocating a battle')
  })
  expect(await runCli([...command, '--player1', 'one.json', '--player2', 'two.json'])).toBe(1)
  expect(prepareContent).toHaveBeenCalledOnce()
  expect(stderr).toContain('stop before allocating a battle')
})
