import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifySkillFlag, generateSkillFlags } from './skill-flags.mjs'
const source = () => ({
  id: 'example',
  trigger: 'OnBattleStart',
  priority: 0,
  apply: {
    type: 'setValue',
    target: {
      base: 'selfSkills',
      chain: [
        {
          type: 'whereAttr',
          extractor: { type: 'dynamic', arg: 'multihit' },
          evaluator: { type: 'notSame', value: 1 },
        },
        { type: 'selectProp', arg: 'sureHit' },
      ],
    },
    value: true,
  },
})
test('reproduces persistent skill flag candidates and retains the authored HP assignment', async () =>
  assert.deepEqual(await generateSkillFlags({ check: true }), { generated: 6, rejected: 3, retained: 1 }))
test('uses the shared skill query and distinguishes instance flags from use overrides', () => {
  const r = classifySkillFlag(source())
  assert.match(r.actions[0].code, /skill.multihit\[0\].*!== 1.*ops.setSkillSureHit\(true\)/)
  const d = source()
  d.apply.value = false
  assert.match(classifySkillFlag(d).actions[0].code, /setSkillSureHit\(false\)/)
})
test('rejects unsupported flags, numeric inputs and changed multi-hit predicates', () => {
  for (const change of [
    d => (d.apply.target.chain[1].arg = 'sureCrit'),
    d => (d.apply.value = 1),
    d => (d.apply.target.chain[0].evaluator.value = 2),
    d => (d.trigger = 'OnHit'),
  ]) {
    const d = source()
    change(d)
    assert.ok(classifySkillFlag(d).reason)
  }
})
