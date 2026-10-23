import test from 'node:test'
import assert from 'node:assert/strict'
import { matchParameterSurface, rawParameters } from './parameter-surface.mjs'

const source = {
  id: 'effect/test',
  sourceFile: 'test.yaml',
  sourcePath: '/0',
  definitionSha256: 'source',
  definition: { apply: { value: { type: 'raw:number', value: 0, tags: ['amount'], configId: 'value' } } },
}
const parameter = { effectId: source.id, address: 'native/value', value: 0, tags: ['amount'] }
const audit = (
  definitions = [source],
  parameters = [parameter],
  resolveAlias = () => parameter.address,
  extensions = [],
) => matchParameterSurface(definitions, parameters, resolveAlias, extensions)

test('records source-node identity, zero defaults, tags and explicit alias resolution', () => {
  const result = audit()
  assert.deepEqual(result.summary, { sourceDeclarations: 1, explicitAliases: 1, nativeParameters: 1, extensions: 0 })
  assert.equal(result.records[0].nodePath, '/apply/value')
  assert.equal(result.records[0].defaultValue, 0)
  assert.equal(result.records[0].legacyAlias, 'effect/test.value')
  assert.deepEqual(rawParameters({ 'a/b': { '~': { type: 'raw:boolean', value: false } } })[0].nodePath, '/a~1b/~0')
})
test('rejects missing, aliased-to-foreign, changed-default and changed-tag parameters', () => {
  assert.throws(() => audit([source], []), /Missing/)
  assert.throws(() => audit([source], [{ ...parameter, effectId: 'other' }]), /Foreign/)
  assert.throws(() => audit([source], [{ ...parameter, value: 1 }]), /Changed default/)
  assert.throws(() => audit([source], [{ ...parameter, tags: [] }]), /Changed tags/)
})
test('rejects ambiguous anonymous nodes and repeated use of one native address', () => {
  const anonymous = { ...source, definition: { value: { type: 'raw:number', value: 0, tags: ['amount'] } } }
  assert.throws(() => audit([anonymous], [parameter, { ...parameter, address: 'second' }]), /ambiguous/)
  assert.throws(() => audit([source, source]), /Multiple source nodes/)
})
test('requires explicit declarations for every native-only parameter and rejects stale extensions', () => {
  const extra = { effectId: source.id, address: 'native/extra', value: true, tags: [] }
  assert.throws(() => audit([source], [parameter, extra]), /Undeclared/)
  const extension = {
    effectId: source.id,
    address: extra.address,
    defaultValue: true,
    tags: [],
    reason: 'Reviewed public flag.',
  }
  assert.equal(audit([source], [parameter, extra], undefined, [extension]).summary.extensions, 1)
  assert.throws(() => audit([source], [parameter], undefined, [extension]), /Stale/)
  assert.throws(
    () => audit([source], [parameter, extra], undefined, [{ ...extension, defaultValue: false }]),
    /Changed extension/,
  )
})
