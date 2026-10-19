import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyDamageModifier, generateDamageModifiers } from './damage-modifiers.mjs'
const source = () => ({
  id: 'example',
  trigger: 'OnBeforeCalculateDamage',
  priority: 0,
  condition: { type: 'selfUseSkill' },
  apply: { type: 'addModified', target: 'damageContext', percent: 20, delta: 0 },
})
test('emits typed queries, separate arithmetic floors and lazy conditionals', () => {
  const d = source()
  d.apply.delta = {
    type: 'dynamic',
    selector: {
      base: 'opponent',
      chain: [
        { type: 'select', arg: { type: 'base', arg: 'maxHp' } },
        { type: 'divide', arg: 4 },
        { type: 'multiply', arg: 0.5 },
        { type: 'clampMax', arg: 180 },
      ],
    },
  }
  d.apply.percent = {
    type: 'conditional',
    condition: { type: 'selfHasMark', baseId: 'mark_a' },
    trueValue: 30,
    falseValue: 10,
  }
  const r = classifyDamageModifier(d)
  assert.match(r.delta, /Math.floor\(n \/ 4\).*Math.floor\(n \* 0.5\).*Math.min\(n, 180\)/)
  assert.match(r.percent, /values.choose/)
  assert.match(r.percent, /mark.baseId === "mark_a"/)
})
test('preserves ordered admission and late damage stage rather than rewriting it', () => {
  const d = source()
  d.trigger = 'OnDamage'
  d.condition = {
    type: 'every',
    conditions: [{ type: 'checkSelf' }, { type: 'not', condition: { type: 'selfHasMark', baseId: 'mark_b' } }],
  }
  const r = classifyDamageModifier(d)
  assert.deepEqual(r.triggers, ['OnDamage'])
  assert.match(r.when, /conditions.all\(conditions.selfBeDamaged,conditions.not/)
})
test('rejects unhandled fields, raw parameters, target chains, nonfinite numbers and unsupported stages', () => {
  const d = source()
  for (const bad of [
    { ...d, consumesStacks: 1 },
    { ...d, priority: NaN },
    { ...d, trigger: [] },
    { ...d, trigger: ['OnDamage', 'OnDamage'] },
    { ...d, trigger: 'BeforeRageGain' },
    { ...d, apply: { ...d.apply, delta: Infinity } },
    { ...d, apply: { ...d.apply, delta: { type: 'raw:number', value: 2 } } },
    { ...d, apply: { ...d.apply, target: { base: 'damageContext', chain: [] } } },
    { ...d, condition: { type: 'selfUseSkill', extra: true } },
    {
      ...d,
      apply: {
        ...d.apply,
        delta: { type: 'dynamic', selector: { base: 'mark', chain: [{ type: 'selectAttribute$', arg: 'stack' }] } },
      },
    },
    {
      ...d,
      apply: {
        ...d.apply,
        delta: {
          type: 'dynamic',
          selector: { base: 'self', chain: [{ type: 'select', arg: { type: 'dynamic', arg: 'weight' } }] },
        },
      },
    },
  ])
    assert.ok(classifyDamageModifier(bad).reason, JSON.stringify(bad))
})
test('source and per-ID ledger reproduce, retaining the handwritten HP effect', async () => {
  assert.deepEqual(await generateDamageModifiers({ check: true }), { generated: 66, protected: 1, rejected: 50 })
})

test('rejects false-zero branch absence and multi-member compare instead of changing legacy meaning', () => {
  const d = source()
  const missing = {
    type: 'conditional',
    condition: { type: 'selfHasMark', baseId: 'mark_missing' },
    trueValue: 20,
    falseValue: 0,
  }
  assert.ok(classifyDamageModifier({ ...d, apply: { ...d.apply, percent: missing, delta: 5 } }).reason)
  assert.ok(
    classifyDamageModifier({ ...d, apply: { ...d.apply, percent: { ...missing, falseValue: missing } } }).reason,
  )
  assert.ok(
    classifyDamageModifier({
      ...d,
      condition: {
        type: 'evaluate',
        target: { base: 'selfMarks', chain: [{ type: 'select', arg: { type: 'base', arg: 'stack' } }] },
        evaluator: { type: 'compare', operator: '>', value: 2 },
      },
    }).reason,
  )
})
