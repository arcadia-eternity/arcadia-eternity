import { test } from 'node:test'
import ts from 'typescript'
import assert from 'node:assert/strict'
import { classifyMarkApplication, generateMarkApplications, renderMarkApplications } from './mark-applications.mjs'
const source = () => ({
  id: 'example',
  trigger: 'OnHit',
  priority: 0,
  condition: { type: 'selfUseSkill' },
  apply: { type: 'addMark', target: 'self', mark: { type: 'entity:baseMark', value: 'mark/example' }, stack: 2 },
})
test('recognizes exact fixed dependencies and preserves the old zero-as-omitted behavior', () => {
  assert.equal(classifyMarkApplication(source()).markId, 'mark/example')
  assert.equal(classifyMarkApplication(source()).stack, 2)
  const zero = source()
  zero.apply.stack = 0
  zero.apply.duration = 0
  assert.equal(classifyMarkApplication(zero).stack, undefined)
  assert.equal(classifyMarkApplication(zero).duration, undefined)
  assert.deepEqual(classifyMarkApplication({ ...source(), trigger: ['OnHit', 'OnMiss'] }).triggers, ['OnHit', 'OnMiss'])
})
test('rejects extra semantics rather than silently dropping them', () => {
  const d = source()
  for (const invalid of [
    { ...d, consumesStacks: 1 },
    { ...d, trigger: 'OnDamage' },
    { ...d, trigger: ['OnHit', 'OnHit'] },
    { ...d, priority: NaN },
    { ...d, condition: { type: 'some', conditions: [d.condition, { type: 'isFirstSkillUsedThisTurn' }] } },
    { ...d, condition: { type: 'not', condition: d.condition } },
    { ...d, apply: { ...d.apply, config: { duration: 1 } } },
    { ...d, apply: { ...d.apply, stack: { type: 'raw:number', value: 2 } } },
    { ...d, apply: { ...d.apply, duration: Infinity } },
    { ...d, apply: { ...d.apply, target: 'selfTeam' } },
    { ...d, apply: { ...d.apply, mark: { ...d.apply.mark, configId: 'dynamic' } } },
  ])
    assert.ok(classifyMarkApplication(invalid).reason)
})
test('regenerates the exact current native source and dependency ledger without writes', async () => {
  assert.deepEqual(await generateMarkApplications({ check: true }), {
    generated: 190,
    protected: 0,
    dependencies: 155,
    rejected: 97,
  })
})

test('requires a positive self-use guard and retains composed admission order and C08', () => {
  const d = source()
  const ordered = {
    ...d,
    condition: { type: 'every', conditions: [d.condition, { type: 'isFirstSkillUsedThisTurn' }] },
  }
  assert.equal(
    classifyMarkApplication(ordered).when,
    'conditions.all(conditions.selfUsesSkill,conditions.firstSkillThisTurn)',
  )
  assert.deepEqual(classifyMarkApplication(ordered).additionalDecisions, ['C08'])
  assert.ok(
    classifyMarkApplication({
      ...d,
      condition: {
        type: 'every',
        conditions: [{ type: 'some', conditions: [d.condition, { type: 'isFirstSkillUsedThisTurn' }] }],
      },
    }).reason,
  )
  assert.ok(
    classifyMarkApplication({ ...d, condition: { type: 'every', conditions: [d.condition, { type: 'unknown' }] } })
      .reason,
  )
})

test('rendered imports cover shared-emitter context expressions beyond current catalog cases', () => {
  for (const extra of [
    {
      type: 'evaluate',
      target: { base: 'usingSkillContext', chain: [{ type: 'selectPath', arg: 'category' }] },
      evaluator: { type: 'same', value: 'Physical' },
    },
    {
      type: 'evaluate',
      target: { base: 'battle', chain: [{ type: 'select', arg: { type: 'dynamic', arg: 'currentTurn' } }] },
      evaluator: { type: 'compare', operator: '>', value: 1 },
    },
  ]) {
    const d = source()
    const recipe = classifyMarkApplication({ ...d, condition: { type: 'every', conditions: [d.condition, extra] } })
    assert.ok(!recipe.reason)
    assert.match(recipe.when, /contexts\./)
    const code = renderMarkApplications([recipe], [recipe.markId])
    const file = ts.createSourceFile('candidate.ts', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const imports = file.statements
      .filter(ts.isImportDeclaration)
      .flatMap(node =>
        node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)
          ? node.importClause.namedBindings.elements.map(item => item.name.text)
          : [],
      )
    assert.ok(imports.includes('contexts'))
    assert.equal(file.parseDiagnostics.length, 0)
    assert.ok(code.includes(recipe.when))
  }
})
