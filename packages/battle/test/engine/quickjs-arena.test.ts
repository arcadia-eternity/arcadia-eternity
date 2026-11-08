import { getQuickJS } from 'quickjs-emscripten'
import { Arena } from 'quickjs-emscripten-sync'
import { expect, it } from 'vitest'
import * as sdk from '../../authoring'
import { compileBehaviorUse, type NativeBehaviorExport } from '../../engine'

it('preserves native SDK registrations and parameter identities without a custom bridge', async () => {
  const ctx = (await getQuickJS()).newContext()
  const exportsByIdentity = new WeakSet<object>()
  const arena = new Arena(ctx, {
    isMarshalable: true,
    marshalByReference: value => !!value && typeof value === 'object' && exportsByIdentity.has(value),
  })
  try {
    const register = <T extends object>(value: T): T => {
      arena.expose({ __sdkResult: value })
      arena.register(value, '__sdkResult')
      arena.evalCode('delete globalThis.__sdkResult')
      return value
    }
    arena.expose({
      sdk: {
        defineCodeEffect: (...args: Parameters<typeof sdk.defineCodeEffect>) => {
          const value = sdk.defineCodeEffect(...args)
          exportsByIdentity.add(value)
          return value
        },
        defineEffect: sdk.defineEffect,
        numberParam: (...args: Parameters<typeof sdk.numberParam>) => register(sdk.numberParam(...args)),
        EffectTrigger: sdk.EffectTrigger,
        targets: sdk.targets,
        ops: sdk.ops,
      },
    })
    const exports = arena.evalCode<NativeBehaviorExport[]>(`(() => {
      const amount = sdk.numberParam({ default: 12 });
      return [sdk.defineCodeEffect({ id: 'probe/heal', sourceKind: 'skill',
        build: ({ effectId }) => sdk.defineEffect({ id: effectId,
          triggers: [sdk.EffectTrigger.OnHit], parameters: { amount },
          apply: sdk.targets.ownerPet.apply(sdk.ops.heal(amount)),
        })
      })];
    })()`)
    expect(exports[0].id).toBe('probe/heal')
    const result = compileBehaviorUse(
      sdk.codeEffectDefinition(exports[0]),
      {
        useId: 'probe',
        definitionId: exports[0].id,
      },
      { owner: { kind: 'skill', id: 'probe/skill' }, nativeExports: exports },
    )
    if (!result.ok) throw Error(JSON.stringify(result.diagnostics))
    expect(result.effect).toBeDefined()
  } finally {
    arena.dispose()
    ctx.dispose()
  }
})

it('supports registered opaque host references and synchronous reentry', async () => {
  const ctx = (await getQuickJS()).newContext()
  const original = Object.freeze({ identity: 'private' })
  const arena = new Arena(ctx, { isMarshalable: true, marshalByReference: value => value === original })
  try {
    arena.expose({
      get: () => original,
      same: (value: unknown) => value === original,
      nested: (fn: (value: number) => number) => fn(4) + 1,
    })
    expect(arena.evalCode('get() === get() && same(get())')).toBe(true)
    expect(arena.evalCode('nested(x => x * 2)')).toBe(9)
  } finally {
    arena.dispose()
    ctx.dispose()
  }
})

it('records whether guest Map and Set roundtrips preserve identity', async () => {
  const ctx = (await getQuickJS()).newContext()
  const arena = new Arena(ctx, { isMarshalable: true })
  try {
    arena.expose({ roundtrip: (value: unknown) => value })
    const result = arena.evalCode<{ map: boolean; set: boolean }>(`(() => {
      const map = new Map([['a', 1]]), set = new Set([1]);
      return { map: roundtrip(map) === map, set: roundtrip(set) === set };
    })()`)
    // Upstream documents value copies; this blocks a transparent replacement for author-owned collections.
    expect(result).toEqual({ map: false, set: false })
  } finally {
    arena.dispose()
    ctx.dispose()
  }
})
