import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifySkillNumericReferences, generateSkillNumericReferences } from './skill-numeric-references.mjs'
const source = () => ({
  id: 'fixture',
  trigger: 'BeforeSort',
  priority: 0,
  condition: { type: 'selfUseSkill' },
  apply: {
    type: 'addValue',
    target: { base: 'useSkillContext', chain: [{ type: 'selectProp', arg: 'priority' }] },
    value: 1,
  },
})
test('reproduces all eight bounded numeric-reference candidates', async () =>
  assert.deepEqual(await generateSkillNumericReferences({ check: true }), { generated: 8, rejected: 0 }))
test('emits a typed reference and records the selector correction', () => {
  const r = classifySkillNumericReferences(source())
  assert.deepEqual(r.repairedPaths, ['/apply/target/base'])
  assert.match(r.actions[0].code, /property\("priority"\).apply\(ops.add\(1\)\)/)
})
test('rejects unsupported writable keys and chain shapes', () => {
  for (const mutate of [
    d => (d.apply.target.chain[0].arg = 'power'),
    d => d.apply.target.chain.push({ type: 'limit', arg: 1 }),
    d => (d.apply.target.chain[0].type = 'selectPath'),
    d => (d.apply.value = NaN),
  ]) {
    const d = source()
    mutate(d)
    assert.ok(classifySkillNumericReferences(d).reason)
  }
})
