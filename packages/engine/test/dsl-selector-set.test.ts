import { describe, expect, it } from 'vitest'
import { applyCommonSelectorChain } from '../src/dsl/resolvers.js'
import type { CommonSelectorChainStep, SelectorChainRuntimeHooks } from '../src/dsl/types.js'

function run(initial: unknown[], other: unknown[], type: 'and' | 'or', duplicate = false): unknown[] {
  const hooks: SelectorChainRuntimeHooks<never, unknown[], never, never, never> = {
    resolveSelector: selector => selector,
    resolveValue: () => undefined,
    applyExtractor: () => [],
    evaluateEvaluator: () => false,
    evaluateCondition: () => false,
    shuffle: items => items,
    getConfigValue: () => undefined,
  }
  const step: CommonSelectorChainStep<never, unknown[], never, never, never> =
    type === 'and' ? { type, arg: other } : { type, arg: other, duplicate }
  return applyCommonSelectorChain(initial, [step], hooks)
}

describe('selector set operations', () => {
  it('intersects objects by identity without conflating distinct objects', () => {
    const first = { id: 'first' }
    const second = { id: 'second' }
    expect(run([first, second], [second], 'and')).toEqual([second])
  })

  it('retains distinct objects in a union and removes shared references', () => {
    const first = { id: 'first' }
    const second = { id: 'second' }
    expect(run([first], [first, second], 'or')).toEqual([first, second])
  })

  it('keeps primitive values of different types distinct', () => {
    expect(run([1, '1'], ['1'], 'and')).toEqual(['1'])
    expect(run([1], [1, '1'], 'or')).toEqual([1, '1'])
  })

  it('preserves duplicate mode and string entity ID matching', () => {
    expect(run(['pet-a'], ['pet-a'], 'or', true)).toEqual(['pet-a', 'pet-a'])
    expect(run(['pet-a', 'pet-b'], ['pet-b'], 'and')).toEqual(['pet-b'])
  })
})
