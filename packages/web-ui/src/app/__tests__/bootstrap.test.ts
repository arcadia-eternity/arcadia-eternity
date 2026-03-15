import { describe, expect, test } from 'vitest'
import { createAppBootstrap } from '../bootstrap'

describe('AppBootstrap', () => {
  test('runs hooks in phase and order sequence', async () => {
    const bootstrap = createAppBootstrap()
    const trace: string[] = []

    bootstrap.register({ name: 'b', phase: 'network-ready', order: 2, run: () => trace.push('network-b') })
    bootstrap.register({ name: 'a', phase: 'pre-init', order: 2, run: () => trace.push('pre-b') })
    bootstrap.register({ name: 'c', phase: 'pre-init', order: 1, run: () => trace.push('pre-a') })
    bootstrap.register({ name: 'd', phase: 'post-init', run: () => trace.push('post') })

    await bootstrap.runAll()

    expect(trace).toEqual(['pre-a', 'pre-b', 'network-b', 'post'])
  })

  test('continues on non-critical hook failure', async () => {
    const bootstrap = createAppBootstrap()
    const trace: string[] = []

    bootstrap.register({
      name: 'soft-fail',
      phase: 'pre-init',
      critical: false,
      run: () => {
        trace.push('before-fail')
        throw new Error('boom')
      },
    })
    bootstrap.register({ name: 'next', phase: 'pre-init', run: () => trace.push('after-fail') })

    const failures = await bootstrap.runPhase('pre-init')

    expect(trace).toEqual(['before-fail', 'after-fail'])
    expect(failures).toHaveLength(1)
    expect(failures[0]?.hook.name).toBe('soft-fail')
  })
})
