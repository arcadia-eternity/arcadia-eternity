import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifySkillContributions, generateSkillContributions } from './skill-contributions.mjs'
const source = () => ({
  id: 'fixture',
  trigger: 'OnMarkCreated',
  priority: 0,
  apply: {
    type: 'addSkillAttributeModifier',
    target: { base: 'selfSkills' },
    attribute: 'power',
    modifierType: 'percent',
    value: 20,
  },
})
test('emits thirteen static and one live skill contribution', async () =>
  assert.deepEqual(await generateSkillContributions({ check: true }), { generated: 14, rejected: 0 }))
test('uses explicit target-skill fallback lifetime', () =>
  assert.match(classifySkillContributions(source()).actions[0].code, /lifetime:"sourceMarkOrTargetSkill"/))
test('rejects unsupported fields and malformed selection chains', () => {
  for (const mutate of [
    d => (d.apply.phaseType = 'turn'),
    d => (d.apply.attribute = 'foo'),
    d => (d.apply.target = { base: 'selfSkills', chain: null }),
    d =>
      (d.apply.target = {
        base: 'selfSkills',
        chain: [
          { type: 'whereAttr', extractor: { type: 'dynamic', arg: 'owner' }, evaluator: { type: 'same', value: 'x' } },
        ],
      }),
    d =>
      (d.apply.value = {
        type: 'dynamic',
        selector: { base: 'mark', chain: [{ type: 'selectAttribute$', arg: 'duration' }] },
      }),
  ]) {
    const d = source()
    mutate(d)
    assert.ok(classifySkillContributions(d).reason)
  }
})

test('live skill binding preserves stack timing and requires mark-created trigger', () => {
  const d = source()
  d.apply.value = { type: 'dynamic', selector: { base: 'mark', chain: [{ type: 'selectAttribute$', arg: 'stack' }] } }
  assert.match(classifySkillContributions(d).actions[0].code, /ops.bindSkillAttribute/)
  d.trigger = 'OnBattleStart'
  assert.ok(classifySkillContributions(d).reason)
})
